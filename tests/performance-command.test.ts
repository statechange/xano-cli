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
  const loop = output.step_breakdown.find((step: any) => step._xsid === "loop");
  const query = output.step_breakdown.find((step: any) => step._xsid === "query");
  assert.equal(loop.iterations_total, 540);
  assert.equal(loop.occurrences, 2);
  assert.equal(loop.occurrences_complete, false);
  assert.equal(query.occurrences, 4);
  assert.equal(query.occurrences_complete, false);
});
