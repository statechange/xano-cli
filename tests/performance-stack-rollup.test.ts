import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateStackNodes,
  collectFunctionCalls,
  collectWarnings,
  walkStack,
} from "../src/performance/stack-rollup.js";
import { buildFunctionIdentityResolver } from "../src/performance/trace-analysis.js";

test("runtime coordinates win and inclusive timing is split into direct and child rollups", () => {
  const [parent, fallback] = walkStack([
    {
      name: "mvp:function",
      position2: "2.if.3",
      position: "ignored-position",
      timing: 1.25,
      stack: [
        {
          name: "mvp:dbo_view",
          position: "2.if.3.7",
          timing: 0.75,
        },
      ],
    },
    { name: "mvp:set_var", timing: 0.25 },
  ], 2);

  assert.equal(parent.position, "2.if.3");
  assert.equal(parent.direct_seconds, 0.5);
  assert.equal(parent.rollup_seconds, 1.25);
  assert.equal(parent.children[0].position, "2.if.3.7");
  assert.equal(fallback.position, "2");
});

test("repeated xsids aggregate retained occurrences without multiplying them by loop cnt", () => {
  const tree = walkStack([
    {
      name: "mvp:foreach",
      _xsid: "loop",
      timing: 0.8,
      cnt: 12,
      stack: [
        { name: "mvp:dbo_view", _xsid: "query", timing: 0.2 },
        {
          name: "mvp:for",
          _xsid: "nested-loop",
          timing: 0.3,
          cnt: 4,
          stack: [
            { name: "mvp:dbo_view", _xsid: "query", timing: 0.1 },
          ],
        },
      ],
    },
  ], 1);

  const aggregate = aggregateStackNodes(tree);
  assert.equal(aggregate.get("query")?.occurrences, 2);
  assert.equal(aggregate.get("query")?.runtime_count_total, 0);
  assert.equal(aggregate.get("loop")?.iterations_total, 12);
  assert.equal(aggregate.get("nested-loop")?.iterations_total, 4);
  assert.equal(aggregate.get("loop")?.retained_stack_nodes, 3);
});

test("zero durations and child-over-parent rounding anomalies produce finite non-negative percentages", () => {
  const [node] = walkStack([
    {
      name: "mvp:function",
      timing: 0.10012,
      stack: [
        { name: "mvp:set_var", timing: 0.05004 },
        { name: "mvp:set_var", timing: 0.05004 },
      ],
    },
  ], 0, 0);

  assert.equal(node.direct_seconds, 0);
  assert.equal(node.pct_of_total, 0);
  assert.equal(node.pct_of_parent, undefined);
  assert.ok(Number.isFinite(node.children[0].pct_of_total));
});

test("performance markers suppress loop warnings through their descendant subtree", () => {
  const tree = walkStack([
    {
      name: "mvp:foreach",
      timing: 0.5,
      cnt: 2,
      description: "Known fan-out #ignore-performance",
      stack: [{ name: "mvp:dbo_view", timing: 0.4 }],
    },
    {
      name: "mvp:foreach",
      timing: 0.5,
      cnt: 2,
      stack: [{ name: "mvp:dbo_view", timing: 0.4 }],
    },
  ], 1);

  assert.equal(tree[0].children[0].warning, undefined);
  assert.match(tree[1].children[0].warning ?? "", /Slow step inside loop/);
  assert.equal(collectWarnings(tree).length, 1);

  const taskTree = walkStack([
    {
      name: "mvp:foreach",
      timing: 0.5,
      cnt: 2,
      stack: [{ name: "mvp:dbo_view", timing: 0.4 }],
    },
  ], 1, undefined, "", undefined, { suppressWarnings: true });
  assert.deepEqual(collectWarnings(taskTree), []);
});

test("runtime cnt stays distinct from retained nodes, loop iterations, and function invocations", () => {
  const tree = walkStack([
    {
      name: "mvp:function",
      timing: 0.8,
      cnt: 3,
      raw: { context: { function: { id: 42 } } },
      stack: [
        { name: "mvp:set_var", timing: 0.1 },
        {
          name: "mvp:foreach",
          timing: 0.6,
          cnt: 270,
          stack: [
            { name: "mvp:dbo_view", _xsid: "query", timing: 0.2 },
            { name: "mvp:dbo_view", _xsid: "query", timing: 0.2 },
          ],
        },
      ],
    },
  ], 1);

  assert.equal(tree[0].runtime_count, 3);
  assert.equal(tree[0].retained_stack_nodes, 4);
  assert.equal(tree[0].iterations, undefined);
  assert.equal(tree[0].children[1].runtime_count, 270);
  assert.equal(tree[0].children[1].iterations, 270);
  assert.equal(tree[0].children[1].retained_stack_nodes, 2);

  assert.deepEqual(collectFunctionCalls(tree), [{
    id: 42,
    call_count: 1,
    retained_stack_nodes: 4,
    total_seconds: 0.8,
  }]);
});

test("function identity refuses ambiguous static xsids and never guesses from title", () => {
  const resolve = buildFunctionIdentityResolver([
    { name: "mvp:function", _xsid: "duplicate", context: { function: { id: 1 } } },
    { name: "mvp:function", _xsid: "duplicate", context: { function: { id: 2 } } },
  ], new Map([[1, "Same title"], [2, "Same title"]]));

  assert.deepEqual(resolve({ name: "mvp:function", _xsid: "duplicate", title: "Same title" }), {
    status: "unresolved",
    runtime_xsid: "duplicate",
    runtime_title: "Same title",
    reason: "ambiguous_static_match",
  });
  assert.deepEqual(resolve({ name: "mvp:function", _xsid: "missing", title: "Same title" }), {
    status: "unresolved",
    runtime_xsid: "missing",
    runtime_title: "Same title",
    reason: "missing_static_match",
  });
});
