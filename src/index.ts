#!/usr/bin/env node

/**
 * StateChange CLI for Xano
 * Access private Xano APIs and performance insights
 */

import { Command } from "commander";
import { createXRayCommand } from "./commands/xray.js";
import { createPerformanceCommand } from "./commands/performance.js";
import { createAuditCommand } from "./commands/audit.js";
import { createSecureCommand } from "./commands/secure.js";
import { createAuthCommand } from "./commands/auth.js";
import { createInventoryCommand } from "./commands/inventory.js";
import { createHealthCommand } from "./commands/health.js";
import { createHistoryCommand } from "./commands/history.js";
import { createXanoScriptCommand } from "./commands/xanoscript.js";
import { createLogsCommand } from "./commands/logs.js";
import { flushSinkCache } from "./xano-client.js";

const program = new Command();

program
  .name("sc-xano")
  .description("StateChange CLI for Xano - workspace management, performance analysis, and operational insights")
  .version("0.2.0");

// Add subcommands
createAuthCommand(program);
createXRayCommand(program);
createPerformanceCommand(program);
createAuditCommand(program);
createSecureCommand(program);
createInventoryCommand(program);
createHealthCommand(program);
createHistoryCommand(program);
createXanoScriptCommand(program);
createLogsCommand(program);

// Utility: flush cached sink data
program
  .command("flush")
  .description("Flush cached sink data (forces fresh API calls)")
  .action(() => {
    flushSinkCache();
    console.log("Cache flushed.");
  });

program.parse(process.argv);
