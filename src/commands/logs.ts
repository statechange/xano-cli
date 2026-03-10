/**
 * Log Retention CLI Commands — View and update history/logging settings
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { makeClient } from "../registry-client.js";
import { FORMAT_HELP, parseFormat, outputFormatted, toYaml } from "../format.js";

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key")
    .option("--format <format>", FORMAT_HELP, "table");

interface HistorySettings {
  inherit?: boolean;
  enabled?: boolean;
  limit?: number;
  // App-level fields
  query_enabled?: boolean;
  query_limit?: number;
}

function formatLimit(limit: number | undefined): string {
  if (limit === -1) return "unlimited";
  if (limit === 0) return "disabled";
  if (limit == null) return "default";
  return `${limit}`;
}

function historyToRecord(obj: any, type: string) {
  const h: HistorySettings = obj.history || {};
  return {
    id: obj.id,
    name: obj.name || obj.canonical || `${type} ${obj.id}`,
    type,
    description: obj.description || undefined,
    history_inherit: h.inherit ?? true,
    history_enabled: type === "app" ? (h.query_enabled ?? true) : (h.enabled ?? true),
    history_limit: type === "app" ? (h.query_limit ?? 100) : (h.limit ?? 100),
  };
}

async function showSingleObject(
  client: XanoClient,
  type: string,
  id: number,
  workspace: number,
  branchId: number,
) {
  const { apps, queries } = await client.getAPIAppsAndQueries(workspace, branchId);

  if (type === "endpoint") {
    const query = queries.find((q: any) => q.id === id);
    if (!query) throw new Error(`Endpoint ${id} not found in workspace`);
    const h = query.history || {};
    const parentApp = apps.find((a: any) => a.id === query.app?.id);
    const parentHistory = parentApp?.history || {};
    const effectiveLimit = h.inherit
      ? (parentHistory.query_limit ?? 100)
      : (h.limit ?? 100);

    return {
      type: "endpoint",
      id: query.id,
      name: query.name,
      description: query.description || undefined,
      history: {
        inherit: h.inherit ?? true,
        enabled: h.enabled ?? true,
        limit: h.limit ?? 100,
      },
      parent_app: parentApp ? {
        id: parentApp.id,
        name: parentApp.name,
        history: {
          inherit: parentHistory.inherit ?? true,
          query_enabled: parentHistory.query_enabled ?? true,
          query_limit: parentHistory.query_limit ?? 100,
        },
      } : undefined,
      effective_limit: effectiveLimit,
    };
  }

  if (type === "app") {
    const app = apps.find((a: any) => a.id === id);
    if (!app) throw new Error(`App ${id} not found in workspace`);
    const h = app.history || {};
    const appQueries = queries.filter((q: any) => q.app?.id === id);
    return {
      type: "app",
      id: app.id,
      name: app.name,
      description: app.description || undefined,
      history: {
        inherit: h.inherit ?? true,
        query_enabled: h.query_enabled ?? true,
        query_limit: h.query_limit ?? 100,
      },
      endpoints: appQueries.map((q: any) => {
        const qh = q.history || {};
        return {
          id: q.id,
          name: q.name,
          history_inherit: qh.inherit ?? true,
          history_enabled: qh.enabled ?? true,
          history_limit: qh.limit ?? 100,
          effective_limit: (qh.inherit ?? true) ? (h.query_limit ?? 100) : (qh.limit ?? 100),
        };
      }),
    };
  }

  if (type === "task") {
    const tasks = await client.getTasks(workspace, branchId);
    const task = tasks.find((t: any) => t.id === id);
    if (!task) throw new Error(`Task ${id} not found`);
    const h = task.history || {};
    return {
      type: "task",
      id: task.id,
      name: task.name,
      description: task.description || undefined,
      history: {
        inherit: h.inherit ?? true,
        enabled: h.enabled ?? true,
        limit: h.limit ?? 100,
      },
      effective_limit: h.limit ?? 100,
    };
  }

  // trigger
  const triggers = await client.getTriggers(workspace, branchId);
  const trigger = triggers.find((t: any) => t.id === id);
  if (!trigger) throw new Error(`Trigger ${id} not found`);
  const h = trigger.history || {};
  return {
    type: "trigger",
    id: trigger.id,
    name: trigger.name,
    description: trigger.description || undefined,
    history: {
      inherit: h.inherit ?? true,
      enabled: h.enabled ?? true,
      limit: h.limit ?? 100,
    },
    effective_limit: h.limit ?? 100,
  };
}

export function createLogsCommand(program: Command) {
  const logs = program
    .command("logs")
    .description("View and manage history/logging retention settings (set is WRITE)");

  // --- logs show: display settings for a specific object or list all ---
  stdOptions(
    logs
      .command("show")
      .description("Show history retention settings. Use with <type> <id> for a single object, or --type/--custom-only to list.")
      .argument("[type]", "Object type: endpoint, task, trigger, or app")
      .argument("[id]", "Object ID")
      .option("--type <type>", "Filter list by type: app, endpoint, task, trigger, all", "all")
      .option("--custom-only", "Only show objects with non-default settings")
  ).action(async (argType, argId, options) => {
    try {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);

      // Single-object mode: logs show endpoint 1025
      if (argType && argId) {
        if (!["endpoint", "task", "trigger", "app"].includes(argType)) {
          console.error("Error: type must be endpoint, task, trigger, or app");
          process.exit(1);
        }

        const objectId = parseInt(argId);
        const result = await showSingleObject(client, argType, objectId, workspace, branchId);

        if (outputFormatted(format, result)) return;

        // Table format
        console.log(`\n${result.type} "${result.name}" (ID: ${result.id}):\n`);
        const h = result.history as any;
        if (result.type === "app") {
          console.log(`  query_enabled: ${h.query_enabled ? "on" : "OFF"}`);
          console.log(`  query_limit:   ${formatLimit(h.query_limit)}`);
          console.log(`  inherit:       ${h.inherit ? "yes" : "no (custom)"}`);
          if (result.endpoints && result.endpoints.length > 0) {
            console.log(`\n  Endpoints (${result.endpoints.length}):\n`);
            for (const ep of result.endpoints) {
              const effStr = formatLimit(ep.effective_limit);
              const inhStr = ep.history_inherit ? "inherit" : "custom";
              console.log(`    ${ep.name} (ID: ${ep.id}) — limit: ${formatLimit(ep.history_limit)} (${inhStr}) → effective: ${effStr}`);
            }
          }
        } else {
          console.log(`  enabled:  ${h.enabled ? "on" : "OFF"}`);
          console.log(`  limit:    ${formatLimit(h.limit)}`);
          console.log(`  inherit:  ${h.inherit ? "yes (from parent app)" : "no (custom)"}`);
          if (result.parent_app) {
            const pa = result.parent_app;
            console.log(`\n  Parent app: "${pa.name}" (ID: ${pa.id})`);
            console.log(`    query_enabled: ${pa.history.query_enabled ? "on" : "OFF"}`);
            console.log(`    query_limit:   ${formatLimit(pa.history.query_limit)}`);
          }
          if (result.effective_limit != null) {
            const suffix = h.inherit && result.parent_app ? " (inherited from app)" : "";
            console.log(`\n  Effective limit: ${formatLimit(result.effective_limit)}${suffix}`);
          }
        }
        return;
      }

      // List mode
      const type = options.type;
      const customOnly = options.customOnly || false;

      const records: ReturnType<typeof historyToRecord>[] = [];

      if (type === "all" || type === "app") {
        const { apps } = await client.getAPIAppsAndQueries(workspace, branchId);
        for (const app of apps) {
          records.push(historyToRecord(app, "app"));
        }
      }

      if (type === "all" || type === "endpoint") {
        const { queries } = await client.getAPIAppsAndQueries(workspace, branchId);
        for (const q of queries) {
          records.push(historyToRecord(q, "endpoint"));
        }
      }

      if (type === "all" || type === "task") {
        const tasks = await client.getTasks(workspace, branchId);
        for (const t of tasks) {
          records.push(historyToRecord(t, "task"));
        }
      }

      if (type === "all" || type === "trigger") {
        const triggers = await client.getTriggers(workspace, branchId);
        for (const t of triggers) {
          records.push(historyToRecord(t, "trigger"));
        }
      }

      const filtered = customOnly
        ? records.filter(r => r.history_limit !== 100 || !r.history_inherit || !r.history_enabled)
        : records;

      if (outputFormatted(format, { objects: filtered, total: filtered.length })) return;

      // Table format
      if (filtered.length === 0) {
        console.log("No objects found" + (customOnly ? " with custom history settings." : "."));
        return;
      }

      console.log(`History retention settings${customOnly ? " (custom only)" : ""}:\n`);
      for (const r of filtered) {
        const enabledStr = r.history_enabled ? "on" : "OFF";
        const limitStr = formatLimit(r.history_limit);
        const inheritStr = r.history_inherit ? "inherit" : "custom";
        console.log(`  [${r.type}] ${r.name} (ID: ${r.id})`);
        console.log(`    enabled: ${enabledStr}  |  limit: ${limitStr}  |  ${inheritStr}`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  // --- logs set: update history settings for a specific object ---
  stdOptions(
    logs
      .command("set")
      .description("WRITE: Update history retention for an endpoint, task, or trigger")
      .argument("<type>", "Object type: endpoint, task, trigger, or app")
      .argument("<id>", "Object ID")
      .option("--limit <n>", "Stack retention limit: number, -1 (unlimited), or 0 (disabled)")
      .option("--enabled <bool>", "Enable/disable history recording (true/false)")
      .option("--inherit <bool>", "Inherit from parent app (true/false)")
  ).action(async (type, id, options) => {
    if (!["endpoint", "task", "trigger", "app"].includes(type)) {
      console.error("Error: type must be endpoint, task, trigger, or app");
      process.exit(1);
    }

    if (options.limit == null && options.enabled == null && options.inherit == null) {
      console.error("Error: provide at least one of --limit, --enabled, or --inherit");
      process.exit(1);
    }

    const { client, workspace, branchId } = await makeClient(options);
    const format = parseFormat(options.format);
    const objectId = parseInt(id);

    try {
      let obj: any;
      let before: any;

      if (type === "endpoint") {
        obj = await client.getQuery(objectId);
      } else if (type === "task") {
        const tasks = await client.getTasks(workspace, branchId);
        obj = tasks.find((t: any) => t.id === objectId);
        if (!obj) throw new Error(`Task ${objectId} not found`);
      } else if (type === "trigger") {
        const triggers = await client.getTriggers(workspace, branchId);
        obj = triggers.find((t: any) => t.id === objectId);
        if (!obj) throw new Error(`Trigger ${objectId} not found`);
      } else {
        obj = await client.getApp(objectId, branchId);
      }

      before = { ...(obj.history || {}) };

      // Apply changes
      if (!obj.history) obj.history = {};

      if (options.limit != null) {
        const limit = parseInt(options.limit);
        if (type === "app") {
          obj.history.query_limit = limit;
        } else {
          obj.history.limit = limit;
        }
      }

      if (options.enabled != null) {
        const enabled = options.enabled === "true";
        if (type === "app") {
          obj.history.query_enabled = enabled;
        } else {
          obj.history.enabled = enabled;
        }
      }

      if (options.inherit != null) {
        obj.history.inherit = options.inherit === "true";
      }

      // Save
      if (type === "endpoint") {
        await client.updateQuery(obj);
      } else if (type === "task") {
        await client.updateTask(obj);
      } else if (type === "trigger") {
        await client.updateTrigger(obj);
      } else {
        await client.updateApp(obj);
      }

      const after = obj.history;
      const result = {
        type,
        id: objectId,
        name: obj.name || obj.canonical || `${type} ${objectId}`,
        before,
        after,
      };

      if (outputFormatted(format, result)) return;

      console.log(`Updated ${type} ${objectId} (${result.name}):`);
      console.log(`  Before: ${JSON.stringify(before)}`);
      console.log(`  After:  ${JSON.stringify(after)}`);
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  // --- logs watch: monitor history changes in real-time ---
  stdOptions(
    logs
      .command("watch")
      .description("Poll and display new request history entries for an endpoint")
      .argument("<type>", "Object type: endpoint, task, or trigger")
      .argument("<id>", "Object ID")
      .option("--interval <seconds>", "Poll interval in seconds", "5")
  ).action(async (type, id, options) => {
    if (!["endpoint", "task", "trigger"].includes(type)) {
      console.error("Error: type must be endpoint, task, or trigger");
      process.exit(1);
    }

    const { client, workspace, branchId } = await makeClient(options);
    const objectId = parseInt(id);
    const intervalMs = parseInt(options.interval) * 1000;
    let lastSeenId = 0;

    console.log(`Watching ${type} ${objectId} for new executions (poll every ${options.interval}s)...`);
    console.log(`Press Ctrl+C to stop.\n`);

    const poll = async () => {
      try {
        let result: { items: any[] };
        if (type === "endpoint") {
          result = await client.getRequestHistoryForQuery(objectId, 1, branchId);
        } else if (type === "task") {
          result = await client.getTaskHistory(objectId, 1);
        } else {
          result = await client.getTriggerHistory(objectId, branchId, 1);
        }

        if (!result.items || result.items.length === 0) return;

        // On first poll, just record the latest ID
        if (lastSeenId === 0) {
          lastSeenId = result.items[0].id;
          console.log(`  (baseline: latest ID is ${lastSeenId})`);
          return;
        }

        // Show new items
        const newItems = result.items.filter((item: any) => item.id > lastSeenId);
        if (newItems.length > 0) {
          lastSeenId = Math.max(...newItems.map((i: any) => i.id));
          for (const item of newItems.reverse()) {
            const dur = item.duration != null ? `${item.duration.toFixed(3)}s` : "?";
            const status = item.status ?? "—";
            const verb = item.verb || "";
            const truncated = item.stack_maxed ? " [TRUNCATED]" : "";
            const date = new Date(item.created_at).toLocaleTimeString();
            console.log(`  ${date}  [${item.id}] ${verb} ${status} (${dur})${truncated}`);
          }
        }
      } catch (error: any) {
        console.error(`  Poll error: ${error.message}`);
      }
    };

    await poll();
    const timer = setInterval(poll, intervalMs);

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      clearInterval(timer);
      console.log("\nStopped watching.");
      process.exit(0);
    });

    // Keep alive
    await new Promise(() => {});
  });

  return logs;
}
