/**
 * Authentication CLI Commands
 */

import { Command } from "commander";
import * as readline from "readline";
import {
  saveAuthToFile,
  loadAuthFromFile,
  getStateChangeApiKey,
  getAuthFilePath,
} from "../auth.js";
import { listXanoTokens, checkTokenHealth, resolveInstance } from "../registry-client.js";

function promptForApiKey(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Enter your StateChange API key: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function createAuthCommand(program: Command) {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("init")
    .description("Initialize StateChange API key")
    .option("--api-key <key>", "StateChange API key")
    .action(async (options) => {
      let apiKey = options.apiKey;
      if (!apiKey) {
        apiKey = await promptForApiKey();
      }
      if (!apiKey) {
        console.error("Error: API key is required");
        process.exit(1);
      }
      saveAuthToFile({ apiKey });
      console.log(`✅ API key saved to ${getAuthFilePath()}`);
      // Test the key
      try {
        await listXanoTokens(apiKey);
        console.log("✅ API key verified successfully");
      } catch (e: any) {
        console.warn(`⚠️  API key saved but verification failed: ${e.message}`);
        console.warn("   You may need to check your API key");
      }
    });

  auth
    .command("whoami")
    .description("Verify authentication and show available instances")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .action(async (options) => {
      const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
      if (!apiKey) {
        console.error("Error: No API key found. Run 'sc-xano auth init' first.");
        console.error("   Or set STATECHANGE_API_KEY environment variable");
        console.error("   Or use --api-key flag");
        process.exit(1);
      }

      const savedAuth = loadAuthFromFile();
      if (savedAuth?.xanoInstance) {
        console.log(`   Default instance: ${savedAuth.xanoInstance}`);
      }
      if (savedAuth?.xanoWorkspace) {
        console.log(`   Default workspace: ${savedAuth.xanoWorkspace}`);
      }

      try {
        const response = await listXanoTokens(apiKey);
        const tokens = response.tokens || [];
        console.log("✅ Connected to StateChange backend");
        if (tokens.length === 0) {
          console.log("   No Xano instances available");
        } else {
          console.log(`   ${tokens.length} instance(s) available:`);
          tokens.forEach((token) => {
            // Handle both camelCase and snake_case from backend
            // The backend may return either format, so we check both
            const tokenAny = token as any;
            const instanceId =
              tokenAny.instanceId || tokenAny.instance_id || "unknown";
            // instanceName may come as camelCase or snake_case, or may be missing entirely
            const instanceName =
              tokenAny.instanceName || tokenAny.instance_name;
            // Use instanceName if it exists and is truthy, otherwise fallback to instanceId.
            // The API key is instance-and-user level, not workspace/branch scoped,
            // so we intentionally do NOT surface workspace/branch here to avoid confusion.
            const displayName = instanceName ? instanceName : instanceId;
            console.log(`     - ${displayName}`);
          });
        }
      } catch (e: any) {
        console.error(`❌ Authentication failed: ${e.message}`);
        if (e.message.includes("401") || e.message.includes("403")) {
          console.error(
            "   Your API key may be invalid. Run 'sc-xano auth init' to update it.",
          );
        }
        process.exit(1);
      }
    });

  auth
    .command("set-instance")
    .description("Save default Xano instance and workspace")
    .argument("<instance>", "Xano instance hostname (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Default workspace ID")
    .action(async (instance, options) => {
      const existing = loadAuthFromFile();
      if (!existing) {
        console.error("Error: Run 'sc-xano auth init' first to set up your API key.");
        process.exit(1);
      }
      existing.xanoInstance = instance;
      if (options.workspace) {
        existing.xanoWorkspace = parseInt(options.workspace);
      }
      saveAuthToFile(existing);
      console.log(`✅ Default instance saved: ${instance}`);
      if (options.workspace) {
        console.log(`✅ Default workspace saved: ${options.workspace}`);
      }
      console.log(`   Config: ${getAuthFilePath()}`);
    });

  auth
    .command("status")
    .description("Check Xano token health and session freshness")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--instance <host>", "Xano instance hostname")
    .action(async (options) => {
      const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
      if (!apiKey) {
        console.error("Error: No API key found. Run 'sc-xano auth init' first.");
        process.exit(1);
      }

      try {
        const response = await listXanoTokens(apiKey);
        const tokens = response.tokens || [];

        if (tokens.length === 0) {
          console.log("No Xano tokens found.");
          console.log("Open your Xano workspace with the StateChange extension to create one.");
          return;
        }

        // If instance specified, filter to that one
        const instance = options.instance || (await resolveInstance({ apiKey: options.apiKey }));
        const filtered = instance
          ? tokens.filter((t: any) => (t.instanceId || t.instance_id) === instance)
          : tokens;

        const toShow = filtered.length > 0 ? filtered : tokens;

        for (const token of toShow) {
          const health = checkTokenHealth(token);
          const id = (token as any).instanceId || (token as any).instance_id || "unknown";
          const name = (token as any).instanceName || (token as any).instance_name;
          const wsId = (token as any).workspaceId || (token as any).workspace_id;

          console.log(`Instance: ${name || id}`);
          if (wsId) console.log(`  Workspace: ${wsId}`);

          const statusIcon =
            health.status === "fresh" ? "✅" :
            health.status === "stale" ? "⚠️ " :
            health.status === "expired" ? "❌" : "❓";

          console.log(`  Token status: ${statusIcon} ${health.status}`);
          console.log(`  Age: ${health.ageHours} hours`);

          if (health.status === "fresh") {
            console.log(`  Expires in: ${health.remainingHours} hours`);
          } else if (health.status === "stale") {
            console.log(`  ${health.message}`);
            console.log(`  Open Xano with the StateChange extension to refresh.`);
          } else if (health.status === "expired") {
            console.log(`  ${health.message}`);
            console.log(`  Open your Xano workspace to refresh:`);
            console.log(`    https://app.xano.com`);
          }
          console.log("");
        }
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
    });

  return auth;
}
