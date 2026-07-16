import assert from "node:assert/strict";
import test from "node:test";
import { Command } from "commander";

import { createPerformanceCommand } from "../src/commands/performance.js";

const requestFixture = {
  id: 9256248,
  verb: "GET",
  uri: "https://example.test/calendar",
  status: 200,
  duration: 1,
  created_at: "2026-07-16T14:07:43Z",
  cnt: 113,
  stack_maxed: true,
  stack: [
    {
      name: "mvp:foreach",
      title: "For Each loop",
      _xsid: "loop",
      position2: "4",
      timing: 0.8,
      cnt: 270,
      stack: [
        { name: "mvp:dbo_view", _xsid: "query", timing: 0.2 },
        { name: "mvp:dbo_view", _xsid: "query", timing: 0.2 },
      ],
    },
  ],
};

async function runPerformance(args: string[], client: Record<string, any>) {
  const logs: string[] = [];
  const errors: string[] = [];
  const previousLog = console.log;
  const previousError = console.error;
  console.log = (...values: unknown[]) => logs.push(values.join(" "));
  console.error = (...values: unknown[]) => errors.push(values.join(" "));

  try {
    const program = new Command().exitOverride();
    createPerformanceCommand(program, {
      makeClient: async () => ({
        client,
        workspace: 19,
        branchId: 0,
        instance: "example.test",
        selection: {} as never,
      }),
    });
    await program.parseAsync(["node", "test", "performance", ...args], { from: "node" });
    return { stdout: logs.join("\n"), stderr: errors.join("\n") };
  } finally {
    console.log = previousLog;
    console.error = previousError;
  }
}

for (const format of ["json", "yaml", "table"] as const) {
  test(`deep-dive exposes count and truncation semantics at the ${format} boundary`, async () => {
    const result = await runPerformance(["deep-dive", "9256248", "--format", format], {
      getRequest: async () => requestFixture,
      getFunctions: async () => ({ functions: [] }),
    });

    if (format === "json") {
      const output = JSON.parse(result.stdout);
      assert.equal(output.request.runtime_stack_count, 113);
      assert.equal(output.request.retained_stack_nodes, 3);
      assert.equal(output.stack[0].runtime_count, 270);
      assert.equal(output.stack[0].iterations, 270);
      assert.equal(output.stack[0].retained_stack_nodes, 2);
      return;
    }

    if (format === "yaml") {
      assert.match(result.stdout, /runtime_stack_count: 113/);
      assert.match(result.stdout, /retained_stack_nodes: 3/);
      assert.match(result.stdout, /iterations: 270/);
      return;
    }

    assert.match(result.stdout, /Stack was truncated by Xano/);
    assert.match(result.stdout, /For Each loop ×270/);
  });
}

test("trace marks retained occurrences incomplete and reports truncated sample count", async () => {
  const result = await runPerformance(["trace", "endpoint", "695", "--samples", "2", "--format", "json"], {
    getAPIAppsAndQueries: async () => ({ queries: [{ id: 695, name: "calendar" }] }),
    getRequestHistoryForQuery: async () => ({ items: [{ id: 1 }, { id: 2 }] }),
    getRequest: async (id: number) => ({
      ...requestFixture,
      id,
      stack_maxed: id === 1,
    }),
    getFunctions: async () => ({ functions: [] }),
  });
  const output = JSON.parse(result.stdout);

  assert.equal(output.samples, 2);
  assert.equal(output.truncated_samples, 1);
  assert.equal(output.complete_samples, 1);
  const loop = output.hotspots.find((step: any) => step._xsid === "loop");
  const query = output.hotspots.find((step: any) => step._xsid === "query");
  assert.equal(loop.iterations_total, 540);
  assert.equal(loop.occurrences, 2);
  assert.equal(loop.occurrences_complete, false);
  assert.equal(query.occurrences, 4);
  assert.equal(query.occurrences_complete, false);
});

for (const type of ["task", "trigger"] as const) {
  test(`trace resolves ${type} metadata from its workspace inventory`, async () => {
    const object = { id: 77, name: `${type} name`, description: `${type} description` };
    const client: Record<string, any> = {
      getFunctions: async () => ({ functions: [] }),
      ...(type === "task"
        ? {
            getTasks: async () => [object],
            getTaskHistory: async () => ({ items: [{ id: 1 }] }),
            getTaskHistoryItem: async () => ({ id: 1, duration: 1, stack: [] }),
          }
        : {
            getTriggers: async () => [object],
            getTriggerHistory: async () => ({ items: [{ id: 1 }] }),
            getRequest: async () => ({ id: 1, duration: 1, stack: [] }),
          }),
    };
    const result = await runPerformance(["trace", type, "77", "--samples", "1", "--format", "json"], client);
    const output = JSON.parse(result.stdout);
    assert.equal(output.target.name, `${type} name`);
    assert.equal(output.target.description, `${type} description`);
  });
}

test("trace table and yaml expose named structural, hotspot, function, and issue sections", async () => {
  const client = {
    getAPIAppsAndQueries: async () => ({ queries: [{ id: 695, name: "calendar", run: [] }] }),
    getRequestHistoryForQuery: async () => ({ items: [{ id: 1 }] }),
    getRequest: async () => ({
      id: 1,
      duration: 1,
      stack: [{
        name: "mvp:foreach", _xsid: "loop", timing: 0.8, cnt: 2,
        stack: [{ name: "mvp:lambda", title: "Lambda", _xsid: "lambda", timing: 0.5 }],
      }],
    }),
    getFunctions: async () => ({ functions: [] }),
  };
  const yaml = await runPerformance(["trace", "endpoint", "695", "--samples", "1", "--format", "yaml"], client);
  assert.match(yaml.stdout, /ancestry:/);
  assert.match(yaml.stdout, /hotspots:/);
  assert.match(yaml.stdout, /issues:/);
  assert.match(yaml.stdout, /pct_of_total: 50/);

  const table = await runPerformance(["trace", "endpoint", "695", "--samples", "1", "--format", "table"], client);
  assert.match(table.stdout, /Trace: endpoint calendar \(ID: 695/);
  assert.match(table.stdout, /Structural ancestry:/);
  assert.match(table.stdout, /Hotspots by exclusive time:/);
  assert.match(table.stdout, /Actionable issues:/);
});

test("trace keeps ancestry separate from additive hotspots and emits actionable nested issues", async () => {
  const result = await runPerformance(["trace", "endpoint", "695", "--samples", "1", "--format", "json"], {
    getAPIAppsAndQueries: async () => ({ queries: [{ id: 695, name: "calendar", run: [] }] }),
    getRequestHistoryForQuery: async () => ({ items: [{ id: 1 }] }),
    getRequest: async () => ({
      id: 1,
      duration: 1,
      stack: [{
        name: "mvp:foreach",
        title: "Loop",
        _xsid: "loop",
        timing: 0.8,
        cnt: 4,
        stack: [{
          name: "mvp:function",
          title: "Unidentified helper",
          _xsid: "unknown-function",
          timing: 0.6,
          stack: [{
            name: "mvp:api_request",
            title: "External API Request",
            _xsid: "external",
            timing: 0.5,
          }],
        }],
      }],
    }),
    getFunctions: async () => ({ functions: [] }),
  });

  const output = JSON.parse(result.stdout);
  const externalPath = output.ancestry.find((step: any) => step._xsid === "external");
  assert.deepEqual(externalPath.path, ["loop", "unknown-function", "external"]);
  assert.deepEqual(externalPath.parent_path, ["loop", "unknown-function"]);
  assert.equal(externalPath.pct_of_total, 50);
  assert.equal(externalPath.pct_of_parent, 83.3);

  const loop = output.hotspots.find((step: any) => step._xsid === "loop");
  assert.equal(output.hotspots[0]._xsid, "external");
  assert.equal(loop.pct_of_total, 20);
  assert.equal(loop.avg_invocations_per_request, 1);
  assert.equal(loop.avg_iterations_per_request, 4);

  assert.equal(output.functions_called[0].identity.status, "unresolved");
  assert.equal(output.functions_called[0].identity.reason, "missing_static_match");
  assert.equal(output.functions_called[0].calls_per_request, 1);
  assert.equal(output.functions_called[0].seconds_per_call, 0.6);
  assert.equal(output.functions_called[0].pct_of_total_request_time, 60);
  assert.equal(output.functions_called[0].caller_scope, "single_target");

  assert.equal(output.issues[0].severity, "high");
  assert.deepEqual(output.issues[0].evidence.path, ["loop", "unknown-function", "external"]);
  assert.match(output.issues[0].suggestion, /outside the loop/i);
});

test("trace issues honor task-wide and #ignore-performance suppression", async () => {
  const nestedStack = (suppressed: boolean) => [{
    name: "mvp:foreach",
    _xsid: "loop",
    timing: 0.8,
    cnt: 2,
    ...(suppressed ? { description: "Intentional #ignore-performance" } : {}),
    stack: [{ name: "mvp:dbo_view", _xsid: "query", timing: 0.5 }],
  }];

  const endpoint = await runPerformance(["trace", "endpoint", "695", "--samples", "1", "--format", "json"], {
    getAPIAppsAndQueries: async () => ({ queries: [{ id: 695, name: "calendar", run: [] }] }),
    getRequestHistoryForQuery: async () => ({ items: [{ id: 1 }] }),
    getRequest: async () => ({ id: 1, duration: 1, stack: nestedStack(true) }),
    getFunctions: async () => ({ functions: [] }),
  });
  assert.deepEqual(JSON.parse(endpoint.stdout).issues, []);

  const task = await runPerformance(["trace", "task", "77", "--samples", "1", "--format", "json"], {
    getTasks: async () => [{ id: 77, name: "nightly" }],
    getTaskHistory: async () => ({ items: [{ id: 1 }] }),
    getTaskHistoryItem: async () => ({ id: 1, duration: 1, stack: nestedStack(false) }),
    getFunctions: async () => ({ functions: [] }),
  });
  assert.deepEqual(JSON.parse(task.stdout).issues, []);
});

test("trace resolves endpoint metadata and function identity from the target static xsid", async () => {
  const result = await runPerformance(["trace", "endpoint", "695", "--samples", "1", "--format", "json"], {
    getAPIAppsAndQueries: async () => ({
      apps: [],
      queries: [{
        id: 695,
        name: "calendar",
        description: "Calendar feed",
        run: [{
          name: "mvp:function",
          _xsid: "function-call",
          context: { function: { id: 516 } },
        }],
      }],
    }),
    getRequestHistoryForQuery: async () => ({ items: [{ id: 1 }] }),
    getRequest: async () => ({
      id: 1,
      duration: 1,
      stack: [{
        name: "mvp:function",
        title: "Circle Authenticated Request",
        _xsid: "function-call",
        timing: 0.6,
        stack: [],
      }],
    }),
    getFunctions: async () => ({
      functions: [{ id: 516, name: "Circle Authenticated Request", run: [] }],
    }),
  });

  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.target, {
    type: "endpoint",
    id: 695,
    name: "calendar",
    description: "Calendar feed",
    metadata_status: "resolved",
  });
  assert.equal(output.functions_called[0].identity.status, "resolved");
  assert.equal(output.functions_called[0].identity.id, 516);
  assert.equal(output.functions_called[0].identity.source, "static_xsid");
});
