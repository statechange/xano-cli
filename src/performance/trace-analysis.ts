import type { StackNode } from "./stack-rollup.js";

export type TraceTargetType = "endpoint" | "task" | "trigger";

export interface TraceTarget {
  type: TraceTargetType;
  id: number;
  name: string | null;
  description: string | null;
  metadata_status: "resolved" | "unresolved";
}

export type FunctionIdentity =
  | { status: "resolved"; id: number; name?: string; source: "runtime_raw" | "static_xsid" }
  | {
      status: "unresolved";
      runtime_xsid?: string;
      runtime_title?: string;
      reason: "missing_static_match" | "ambiguous_static_match";
    };

/**
 * Resolve runtime function steps only from explicit runtime IDs or an exact,
 * unambiguous `_xsid` match in the target/function static definitions. Titles
 * are display-only because names are not unique identifiers in Xano.
 */
export function buildFunctionIdentityResolver(
  staticSources: any[],
  functionNames: Map<number, string>,
): (step: any) => FunctionIdentity | undefined {
  const idsByXsid = new Map<string, Set<number>>();

  const visit = (value: any): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;

    if (value.name === "mvp:function" && typeof value._xsid === "string") {
      const id = Number(value.context?.function?.id);
      if (Number.isInteger(id) && id > 0) {
        const ids = idsByXsid.get(value._xsid) ?? new Set<number>();
        ids.add(id);
        idsByXsid.set(value._xsid, ids);
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const source of staticSources) visit(source);

  return (step: any): FunctionIdentity | undefined => {
    if (step?.name !== "mvp:function") return undefined;
    const rawId = Number(step.raw?.context?.function?.id);
    if (Number.isInteger(rawId) && rawId > 0) {
      return {
        status: "resolved",
        id: rawId,
        ...(functionNames.has(rawId) ? { name: functionNames.get(rawId) } : {}),
        source: "runtime_raw",
      };
    }

    const ids = typeof step._xsid === "string" ? idsByXsid.get(step._xsid) : undefined;
    if (ids?.size === 1) {
      const id = Array.from(ids)[0];
      return {
        status: "resolved",
        id,
        ...(functionNames.has(id) ? { name: functionNames.get(id) } : {}),
        source: "static_xsid",
      };
    }
    return {
      status: "unresolved",
      ...(typeof step._xsid === "string" ? { runtime_xsid: step._xsid } : {}),
      ...(typeof step.title === "string" ? { runtime_title: step.title } : {}),
      reason: ids && ids.size > 1 ? "ambiguous_static_match" : "missing_static_match",
    };
  };
}

export async function resolveTraceTarget(
  client: any,
  workspace: number,
  branchId: number,
  type: TraceTargetType,
  id: number,
): Promise<{ target: TraceTarget; source: any }> {
  let objects: any[];
  if (type === "endpoint") {
    const payload = await client.getAPIAppsAndQueries(workspace, branchId);
    objects = payload.queries ?? [];
  } else if (type === "task") {
    objects = await client.getTasks(workspace, branchId);
  } else {
    objects = await client.getTriggers(workspace, branchId);
  }
  const source = objects.find((item: any) => Number(item.id) === id);
  return {
    target: {
      type,
      id,
      name: source?.name || null,
      description: source?.description || null,
      metadata_status: source ? "resolved" : "unresolved",
    },
    source,
  };
}

export interface TraceFunctionSummary {
  identity: FunctionIdentity;
  total_calls: number;
  calls_complete: boolean;
  retained_stack_nodes: number;
  calls_per_request: number;
  total_seconds: number;
  seconds_per_call: number;
  pct_of_total_request_time: number;
  timing_semantics: "inclusive";
  caller_scope: "single_target";
  callers: TraceTarget[];
}

export function collectTraceFunctions(
  trees: StackNode[][],
  sampleCount: number,
  totalRequestSeconds: number,
  callsComplete: boolean,
  target: TraceTarget,
): TraceFunctionSummary[] {
  const summaries = new Map<string, {
    identity: FunctionIdentity;
    calls: number;
    nodes: number;
    seconds: number;
  }>();

  const visit = (nodes: StackNode[]): void => {
    for (const node of nodes) {
      if (node.function_identity) {
        const identity = node.function_identity;
        const key = identity.status === "resolved"
          ? `id:${identity.id}`
          : `unresolved:${identity.runtime_xsid ?? node.position}:${identity.reason}`;
        const current = summaries.get(key) ?? { identity, calls: 0, nodes: 0, seconds: 0 };
        current.calls += 1;
        current.nodes += node.retained_stack_nodes;
        current.seconds += node.rollup_seconds;
        summaries.set(key, current);
      }
      visit(node.children);
    }
  };
  for (const tree of trees) visit(tree);

  return Array.from(summaries.values())
    .map((summary) => ({
      identity: summary.identity,
      total_calls: summary.calls,
      calls_complete: callsComplete,
      retained_stack_nodes: summary.nodes,
      calls_per_request: sampleCount > 0 ? +(summary.calls / sampleCount).toFixed(2) : 0,
      total_seconds: +summary.seconds.toFixed(4),
      seconds_per_call: summary.calls > 0 ? +(summary.seconds / summary.calls).toFixed(4) : 0,
      pct_of_total_request_time: totalRequestSeconds > 0
        ? +((summary.seconds / totalRequestSeconds) * 100).toFixed(1)
        : 0,
      timing_semantics: "inclusive" as const,
      caller_scope: "single_target" as const,
      callers: [target],
    }))
    .sort((a, b) => b.total_seconds - a.total_seconds);
}

export interface StructuralTraceStep {
  path: string[];
  parent_path: string[] | null;
  depth: number;
  _xsid?: string;
  name: string;
  title?: string;
  avg_direct_seconds: number;
  avg_rollup_seconds: number;
  total_direct_seconds: number;
  total_rollup_seconds: number;
  pct_of_total: number;
  pct_of_parent?: number;
  total_invocations: number;
  avg_invocations_per_request: number;
  iterations_total?: number;
  avg_iterations_per_request?: number;
}

/** Aggregate by full ancestry path; unlike hotspots, identical xsids under
 * different parents remain separate. pct_of_total uses exclusive/direct time
 * so percentages are additive instead of double-counting inclusive parents. */
export function buildStructuralBreakdown(
  trees: StackNode[][],
  sampleCount: number,
  totalRequestSeconds: number,
): StructuralTraceStep[] {
  const aggregate = new Map<string, {
    path: string[];
    parentPath: string[] | null;
    node: StackNode;
    direct: number;
    rollup: number;
    occurrences: number;
    iterations: number;
  }>();

  const visit = (nodes: StackNode[], parentPath: string[]): void => {
    for (const node of nodes) {
      const segment = node._xsid || `pos:${node.position}:${node.name}`;
      const path = [...parentPath, segment];
      const key = JSON.stringify(path);
      const current = aggregate.get(key) ?? {
        path,
        parentPath: parentPath.length > 0 ? parentPath : null,
        node,
        direct: 0,
        rollup: 0,
        occurrences: 0,
        iterations: 0,
      };
      current.direct += node.direct_seconds;
      current.rollup += node.rollup_seconds;
      current.occurrences += 1;
      current.iterations += node.iterations ?? 0;
      aggregate.set(key, current);
      visit(node.children, path);
    }
  };
  for (const tree of trees) visit(tree, []);

  return Array.from(aggregate.values())
    .map((item) => {
      const parent = item.parentPath
        ? aggregate.get(JSON.stringify(item.parentPath))
        : undefined;
      return {
        path: item.path,
        parent_path: item.parentPath,
        depth: item.path.length - 1,
        ...(item.node._xsid ? { _xsid: item.node._xsid } : {}),
        name: item.node.name,
        ...(item.node.title ? { title: item.node.title } : {}),
        avg_direct_seconds: +(item.direct / item.occurrences).toFixed(4),
        avg_rollup_seconds: +(item.rollup / item.occurrences).toFixed(4),
        total_direct_seconds: +item.direct.toFixed(4),
        total_rollup_seconds: +item.rollup.toFixed(4),
        pct_of_total: totalRequestSeconds > 0
          ? +((item.direct / totalRequestSeconds) * 100).toFixed(1)
          : 0,
        ...(parent && parent.rollup > 0
          ? { pct_of_parent: +((item.rollup / parent.rollup) * 100).toFixed(1) }
          : {}),
        total_invocations: item.occurrences,
        avg_invocations_per_request: sampleCount > 0
          ? +(item.occurrences / sampleCount).toFixed(2)
          : 0,
        ...(item.iterations > 0
          ? {
              iterations_total: item.iterations,
              avg_iterations_per_request: sampleCount > 0
                ? +(item.iterations / sampleCount).toFixed(2)
                : 0,
            }
          : {}),
      };
    });
}

export interface TraceIssue {
  code: "slow_runtime_step_inside_loop";
  severity: "high";
  message: string;
  evidence: {
    path: string[];
    step_type: string;
    title?: string;
    rollup_seconds: number;
  };
  suggestion: string;
}

/** Runtime-only, high-confidence findings. Suppressed nodes have no warning
 * after walkStack applies task and #ignore-performance semantics. */
export function collectTraceIssues(trees: StackNode[][]): TraceIssue[] {
  const issues = new Map<string, TraceIssue>();
  const visit = (nodes: StackNode[], parentPath: string[]): void => {
    for (const node of nodes) {
      const segment = node._xsid || `pos:${node.position}:${node.name}`;
      const path = [...parentPath, segment];
      if (node.warning) {
        const suggestion = node.name === "mvp:dbo_view" || node.name === "mvp:dbo_direct_query"
          ? "Move the database work outside the loop or replace repeated queries with a set-based query."
          : `Move the ${node.title || node.name} outside the loop or batch the repeated work.`;
        issues.set(JSON.stringify(path), {
          code: "slow_runtime_step_inside_loop",
          severity: "high",
          message: node.warning,
          evidence: {
            path,
            step_type: node.name,
            ...(node.title ? { title: node.title } : {}),
            rollup_seconds: node.rollup_seconds,
          },
          suggestion,
        });
      }
      visit(node.children, path);
    }
  };
  for (const tree of trees) visit(tree, []);
  return Array.from(issues.values());
}
