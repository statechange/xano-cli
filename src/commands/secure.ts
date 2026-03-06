/**
 * Security CLI Commands
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { resolveXanoToken, resolveInstance } from "../registry-client.js";

export function createSecureCommand(program: Command) {
  const secure = program.command("secure").description("Security commands");

  secure
    .command("swagger")
    .description("Secure or disable Swagger for an app")
    .requiredOption("--app-id <id>", "App ID")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--disable", "Disable Swagger entirely")
    .option("--require-token", "Require token for Swagger access")
    .action(async (options) => {
      const instance = await resolveInstance({ instance: options.instance, apiKey: options.apiKey });
      if (!instance) {
        console.error("Error: Xano instance required (--instance or XANO_INSTANCE env var)");
        process.exit(1);
      }

      const token = await resolveXanoToken({
        instance,
        token: options.token,
        apiKey: options.apiKey,
      });
      if (!token) {
        console.error(
          "Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')"
        );
        process.exit(1);
      }

      const branchId = parseInt(options.branch);
      const appId = parseInt(options.appId);
      const client = new XanoClient({ instance, token });

      try {
        console.log(`Fetching app ${appId}...`);
        const app = await client.getApp(appId, branchId);

        if (options.disable) {
          console.log("Disabling Swagger...");
          const newApp = { ...app, swagger: false };
          await client.updateApp(newApp);
          console.log("✅ Swagger disabled");
        } else if (options.requireToken) {
          console.log("Securing Swagger with token requirement...");
          const newApp = {
            ...app,
            swagger: true,
            documentation: { require_token: true, token: "" },
          };
          await client.updateApp(newApp);
          console.log("✅ Swagger secured (requires token)");
        } else {
          console.error("Error: Must specify either --disable or --require-token");
          process.exit(1);
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  return secure;
}
