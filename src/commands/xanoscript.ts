/**
 * XanoScript CLI Commands — Generation using Xano API
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { makeClient } from "../registry-client.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)");

// Map CLI type names to XanoScript kind values
const TYPE_TO_KIND: Record<string, string> = {
  function: "schema:function",
  table: "schema:table",
  api: "schema:query",
  task: "schema:task",
  trigger: "schema:trigger",
  mcp_server: "schema:mcp_server",
  addon: "schema:addon",
  middleware: "schema:middleware",
};

// Map CLI type names to the sink fetcher methods
type FetcherResult = { items: any[]; nameField: string };

async function fetchObjectsOfType(
  client: XanoClient,
  workspace: number,
  branchId: number,
  type: string
): Promise<FetcherResult> {
  switch (type) {
    case "function": {
      const { functions } = await client.getFunctions(workspace, branchId);
      return { items: functions, nameField: "name" };
    }
    case "table": {
      const sink = await client.getWorkspaceSink(workspace);
      return { items: sink.dbos ?? [], nameField: "name" };
    }
    case "api": {
      const { queries } = await client.getAPIAppsAndQueries(workspace, branchId);
      return { items: queries, nameField: "name" };
    }
    case "task": {
      const tasks = await client.getTasks(workspace, branchId);
      return { items: tasks, nameField: "name" };
    }
    case "trigger": {
      const triggers = await client.getTriggers(workspace, branchId);
      return { items: triggers, nameField: "name" };
    }
    case "mcp_server": {
      const servers = await client.getMCPServers(workspace, branchId);
      return { items: servers, nameField: "name" };
    }
    case "addon": {
      const addons = await client.getAddons(workspace, branchId);
      return { items: addons, nameField: "name" };
    }
    case "middleware": {
      const mw = await client.getMiddleware(workspace, branchId);
      return { items: mw, nameField: "name" };
    }
    default:
      throw new Error(`Unknown type: ${type}. Valid types: ${Object.keys(TYPE_TO_KIND).join(", ")}`);
  }
}

function resolveKind(type: string, data?: any): string {
  // Special handling for triggers based on obj_type
  if (type === "trigger" && data) {
    const objType = data.obj_type;
    if (objType === "toolset") return "schema:mcp_server_trigger";
    if (objType === "database") return "schema:table_trigger";
  }
  // Special handling for database type
  if (type === "database") return "schema:table";

  const kind = TYPE_TO_KIND[type];
  if (!kind) {
    throw new Error(`Unknown type: ${type}. Valid types: ${Object.keys(TYPE_TO_KIND).join(", ")}`);
  }
  return kind;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_");
}

export function createXanoScriptCommand(program: Command) {
  const xs = program.command("xanoscript").description("XanoScript generation");

  stdOptions(
    xs
      .command("generate")
      .description("Generate XanoScript for a single object")
      .argument("<type>", `Object type (${Object.keys(TYPE_TO_KIND).join(", ")})`)
      .argument("<id>", "Object ID")
  ).action(async (type, id, options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const objectId = parseInt(id);

      // Fetch via sink and pluck by ID
      const { items } = await fetchObjectsOfType(client, workspace, branchId, type);
      const data = items.find((item: any) => item.id === objectId);
      if (!data) {
        console.error(`Error: ${type} with ID ${objectId} not found`);
        process.exit(1);
      }

      const kind = resolveKind(type, data);
      const result = await client.generateXanoScript(workspace, data, kind);

      if (result.status === "success" && result.payload?.output) {
        console.log(result.payload.output);
      } else if (result.payload?.message) {
        if (!result.payload.doIgnore) {
          console.error("Error:", result.payload.message);
          process.exit(1);
        }
      } else {
        console.error("Error: No XanoScript output returned");
        process.exit(1);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    xs
      .command("export-all")
      .description("Bulk export all objects of a type to .xs files")
      .option("--type <type>", `Object type (${Object.keys(TYPE_TO_KIND).join(", ")})`)
      .option("--output-dir <dir>", "Output directory", "./xanoscript")
  ).action(async (options) => {
    try {
      if (!options.type) {
        console.error(`Error: --type required. Valid types: ${Object.keys(TYPE_TO_KIND).join(", ")}`);
        process.exit(1);
      }

      const { client, workspace, branchId } = await makeClient(options);
      const type = options.type;
      const outputDir = resolve(options.outputDir, type);

      mkdirSync(outputDir, { recursive: true });

      console.log(`Fetching ${type} objects from workspace ${workspace}...\n`);
      const { items, nameField } = await fetchObjectsOfType(client, workspace, branchId, type);
      console.log(`Found ${items.length} ${type}(s). Generating XanoScript...\n`);

      let success = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const name = item[nameField] || `unnamed_${item.id}`;
        process.stdout.write(`  [${i + 1}/${items.length}] ${name}...`);

        // Sink data already contains full objects
        const kind = resolveKind(type, item);
        const result = await client.generateXanoScript(workspace, item, kind);

        if (result.status === "success" && result.payload?.output) {
          const filename = `${sanitizeFilename(name)}.xs`;
          const filepath = join(outputDir, filename);
          writeFileSync(filepath, result.payload.output, "utf-8");
          console.log(` ✅`);
          success++;
        } else if (result.payload?.doIgnore) {
          console.log(` ⏭️  skipped`);
          skipped++;
        } else {
          console.log(` ❌ ${result.payload?.message || "unknown error"}`);
          errors++;
        }
      }

      console.log(`\nDone: ${success} exported, ${skipped} skipped, ${errors} errors`);
      if (success > 0) {
        console.log(`Output: ${outputDir}/`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  return xs;
}
