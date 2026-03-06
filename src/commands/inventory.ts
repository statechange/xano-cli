/**
 * Inventory CLI Commands — Workspace object overview
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { resolveXanoToken, resolveInstance, resolveWorkspace } from "../registry-client.js";
import { FORMAT_HELP, parseFormat, outputFormatted } from "../format.js";

async function makeClient(options: any) {
  const instance = await resolveInstance({ instance: options.instance, apiKey: options.apiKey });
  if (!instance) {
    console.error("Error: Xano instance required (--instance or XANO_INSTANCE env var)");
    process.exit(1);
  }
  const workspace = await resolveWorkspace({ workspace: options.workspace, apiKey: options.apiKey });
  if (!workspace) {
    console.error("Error: Workspace ID required (--workspace or XANO_WORKSPACE env var)");
    process.exit(1);
  }
  const branchId = parseInt(options.branch || "0");
  const token = await resolveXanoToken({ instance, token: options.token, apiKey: options.apiKey });
  if (!token) {
    console.error("Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')");
    process.exit(1);
  }
  return { client: new XanoClient({ instance, token }), workspace, branchId };
}

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--format <format>", FORMAT_HELP, "table");

function pickFields(obj: any, fields: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const f of fields) {
    if (obj[f] !== undefined && obj[f] !== null && obj[f] !== "") {
      result[f] = obj[f];
    }
  }
  return result;
}

export function createInventoryCommand(program: Command) {
  const inventory = program.command("inventory").description("Workspace object inventory");

  stdOptions(
    inventory
      .command("workspace")
      .description("Show counts of all workspace objects")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
      log(`Fetching inventory for workspace ${workspace}...\n`);

      const [
        { apps, queries },
        { functions },
        sinkData,
        tasks,
        triggers,
        addons,
        middleware,
        mcpServers,
      ] = await Promise.all([
        client.getAPIAppsAndQueries(workspace, branchId),
        client.getFunctions(workspace, branchId),
        client.getWorkspaceSink(workspace),
        client.getTasks(workspace, branchId),
        client.getTriggers(workspace, branchId),
        client.getAddons(workspace, branchId),
        client.getMiddleware(workspace, branchId),
        client.getMCPServers(workspace, branchId),
      ]);

      const data = {
        workspace_id: workspace,
        branch_id: branchId,
        counts: {
          api_groups: apps.length,
          endpoints: queries.length,
          functions: functions.length,
          tables: sinkData.dbos?.length ?? 0,
          tasks: tasks.length,
          triggers: triggers.length,
          addons: addons.length,
          middleware: middleware.length,
          mcp_servers: mcpServers.length,
        },
      };

      if (outputFormatted(format, data)) return;

      console.log("Workspace Inventory:");
      console.log(`  API Groups:     ${data.counts.api_groups}`);
      console.log(`  Endpoints:      ${data.counts.endpoints}`);
      console.log(`  Functions:      ${data.counts.functions}`);
      console.log(`  Tables:         ${data.counts.tables}`);
      console.log(`  Tasks:          ${data.counts.tasks}`);
      console.log(`  Triggers:       ${data.counts.triggers}`);
      console.log(`  Addons:         ${data.counts.addons}`);
      console.log(`  Middleware:      ${data.counts.middleware}`);
      console.log(`  MCP Servers:    ${data.counts.mcp_servers}`);
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("functions")
      .description("List all functions with tags")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const { functions } = await client.getFunctions(workspace, branchId);

      if (outputFormatted(format, {
        count: functions.length,
        functions: functions.map((fn: any) => ({
          id: fn.id,
          name: fn.name,
          ...pickFields(fn, ["description"]),
          tags: fn.tag?.map((t: any) => t.tag) || [],
        })),
      })) return;

      console.log(`Functions (${functions.length}):\n`);
      for (const fn of functions) {
        const tags = fn.tag?.map((t: any) => t.tag).join(", ") || "";
        console.log(`  ${fn.name} (ID: ${fn.id})${tags ? ` [${tags}]` : ""}`);
        if (fn.description) console.log(`    ${fn.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("tables")
      .description("List all database tables")
  ).action(async (options) => {
    try {
      const { client, workspace } = await makeClient(options);
      const format = parseFormat(options.format);
      const sinkData = await client.getWorkspaceSink(workspace);
      const dbos = sinkData.dbos ?? [];

      if (outputFormatted(format, {
        count: dbos.length,
        tables: dbos.map((t: any) => ({
          id: t.id,
          name: t.name,
          ...pickFields(t, ["description"]),
          columns: t.schema?.length ?? 0,
          indexes: t.index?.length ?? 0,
        })),
      })) return;

      console.log(`Tables (${dbos.length}):\n`);
      for (const table of dbos) {
        console.log(`  ${table.name} (ID: ${table.id})`);
        if (table.description) console.log(`    ${table.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("tasks")
      .description("List all background tasks")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const tasks = await client.getTasks(workspace, branchId);

      if (outputFormatted(format, {
        count: tasks.length,
        tasks: tasks.map((t: any) => ({
          id: t.id,
          name: t.name,
          ...pickFields(t, ["description", "schedule"]),
        })),
      })) return;

      console.log(`Tasks (${tasks.length}):\n`);
      for (const task of tasks) {
        console.log(`  ${task.name} (ID: ${task.id})`);
        if (task.schedule) console.log(`    Schedule: ${task.schedule}`);
        if (task.description) console.log(`    ${task.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("triggers")
      .description("List all triggers")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const triggers = await client.getTriggers(workspace, branchId);

      if (outputFormatted(format, {
        count: triggers.length,
        triggers: triggers.map((t: any) => ({
          id: t.id,
          name: t.name,
          type: t.obj_type || "unknown",
          ...pickFields(t, ["description"]),
        })),
      })) return;

      console.log(`Triggers (${triggers.length}):\n`);
      for (const trigger of triggers) {
        const type = trigger.obj_type || "unknown";
        console.log(`  ${trigger.name} (ID: ${trigger.id}) [${type}]`);
        if (trigger.description) console.log(`    ${trigger.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("addons")
      .description("List all addons")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const addons = await client.getAddons(workspace, branchId);

      if (outputFormatted(format, {
        count: addons.length,
        addons: addons.map((a: any) => ({
          id: a.id,
          name: a.name,
          ...pickFields(a, ["description"]),
        })),
      })) return;

      console.log(`Addons (${addons.length}):\n`);
      for (const addon of addons) {
        console.log(`  ${addon.name} (ID: ${addon.id})`);
        if (addon.description) console.log(`    ${addon.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("middleware")
      .description("List all middleware")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const middleware = await client.getMiddleware(workspace, branchId);

      if (outputFormatted(format, {
        count: middleware.length,
        middleware: middleware.map((m: any) => ({
          id: m.id,
          name: m.name,
          ...pickFields(m, ["description"]),
        })),
      })) return;

      console.log(`Middleware (${middleware.length}):\n`);
      for (const mw of middleware) {
        console.log(`  ${mw.name} (ID: ${mw.id})`);
        if (mw.description) console.log(`    ${mw.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    inventory
      .command("mcp-servers")
      .description("List all MCP/toolset servers")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const servers = await client.getMCPServers(workspace, branchId);

      if (outputFormatted(format, {
        count: servers.length,
        mcp_servers: servers.map((s: any) => ({
          id: s.id,
          name: s.name,
          ...pickFields(s, ["description"]),
        })),
      })) return;

      console.log(`MCP Servers (${servers.length}):\n`);
      for (const server of servers) {
        console.log(`  ${server.name} (ID: ${server.id})`);
        if (server.description) console.log(`    ${server.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  return inventory;
}
