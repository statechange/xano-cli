/**
 * Audit CLI Commands
 */

import { Command } from "commander";
import { analyzeAPI } from "@statechange/xano-xray";
import { makeClient } from "../registry-client.js";
import { FORMAT_HELP, parseFormat, outputFormatted } from "../format.js";

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--format <format>", FORMAT_HELP, "table");

export function createAuditCommand(program: Command) {
  const audit = program.command("audit").description("Audit commands");

  stdOptions(
    audit
      .command("workspace")
      .description("Audit workspace for issues")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
      log(`Auditing workspace ${workspace}...\n`);

      const { apps, queries } = await client.getAPIAppsAndQueries(workspace, branchId);
      log(`Found ${apps.length} apps and ${queries.length} queries\n`);

      const errors: Array<{ app: any; error: any }> = [];
      const warnings: Array<{ app: any; warning: any }> = [];

      for (const app of apps) {
        const analysis = analyzeAPI(app);
        analysis.errors.forEach((error: any) => errors.push({ app, error }));
        analysis.warnings.forEach((warning: any) => warnings.push({ app, warning }));
      }

      if (outputFormatted(format, {
        workspace_id: workspace,
        apps_scanned: apps.length,
        endpoints_scanned: queries.length,
        errors: errors.map(({ app, error }) => ({
          app_id: app.id,
          app_name: app.name,
          description: error.description,
        })),
        warnings: warnings.map(({ app, warning }) => ({
          app_id: app.id,
          app_name: app.name,
          description: warning.description,
        })),
      })) return;

      if (errors.length > 0) {
        console.log("Errors found:\n");
        errors.forEach(({ app, error }) => {
          console.log(`  App: ${app.name} (ID: ${app.id})`);
          console.log(`    ${error.description}\n`);
        });
      }

      if (warnings.length > 0) {
        console.log("Warnings found:\n");
        warnings.forEach(({ app, warning }) => {
          console.log(`  App: ${app.name} (ID: ${app.id})`);
          console.log(`    ${warning.description}\n`);
        });
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log("No issues found!");
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("swagger")
      .description("List apps with unsecured (public) Swagger")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const { apps } = await client.getAPIAppsAndQueries(workspace, branchId);
      const unsecured = apps.filter(
        (app: any) => app?.swagger && !app?.documentation?.require_token,
      );

      if (outputFormatted(format, {
        total_apps: apps.length,
        unsecured_swagger: unsecured.map((app: any) => ({
          id: app.id,
          name: app.name,
          description: app.description || null,
        })),
      })) return;

      if (unsecured.length === 0) {
        console.log("No unsecured Swagger apps found.");
        return;
      }
      console.log(`Unsecured Swagger (${unsecured.length}):\n`);
      unsecured.forEach((app: any) => {
        console.log(`  ${app.name} (ID: ${app.id})`);
        if (app.description) console.log(`    ${app.description}`);
      });
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("database")
      .description("Audit database tables (sizes, schemas, indexes)")
  ).action(async (options) => {
    try {
      const { client, workspace } = await makeClient(options);
      const format = parseFormat(options.format);
      const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
      log(`Auditing database tables for workspace ${workspace}...\n`);

      const sinkData = await client.getWorkspaceSink(workspace);
      const dbos = sinkData.dbos ?? [];
      log(`Found ${dbos.length} tables\n`);

      const tables = dbos.map((table: any) => {
        const columns = table.schema?.length ?? 0;
        const indexes = table.index?.length ?? 0;
        return {
          id: table.id,
          name: table.name,
          description: table.description || null,
          columns,
          indexes,
          missing_indexes: indexes === 0 && columns > 3,
        };
      });

      if (outputFormatted(format, {
        count: dbos.length,
        tables,
      })) return;

      for (const t of tables) {
        console.log(`  ${t.name} (ID: ${t.id})`);
        console.log(`    Columns: ${t.columns}, Indexes: ${t.indexes}`);
        if (t.missing_indexes) {
          console.log(`    Warning: No indexes defined on a table with ${t.columns} columns`);
        }
        if (t.description) console.log(`    ${t.description}`);
        console.log();
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("middleware")
      .description("List and audit middleware stacks")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);
      const middleware = await client.getMiddleware(workspace, branchId);

      if (outputFormatted(format, {
        count: middleware.length,
        middleware: middleware.map((mw: any) => ({
          id: mw.id,
          name: mw.name,
          description: mw.description || null,
        })),
      })) return;

      console.log(`Middleware (${middleware.length}):\n`);
      if (middleware.length === 0) {
        console.log("  No middleware found.");
        return;
      }
      for (const mw of middleware) {
        console.log(`  ${mw.name} (ID: ${mw.id})`);
        if (mw.description) console.log(`    Description: ${mw.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("addons")
      .description("List and audit addons")
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
          description: a.description || null,
        })),
      })) return;

      console.log(`Addons (${addons.length}):\n`);
      if (addons.length === 0) {
        console.log("  No addons found.");
        return;
      }
      for (const addon of addons) {
        console.log(`  ${addon.name} (ID: ${addon.id})`);
        if (addon.description) console.log(`    Description: ${addon.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("tasks")
      .description("Audit background tasks")
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
          description: t.description || null,
          schedule: t.schedule || null,
        })),
      })) return;

      console.log(`Background Tasks (${tasks.length}):\n`);
      if (tasks.length === 0) {
        console.log("  No tasks found.");
        return;
      }
      for (const task of tasks) {
        const schedule = task.schedule || "—";
        console.log(`  ${task.name} (ID: ${task.id})`);
        console.log(`    Schedule: ${schedule}`);
        if (task.description) console.log(`    Description: ${task.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("triggers")
      .description("Audit triggers")
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
          description: t.description || null,
        })),
      })) return;

      console.log(`Triggers (${triggers.length}):\n`);
      if (triggers.length === 0) {
        console.log("  No triggers found.");
        return;
      }
      for (const trigger of triggers) {
        const type = trigger.obj_type || "unknown";
        console.log(`  ${trigger.name} (ID: ${trigger.id}) [${type}]`);
        if (trigger.description) console.log(`    Description: ${trigger.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    audit
      .command("mcp-servers")
      .description("Audit MCP/toolset servers")
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
          description: s.description || null,
        })),
      })) return;

      console.log(`MCP Servers (${servers.length}):\n`);
      if (servers.length === 0) {
        console.log("  No MCP servers found.");
        return;
      }
      for (const server of servers) {
        console.log(`  ${server.name} (ID: ${server.id})`);
        if (server.description) console.log(`    Description: ${server.description}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  return audit;
}
