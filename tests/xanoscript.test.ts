import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import {
  EXPORTABLE_XANOSCRIPT_TYPES,
  createXanoScriptCommand,
  selectExportTypes,
} from "../src/commands/xanoscript.js";

test("the all selector expands to every concrete export type exactly once", () => {
  assert.deepEqual(selectExportTypes("all"), EXPORTABLE_XANOSCRIPT_TYPES);
  assert.equal(new Set(selectExportTypes("all")).size, EXPORTABLE_XANOSCRIPT_TYPES.length);
  assert.equal(selectExportTypes("all").includes("all" as never), false);
});

test("workspace realtime triggers use the realtime trigger schema kind", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-realtime-trigger-"));
  const generatedKinds: string[] = [];
  const client = {
    getTriggers: async () => [
      { id: 13, name: "Real_Time_Trigger_0", obj_type: "workspace_realtime_channel" },
    ],
    generateXanoScript: async (_workspace: number, _item: unknown, kind: string) => {
      generatedKinds.push(kind);
      return { status: "success", payload: { output: "realtime_trigger Real_Time_Trigger_0 {}" } };
    },
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 19, branchId: 0 }),
  });

  await program.parseAsync(
    ["node", "test", "xanoscript", "export-all", "--type", "trigger", "--output-dir", outputDir],
    { from: "node" }
  );

  assert.deepEqual(generatedKinds, ["schema:realtime_trigger"]);
  assert.equal(
    readFileSync(join(outputDir, "trigger", "Real_Time_Trigger_0.xs"), "utf8"),
    "realtime_trigger Real_Time_Trigger_0 {}"
  );
});

test("trigger exports preserve specialized and ordinary schema kinds", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-trigger-kinds-"));
  const generated: Array<{ name: string; kind: string }> = [];
  const client = {
    getTriggers: async () => [
      { id: 1, name: "MCP Trigger", obj_type: "toolset" },
      { id: 2, name: "Table Trigger", obj_type: "database" },
      { id: 3, name: "Realtime Trigger", obj_type: "workspace_realtime_channel" },
      { id: 4, name: "Ordinary Trigger", obj_type: "workspace" },
    ],
    generateXanoScript: async (
      _workspace: number,
      item: { name: string },
      kind: string
    ) => {
      generated.push({ name: item.name, kind });
      return { status: "success", payload: { output: `// ${item.name}` } };
    },
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 19, branchId: 0 }),
  });

  await program.parseAsync(
    ["node", "test", "xanoscript", "export-all", "--type", "trigger", "--output-dir", outputDir],
    { from: "node" }
  );

  assert.deepEqual(generated, [
    { name: "MCP Trigger", kind: "schema:mcp_server_trigger" },
    { name: "Table Trigger", kind: "schema:table_trigger" },
    { name: "Realtime Trigger", kind: "schema:realtime_trigger" },
    { name: "Ordinary Trigger", kind: "schema:trigger" },
  ]);
});

test("a concrete selector retains colliding object names as distinct files", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-single-collision-"));
  const fetched: string[] = [];
  const unexpected = (type: string) => async () => {
    fetched.push(type);
    throw new Error(`${type} should not be fetched`);
  };
  const client = {
    getFunctions: async () => {
      fetched.push("function");
      return {
        functions: [
          { id: 101, name: "same/name" },
          { id: 202, name: "same?name" },
        ],
      };
    },
    getWorkspaceSink: unexpected("table"),
    getAPIAppsAndQueries: unexpected("api"),
    getTasks: unexpected("task"),
    getTriggers: unexpected("trigger"),
    getMCPServers: unexpected("mcp_server"),
    getAddons: unexpected("addon"),
    getMiddleware: unexpected("middleware"),
    generateXanoScript: async (_workspace: number, item: { id: number }) => ({
      status: "success",
      payload: { output: `// ${item.id}` },
    }),
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });

  await program.parseAsync(
    ["node", "test", "xanoscript", "export-all", "--type", "function", "--output-dir", outputDir],
    { from: "node" }
  );

  const typeDir = join(outputDir, "function");
  assert.deepEqual(fetched, ["function"]);
  assert.deepEqual(readdirSync(typeDir).sort(), ["same_name.xs", "same_name_202.xs"]);
  assert.equal(readFileSync(join(typeDir, "same_name.xs"), "utf8"), "// 101");
  assert.equal(readFileSync(join(typeDir, "same_name_202.xs"), "utf8"), "// 202");
});

test("an export rerun never overwrites a file already retained on disk", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-rerun-"));
  const typeDir = join(outputDir, "function");
  const program = new Command().exitOverride();
  const client = {
    getFunctions: async () => ({ functions: [{ id: 202, name: "same/name" }] }),
    generateXanoScript: async () => ({ status: "success", payload: { output: "// new" } }),
  };
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });
  mkdirSync(typeDir);
  writeFileSync(join(typeDir, "same_name.xs"), "// existing", "utf8");

  await program.parseAsync(
    ["node", "test", "xanoscript", "export-all", "--type", "function", "--output-dir", outputDir],
    { from: "node" }
  );

  assert.equal(readFileSync(join(typeDir, "same_name.xs"), "utf8"), "// existing");
  assert.equal(readFileSync(join(typeDir, "same_name_202.xs"), "utf8"), "// new");
});

test("the all selector retains collisions independently in every type directory", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-all-collision-"));
  const items = [
    { id: 101, name: "same/name" },
    { id: 202, name: "same?name" },
  ];
  const client = {
    getFunctions: async () => ({ functions: items }),
    getWorkspaceSink: async () => ({ dbos: items }),
    getAPIAppsAndQueries: async () => ({ queries: items }),
    getTasks: async () => items,
    getTriggers: async () => items,
    getMCPServers: async () => items,
    getAddons: async () => items,
    getMiddleware: async () => items,
    generateXanoScript: async (_workspace: number, item: { id: number }) => ({
      status: "success",
      payload: { output: `// ${item.id}` },
    }),
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });

  await program.parseAsync(
    ["node", "test", "xanoscript", "export-all", "--type", "all", "--output-dir", outputDir],
    { from: "node" }
  );

  for (const type of EXPORTABLE_XANOSCRIPT_TYPES) {
    const typeDir = join(outputDir, type);
    assert.deepEqual(readdirSync(typeDir).sort(), ["same_name.xs", "same_name_202.xs"]);
    assert.equal(readFileSync(join(typeDir, "same_name.xs"), "utf8"), "// 101");
    assert.equal(readFileSync(join(typeDir, "same_name_202.xs"), "utf8"), "// 202");
  }
});

test("a failed type does not stop later types and makes the command fail", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-failure-"));
  const fetched: string[] = [];
  const fetch = (type: string) => async () => {
    fetched.push(type);
    if (type === "api") throw new Error("api unavailable");
    return [];
  };
  const client = {
    getFunctions: async () => ({ functions: await fetch("function")() }),
    getWorkspaceSink: async () => ({ dbos: await fetch("table")() }),
    getAPIAppsAndQueries: async () => ({ queries: await fetch("api")() }),
    getTasks: fetch("task"),
    getTriggers: fetch("trigger"),
    getMCPServers: fetch("mcp_server"),
    getAddons: fetch("addon"),
    getMiddleware: fetch("middleware"),
    generateXanoScript: async () => ({ status: "success", payload: { output: "unused" } }),
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });

  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await program.parseAsync(
      ["node", "test", "xanoscript", "export-all", "--type", "all", "--output-dir", outputDir],
      { from: "node" }
    );
    assert.deepEqual(fetched, EXPORTABLE_XANOSCRIPT_TYPES);
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("one object failure does not stop later objects and makes the command fail", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-object-failure-"));
  const generated: string[] = [];
  const client = {
    getFunctions: async () => ({ functions: [{ id: 1, name: "bad" }, { id: 2, name: "good" }] }),
    generateXanoScript: async (_workspace: number, item: { name: string }) => {
      generated.push(item.name);
      if (item.name === "bad") throw new Error("object unavailable");
      return { status: "success", payload: { output: "// good" } };
    },
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });

  const previousExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await program.parseAsync(
      ["node", "test", "xanoscript", "export-all", "--type", "function", "--output-dir", outputDir],
      { from: "node" }
    );
    assert.deepEqual(generated, ["bad", "good"]);
    assert.equal(readFileSync(join(outputDir, "function", "good.xs"), "utf8"), "// good");
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});

test("omitting type is a nonzero validation error that lists all", async () => {
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => {
      throw new Error("validation should happen before client creation");
    },
  });
  const errors: string[] = [];
  const originalError = console.error;
  const previousExitCode = process.exitCode;
  console.error = (...parts: unknown[]) => errors.push(parts.join(" "));
  process.exitCode = 0;
  try {
    await program.parseAsync(["node", "test", "xanoscript", "export-all"], { from: "node" });
    assert.equal(process.exitCode, 1);
    assert.match(errors.join("\n"), /--type required/);
    assert.match(errors.join("\n"), /all/);
  } finally {
    console.error = originalError;
    process.exitCode = previousExitCode;
  }
});

test("summaries count retained files, skips, and errors", async () => {
  const outputDir = mkdtempSync(join(tmpdir(), "sc-xano-export-summary-"));
  const client = {
    getFunctions: async () => ({
      functions: [
        { id: 1, name: "kept" },
        { id: 2, name: "ignored" },
        { id: 3, name: "failed" },
      ],
    }),
    generateXanoScript: async (_workspace: number, item: { name: string }) => {
      if (item.name === "ignored") return { status: "error", payload: { doIgnore: true } };
      if (item.name === "failed") return { status: "error", payload: { message: "no script" } };
      return { status: "success", payload: { output: "// kept" } };
    },
  };
  const program = new Command().exitOverride();
  createXanoScriptCommand(program, {
    makeClient: async () => ({ client, workspace: 42, branchId: 0 }),
  });
  const logs: string[] = [];
  const originalLog = console.log;
  const originalWrite = process.stdout.write;
  const previousExitCode = process.exitCode;
  console.log = (...parts: unknown[]) => logs.push(parts.join(" "));
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.exitCode = 0;
  try {
    await program.parseAsync(
      ["node", "test", "xanoscript", "export-all", "--type", "function", "--output-dir", outputDir],
      { from: "node" }
    );
    assert.match(logs.join("\n"), /function: 1 files retained, 1 skipped, 1 errors/);
    assert.match(logs.join("\n"), /Done: 1 files retained, 1 skipped, 1 errors/);
    assert.deepEqual(readdirSync(join(outputDir, "function")), ["kept.xs"]);
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = originalLog;
    process.stdout.write = originalWrite;
    process.exitCode = previousExitCode;
  }
});
