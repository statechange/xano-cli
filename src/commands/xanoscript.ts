/**
 * XanoScript CLI Commands — Generation using Xano API
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { makeClient } from "../cli-connection.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)");

// The one registry of concrete types that can be fetched and exported.
// `all` is deliberately a CLI selector, not a Xano schema kind.
export const EXPORTABLE_XANOSCRIPT_TYPES = [
  "function",
  "table",
  "api",
  "task",
  "trigger",
  "mcp_server",
  "addon",
  "middleware",
] as const;

export type ExportableXanoScriptType = (typeof EXPORTABLE_XANOSCRIPT_TYPES)[number];
export type XanoScriptExportSelector = ExportableXanoScriptType | "all";

const TYPE_TO_KIND: Record<ExportableXanoScriptType, string> = {
  function: "schema:function",
  table: "schema:table",
  api: "schema:query",
  task: "schema:task",
  trigger: "schema:trigger",
  mcp_server: "schema:mcp_server",
  addon: "schema:addon",
  middleware: "schema:middleware",
};

export function selectExportTypes(
  selector: XanoScriptExportSelector
): readonly ExportableXanoScriptType[] {
  return selector === "all" ? EXPORTABLE_XANOSCRIPT_TYPES : [selector];
}

function isExportableType(value: string): value is ExportableXanoScriptType {
  return EXPORTABLE_XANOSCRIPT_TYPES.includes(value as ExportableXanoScriptType);
}

function isExportSelector(value: string): value is XanoScriptExportSelector {
  return value === "all" || isExportableType(value);
}

// Map CLI type names to the sink fetcher methods
type FetcherResult = { items: any[]; nameField: string };

async function fetchObjectsOfType(
  client: XanoClient,
  workspace: number,
  branchId: number,
  type: ExportableXanoScriptType
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
    default: {
      const exhaustiveCheck: never = type;
      throw new Error(`Unknown XanoScript export type: ${exhaustiveCheck}`);
    }
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

  if (!isExportableType(type)) {
    throw new Error(`Unknown type: ${type}. Valid types: ${Object.keys(TYPE_TO_KIND).join(", ")}`);
  }
  return TYPE_TO_KIND[type];
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-. ]/g, "_");
}

export type AllocatedXanoScriptFilename = {
  filename: string;
  disambiguated: boolean;
};

/**
 * Claims a deterministic filename for one export. The first basename keeps
 * the existing shape; a collision prefers the object's stable ID.
 */
export function allocateXanoScriptFilename(
  name: string,
  objectId: unknown,
  claimedFilenames: Set<string>
): AllocatedXanoScriptFilename {
  const basename = sanitizeFilename(name);
  const originalFilename = `${basename}.xs`;
  if (!claimedFilenames.has(originalFilename)) {
    claimedFilenames.add(originalFilename);
    return { filename: originalFilename, disambiguated: false };
  }

  const rawId = objectId == null ? "" : String(objectId).trim();
  const sanitizedId = sanitizeFilename(rawId);
  if (rawId && /[a-zA-Z0-9]/.test(sanitizedId)) {
    const idFilename = `${basename}_${sanitizedId}.xs`;
    if (!claimedFilenames.has(idFilename)) {
      claimedFilenames.add(idFilename);
      return { filename: idFilename, disambiguated: true };
    }
  }

  let suffix = 2;
  let fallbackFilename = `${basename}_${suffix}.xs`;
  while (claimedFilenames.has(fallbackFilename)) {
    suffix++;
    fallbackFilename = `${basename}_${suffix}.xs`;
  }
  claimedFilenames.add(fallbackFilename);
  return { filename: fallbackFilename, disambiguated: true };
}

/** Writes one generated script to its newly claimed path. */
export function retainXanoScriptFile(
  outputDir: string,
  name: string,
  objectId: unknown,
  script: string,
  claimedFilenames: Set<string>
): AllocatedXanoScriptFilename {
  const allocation = allocateXanoScriptFilename(name, objectId, claimedFilenames);
  writeFileSync(join(outputDir, allocation.filename), script, "utf-8");
  return allocation;
}

type XanoScriptCommandDependencies = {
  makeClient: (options: any) => Promise<{ client: any; workspace: number; branchId: number }>;
};

export function createXanoScriptCommand(
  program: Command,
  dependencies: XanoScriptCommandDependencies = { makeClient }
) {
  const xs = program.command("xanoscript").description("XanoScript generation");

  stdOptions(
    xs
      .command("generate")
      .description("Generate XanoScript for a single object")
      .argument("<type>", `Object type (${Object.keys(TYPE_TO_KIND).join(", ")})`)
      .argument("<id>", "Object ID")
  ).action(async (type, id, options) => {
    try {
      const { client, workspace, branchId } = await dependencies.makeClient(options);
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
      .description("Bulk export XanoScript objects to type-specific .xs directories")
      .option("--type <type>", `Export selector (${[...EXPORTABLE_XANOSCRIPT_TYPES, "all"].join(", ")})`)
      .option("--output-dir <dir>", "Output directory", "./xanoscript")
  ).action(async (options) => {
    try {
      if (!options.type) {
        console.error(`Error: --type required. Valid selectors: ${[...EXPORTABLE_XANOSCRIPT_TYPES, "all"].join(", ")}`);
        process.exitCode = 1;
        return;
      }
      if (!isExportSelector(options.type)) {
        console.error(`Error: Unknown type: ${options.type}. Valid selectors: ${[...EXPORTABLE_XANOSCRIPT_TYPES, "all"].join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const { client, workspace, branchId } = await dependencies.makeClient(options);
      const selectedTypes = selectExportTypes(options.type);

      let success = 0;
      let skipped = 0;
      let errors = 0;

      for (const type of selectedTypes) {
        const outputDir = resolve(options.outputDir, type);
        const claimedFilenames = new Set<string>();
        let typeSuccess = 0;
        let typeSkipped = 0;
        let typeErrors = 0;

        try {
          mkdirSync(outputDir, { recursive: true });
          console.log(`Fetching ${type} objects from workspace ${workspace}...\n`);
          const { items, nameField } = await fetchObjectsOfType(client, workspace, branchId, type);
          console.log(`Found ${items.length} ${type}(s). Generating XanoScript...\n`);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const name = item[nameField] || `unnamed_${item.id}`;
            process.stdout.write(`  [${i + 1}/${items.length}] ${name}...`);

            try {
              const kind = resolveKind(type, item);
              const result = await client.generateXanoScript(workspace, item, kind);

              if (result.status === "success" && result.payload?.output) {
                const { filename, disambiguated } = retainXanoScriptFile(
                  outputDir,
                  name,
                  item.id,
                  result.payload.output,
                  claimedFilenames
                );
                console.log(disambiguated ? ` ✅ ${filename} (collision disambiguated)` : ` ✅`);
                typeSuccess++;
              } else if (result.payload?.doIgnore) {
                console.log(` ⏭️  skipped`);
                typeSkipped++;
              } else {
                console.log(` ❌ ${result.payload?.message || "unknown error"}`);
                typeErrors++;
              }
            } catch (error: any) {
              console.log(` ❌ ${error.message}`);
              typeErrors++;
            }
          }
        } catch (error: any) {
          console.error(`Error exporting ${type}: ${error.message}`);
          typeErrors++;
        }

        success += typeSuccess;
        skipped += typeSkipped;
        errors += typeErrors;
        console.log(`\n${type}: ${typeSuccess} files retained, ${typeSkipped} skipped, ${typeErrors} errors`);
        console.log(`Output: ${outputDir}/\n`);
      }

      console.log(`Done: ${success} files retained, ${skipped} skipped, ${errors} errors`);
      if (errors > 0) {
        process.exitCode = 1;
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exitCode = 1;
    }
  });

  return xs;
}
