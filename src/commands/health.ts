/**
 * Health CLI Commands — Instance health & database management via api:master
 */

import { Command } from "commander";
import { XanoMasterClient } from "../xano-client.js";
import { resolveMasterToken } from "../registry-client.js";

async function makeMasterClient(options: any) {
  const token = await resolveMasterToken({
    token: options.masterToken,
    apiKey: options.apiKey,
  });
  if (!token) {
    console.error(
      "Error: Xano master token required (--master-token, XANO_MASTER_TOKEN, or StateChange backend via 'sc-xano auth init')"
    );
    process.exit(1);
  }
  return new XanoMasterClient({ token });
}

function resolveInstanceId(options: any): number {
  const id = parseInt(options.instanceId || process.env.XANO_INSTANCE_ID || "0");
  if (!id) {
    console.error("Error: Instance ID required (--instance-id or XANO_INSTANCE_ID env var)");
    process.exit(1);
  }
  return id;
}

const masterOptions = (cmd: Command) =>
  cmd
    .option("--master-token <token>", "Xano master token (from app.xano.com)")
    .option("--api-key <key>", "StateChange API key (overrides saved key)");

export function createHealthCommand(program: Command) {
  const health = program.command("health").description("Instance health & database management");

  masterOptions(
    health
      .command("instances")
      .description("List all Xano instances with status")
  ).action(async (options) => {
    try {
      const master = await makeMasterClient(options);
      const instances = await master.getInstances();
      console.log(`Instances (${instances.length}):\n`);
      for (const inst of instances) {
        const role = inst.membership?.role || "unknown";
        console.log(`  ${inst.display || inst.name} (ID: ${inst.id}) — ${inst.status} [${role}]`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  masterOptions(
    health
      .command("database")
      .description("Show history database sizes")
      .option("--instance-id <id>", "Xano instance ID")
  ).action(async (options) => {
    try {
      const master = await makeMasterClient(options);
      const instanceId = resolveInstanceId(options);
      console.log(`Fetching database sizes for instance ${instanceId}...\n`);
      const databases = await master.getInstanceDatabases(instanceId);

      console.log("History Database Sizes:");
      for (const [key, value] of Object.entries(databases) as [string, any][]) {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(`  ${label}: ${value.size} (${value.row_count} rows)`);
      }
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  masterOptions(
    health
      .command("clear-history")
      .description("Clear history databases")
      .option("--instance-id <id>", "Xano instance ID")
      .option("--tables <tables>", "Comma-separated table names to clear (default: all)", "")
      .option("--force", "Force clear even if large", false)
  ).action(async (options) => {
    try {
      const master = await makeMasterClient(options);
      const instanceId = resolveInstanceId(options);

      const allTables = [
        "function_history",
        "middleware_history",
        "request_history",
        "trigger_history",
        "task_history",
      ];

      const tables = options.tables
        ? options.tables.split(",").map((t: string) => t.trim())
        : allTables;

      console.log(`Clearing history databases for instance ${instanceId}...`);
      console.log(`  Tables: ${tables.join(", ")}`);
      console.log(`  Force: ${options.force}\n`);

      await master.clearInstanceDatabases(instanceId, tables, options.force);
      console.log("✅ History databases cleared successfully.");
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  masterOptions(
    health
      .command("restart-tasks")
      .description("Restart the task service deployment")
      .option("--instance-id <id>", "Xano instance ID")
  ).action(async (options) => {
    try {
      const master = await makeMasterClient(options);
      const instanceId = resolveInstanceId(options);

      console.log(`Restarting task deployment for instance ${instanceId}...`);
      await master.restartDeployment(instanceId, "task");
      console.log("✅ Task service restarted successfully.");
    } catch (error: any) {
      console.error("Error:", error.message);
      process.exit(1);
    }
  });

  return health;
}
