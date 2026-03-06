/**
 * History CLI Commands — Execution history browser
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
  const token = await resolveXanoToken({ instance, token: options.token, apiKey: options.apiKey });
  if (!token) {
    console.error("Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')");
    process.exit(1);
  }
  return { client: new XanoClient({ instance, token }) };
}

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--format <format>", FORMAT_HELP, "table");

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleString();
}

function historyItemToRecord(item: any) {
  return {
    id: item.id,
    verb: item.verb || null,
    uri: item.uri || null,
    status: item.status ?? null,
    duration_ms: item.duration ?? null,
    created_at: item.created_at || null,
  };
}

function printHistoryItems(items: any[]) {
  for (const item of items) {
    const status = item.status ?? "—";
    const duration = item.duration != null ? formatDuration(item.duration) : "—";
    const date = item.created_at ? formatDate(item.created_at) : "—";
    const verb = item.verb || "";
    const uri = item.uri || "";
    console.log(`  [${item.id}] ${verb} ${uri} — ${status} (${duration}) ${date}`);
  }
}

export function createHistoryCommand(program: Command) {
  const history = program.command("history").description("Execution history browser");

  stdOptions(
    history
      .command("requests")
      .description("List recent API requests for workspace")
      .option("--workspace <workspace>", "Workspace ID")
      .option("--branch <branch>", "Branch ID", "-1")
      .option("--page <page>", "Page number", "1")
  ).action(async (options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const workspace = await resolveWorkspace({ workspace: options.workspace, apiKey: options.apiKey });
      if (!workspace) {
        console.error("Error: Workspace ID required (--workspace or XANO_WORKSPACE env var)");
        process.exit(1);
      }
      const page = parseInt(options.page);
      const branchId = parseInt(options.branch);

      const result = await client.getRequestHistory(workspace, page, branchId);

      if (outputFormatted(format, {
        page: result.curPage,
        next_page: result.nextPage ?? null,
        items: result.items.map(historyItemToRecord),
      })) return;

      console.log(`Request History (page ${result.curPage}):\n`);
      printHistoryItems(result.items);
      if (result.nextPage) {
        console.log(`\n  Next page: --page ${result.nextPage}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    history
      .command("request")
      .description("Show detailed request info")
      .argument("<id>", "Request ID")
  ).action(async (id, options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const requestId = parseInt(id);
      const req = await client.getRequest(requestId);

      if (outputFormatted(format, {
        id: req.id,
        verb: req.verb || null,
        uri: req.uri || null,
        status: req.status ?? null,
        duration_ms: req.duration ?? null,
        ip: req.ip || null,
        created_at: req.created_at || null,
        input_size_bytes: req.input_size ?? null,
        input: req.input ?? null,
        stack_truncated: req.stack_maxed || false,
        stack: req.stack?.map((step: any) => ({
          name: step.name || step.type || "step",
          duration_ms: step.duration ?? null,
        })) ?? [],
      })) return;

      console.log(`Request ${req.id}:`);
      console.log(`  Verb:     ${req.verb || "—"}`);
      console.log(`  URI:      ${req.uri || "—"}`);
      console.log(`  Status:   ${req.status ?? "—"}`);
      console.log(`  Duration: ${req.duration != null ? formatDuration(req.duration) : "—"}`);
      console.log(`  IP:       ${req.ip || "—"}`);
      console.log(`  Date:     ${req.created_at ? formatDate(req.created_at) : "—"}`);

      if (req.input != null) {
        console.log(`\n  Input (${req.input_size ?? 0} bytes):`);
        console.log(`    ${JSON.stringify(req.input, null, 2).split("\n").join("\n    ")}`);
      }

      if (req.stack && req.stack.length > 0) {
        console.log(`\n  Stack (${req.stack.length} steps${req.stack_maxed ? ", truncated" : ""}):`);
        for (const step of req.stack) {
          const name = step.name || step.type || "step";
          const dur = step.duration != null ? formatDuration(step.duration) : "";
          console.log(`    ${name} ${dur}`);
        }
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    history
      .command("tasks")
      .description("List task execution history")
      .argument("<task-id>", "Task ID")
      .option("--page <page>", "Page number", "1")
  ).action(async (taskId, options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const id = parseInt(taskId);
      const page = parseInt(options.page);
      const result = await client.getTaskHistory(id, page);

      if (outputFormatted(format, {
        task_id: id,
        page: result.curPage,
        next_page: result.nextPage ?? null,
        items: result.items.map(historyItemToRecord),
      })) return;

      console.log(`Task ${id} History (page ${result.curPage}):\n`);
      printHistoryItems(result.items);
      if (result.nextPage) {
        console.log(`\n  Next page: --page ${result.nextPage}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    history
      .command("task-run")
      .description("Show detailed task run")
      .argument("<task-id>", "Task ID")
      .argument("<run-id>", "Run ID")
  ).action(async (taskId, runId, options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const req = await client.getTaskHistoryItem(parseInt(taskId), parseInt(runId));

      if (outputFormatted(format, {
        id: req.id,
        task_id: parseInt(taskId),
        status: req.status ?? null,
        duration_ms: req.duration ?? null,
        created_at: req.created_at || null,
        stack_truncated: req.stack_maxed || false,
        stack: req.stack?.map((step: any) => ({
          name: step.name || step.type || "step",
          duration_ms: step.duration ?? null,
        })) ?? [],
      })) return;

      console.log(`Task Run ${req.id}:`);
      console.log(`  Status:   ${req.status ?? "—"}`);
      console.log(`  Duration: ${req.duration != null ? formatDuration(req.duration) : "—"}`);
      console.log(`  Date:     ${req.created_at ? formatDate(req.created_at) : "—"}`);

      if (req.stack && req.stack.length > 0) {
        console.log(`\n  Stack (${req.stack.length} steps${req.stack_maxed ? ", truncated" : ""}):`);
        for (const step of req.stack) {
          const name = step.name || step.type || "step";
          const dur = step.duration != null ? formatDuration(step.duration) : "";
          console.log(`    ${name} ${dur}`);
        }
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    history
      .command("triggers")
      .description("List trigger execution history")
      .argument("<trigger-id>", "Trigger ID")
      .option("--branch <branch>", "Branch ID", "0")
      .option("--page <page>", "Page number", "1")
  ).action(async (triggerId, options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const id = parseInt(triggerId);
      const branchId = parseInt(options.branch);
      const page = parseInt(options.page);
      const result = await client.getTriggerHistory(id, branchId, page);

      if (outputFormatted(format, {
        trigger_id: id,
        page: result.curPage,
        next_page: result.nextPage ?? null,
        items: result.items.map(historyItemToRecord),
      })) return;

      console.log(`Trigger ${id} History (page ${result.curPage}):\n`);
      printHistoryItems(result.items);
      if (result.nextPage) {
        console.log(`\n  Next page: --page ${result.nextPage}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  stdOptions(
    history
      .command("mcp-servers")
      .description("List MCP server execution history")
      .argument("<tool-id>", "MCP Server / Toolset ID")
      .option("--branch <branch>", "Branch ID", "0")
      .option("--page <page>", "Page number", "1")
  ).action(async (toolId, options) => {
    try {
      const { client } = await makeClient(options);
      const format = parseFormat(options.format);
      const id = parseInt(toolId);
      const branchId = parseInt(options.branch);
      const page = parseInt(options.page);
      const result = await client.getMCPServerHistory(id, branchId, page);

      if (outputFormatted(format, {
        tool_id: id,
        page: result.curPage,
        next_page: result.nextPage ?? null,
        items: result.items.map(historyItemToRecord),
      })) return;

      console.log(`MCP Server ${id} History (page ${result.curPage}):\n`);
      printHistoryItems(result.items);
      if (result.nextPage) {
        console.log(`\n  Next page: --page ${result.nextPage}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  return history;
}
