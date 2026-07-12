/**
 * Markdown documentation — ported from parcel-test-2 documentation pipeline
 */

import { Command } from "commander";
import { writeFileSync } from "fs";
import { makeClient } from "../registry-client.js";
import {
  loadDocsInventory,
  makeDocumentation,
  makeAPIDocumentation,
  makeQueryAPIDocumentation,
  makeFunctionDocumentation,
  makeTaskDocumentation,
  makeTriggerDocumentation,
  type ShowStepsOptions,
} from "../documentation/index.js";

const stdOptions = (cmd: Command) =>
  cmd
    .option("--instance <instance>", "Xano instance (e.g., xq1a-abcd-1234.xano.io)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("-o, --output <file>", "Write Markdown to file instead of stdout")
    .option("--no-steps", "Omit per-object function stack steps")
    .option("--no-internals", "Omit step inputs, filters, and internal wiring details")
    .option("--no-inputs", "Omit stack input schema sections")
    .option("--no-outputs", "Omit stack output sections");

function parseShowSteps(opts: {
  noSteps?: boolean;
  noInternals?: boolean;
  noInputs?: boolean;
  noOutputs?: boolean;
}): ShowStepsOptions {
  return {
    steps: !opts.noSteps,
    inputs: !opts.noInputs,
    outputs: !opts.noOutputs,
    internals: !opts.noInternals,
  };
}

function writeOut(path: string | undefined, md: string) {
  if (path) {
    writeFileSync(path, md, "utf-8");
    console.error(`Wrote ${path} (${md.length} characters)`);
  } else {
    process.stdout.write(md);
    if (!md.endsWith("\n")) process.stdout.write("\n");
  }
}

export function createDocsCommand(program: Command) {
  const docs = program.command("docs").description("Generate Markdown workspace documentation (read-only)");

  stdOptions(
    docs
      .command("workspace")
      .description("Full workspace: APIs, tasks, triggers, functions, toolsets")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const showSteps = parseShowSteps(options);
      const md = makeDocumentation(inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  stdOptions(
    docs
      .command("api")
      .description("One API group and all of its endpoints")
      .requiredOption("--app-id <id>", "API group (app) ID")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      const appId = parseInt(options.appId, 10);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const showSteps = parseShowSteps(options);
      const md = makeAPIDocumentation(appId, inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  stdOptions(
    docs
      .command("endpoint")
      .description("Single API endpoint (query)")
      .requiredOption("--id <id>", "Query / endpoint ID")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      const queryId = parseInt(options.id, 10);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const query = inventory.queries?.find((q: any) => q.id === queryId);
      if (!query) {
        console.error(`Error: No query with id ${queryId} in workspace sink`);
        process.exit(1);
      }
      const showSteps = parseShowSteps(options);
      const md = makeQueryAPIDocumentation(query, inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  stdOptions(
    docs
      .command("function")
      .description("Single function")
      .requiredOption("--id <id>", "Function ID")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      const id = parseInt(options.id, 10);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const func = inventory.functions?.find((f: any) => f.id === id);
      if (!func) {
        console.error(`Error: No function with id ${id} in workspace sink`);
        process.exit(1);
      }
      const showSteps = parseShowSteps(options);
      const md = makeFunctionDocumentation(func, inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  stdOptions(
    docs
      .command("task")
      .description("Single scheduled task")
      .requiredOption("--id <id>", "Task ID")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      const id = parseInt(options.id, 10);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const task = inventory.tasks?.find((t: any) => t.id === id);
      if (!task) {
        console.error(`Error: No task with id ${id} in workspace sink`);
        process.exit(1);
      }
      const showSteps = parseShowSteps(options);
      const md = makeTaskDocumentation(task, inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  stdOptions(
    docs
      .command("trigger")
      .description("Single database trigger")
      .requiredOption("--id <id>", "Trigger ID")
  ).action(async (options) => {
    try {
      const { client, workspace, branchId, instance } = await makeClient(options);
      const id = parseInt(options.id, 10);
      console.error("Loading workspace data and XS metadata...");
      const [inventory, xs] = await Promise.all([
        loadDocsInventory(client, workspace, branchId),
        client.getXS(),
      ]);
      const trigger = inventory.triggers?.find((t: any) => t.id === id);
      if (!trigger) {
        console.error(`Error: No trigger with id ${id} in workspace sink`);
        process.exit(1);
      }
      const showSteps = parseShowSteps(options);
      const md = makeTriggerDocumentation(trigger, inventory, showSteps, instance, xs);
      writeOut(options.output, md);
    } catch (e: any) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

  return docs;
}
