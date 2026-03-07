/**
 * Stack Rollup — Walk a runtime execution stack and compute timing breakdowns.
 * Ported from parcel-test-2/src/content/performance.ts (perfByXsid),
 * redesigned for CLI tree output rather than flat xsid-keyed aggregation.
 */

export interface StackNode {
  position: string;
  name: string;
  title?: string;
  _xsid?: string;
  direct_seconds: number;
  rollup_seconds: number;
  pct_of_total: number;
  pct_of_parent?: number;
  iterations?: number;
  function_id?: number;
  function_name?: string;
  warning?: string;
  children: StackNode[];
}

export interface DeepDiveResult {
  request: {
    id: number;
    verb?: string;
    uri?: string;
    status?: number;
    duration_seconds: number;
    created_at?: string;
    stack_truncated: boolean;
  };
  stack: StackNode[];
  functions_called: FunctionCallSummary[];
  warnings: string[];
}

export interface FunctionCallSummary {
  id: number;
  name?: string;
  call_count: number;
  total_seconds: number;
}

const LOOP_NAMES = ["mvp:foreach", "mvp:for", "mvp:while"];

/**
 * Walk a runtime stack array and produce a tree of StackNodes with timing rollups.
 */
export function walkStack(
  stack: any[],
  totalDuration: number,
  parentRollup?: number,
  positionPrefix = "",
  functionMap?: Map<number, string>,
  loopDepth = 0,
): StackNode[] {
  if (!stack || stack.length === 0) return [];

  const nodes: StackNode[] = [];

  for (let i = 0; i < stack.length; i++) {
    const step = stack[i];
    const position = positionPrefix ? `${positionPrefix}.${i + 1}` : `${i + 1}`;
    const timingSecs = step.timing ?? 0;
    const isLoop = LOOP_NAMES.includes(step.name);
    const childLoopDepth = isLoop ? loopDepth + 1 : loopDepth;

    // Recurse into children
    const children = walkStack(
      step.stack || [],
      totalDuration,
      timingSecs,
      position,
      functionMap,
      childLoopDepth,
    );

    const childrenRollup = children.reduce((sum, c) => sum + c.rollup_seconds, 0);
    const directSecs = Math.max(0, timingSecs - childrenRollup);
    const rollupSecs = timingSecs;

    const node: StackNode = {
      position,
      name: step.name || "unknown",
      title: step.title || undefined,
      _xsid: step._xsid || undefined,
      direct_seconds: +directSecs.toFixed(4),
      rollup_seconds: +rollupSecs.toFixed(4),
      pct_of_total: totalDuration > 0 ? +((rollupSecs / totalDuration) * 100).toFixed(1) : 0,
      children,
    };

    if (parentRollup != null && parentRollup > 0) {
      node.pct_of_parent = +((rollupSecs / parentRollup) * 100).toFixed(1);
    }

    if (step.cnt != null && step.cnt > 1) {
      node.iterations = step.cnt;
    }

    // Resolve function references
    if (step.name === "mvp:function" && step.raw?.context?.function?.id) {
      node.function_id = step.raw.context.function.id;
      if (functionMap?.has(node.function_id!)) {
        node.function_name = functionMap.get(node.function_id!);
      }
    }

    // Warn on slow steps inside loops
    if (loopDepth > 0 && isSlowRuntimeStep(step.name)) {
      node.warning = loopDepth === 1
        ? "Slow step inside loop"
        : `Slow step inside nested loops (depth: ${loopDepth})`;
    }

    nodes.push(node);
  }

  return nodes;
}

function isSlowRuntimeStep(name: string): boolean {
  return [
    "mvp:dbo_view",
    "mvp:api_request",
    "mvp:lambda",
    "mvp:dbo_direct_query",
  ].includes(name);
}

/**
 * Collect all function calls from a StackNode tree.
 */
export function collectFunctionCalls(
  nodes: StackNode[],
  acc: Map<number, { name?: string; count: number; totalSecs: number }> = new Map(),
): FunctionCallSummary[] {
  for (const node of nodes) {
    if (node.function_id != null) {
      const existing = acc.get(node.function_id) || { name: node.function_name, count: 0, totalSecs: 0 };
      existing.count++;
      existing.totalSecs += node.rollup_seconds;
      if (node.function_name) existing.name = node.function_name;
      acc.set(node.function_id, existing);
    }
    collectFunctionCalls(node.children, acc);
  }

  // Only return from top-level call
  if (acc.size > 0) {
    return Array.from(acc.entries())
      .map(([id, info]) => ({
        id,
        name: info.name,
        call_count: info.count,
        total_seconds: +info.totalSecs.toFixed(4),
      }))
      .sort((a, b) => b.total_seconds - a.total_seconds);
  }
  return [];
}

/**
 * Collect all warning strings from a StackNode tree.
 */
export function collectWarnings(nodes: StackNode[]): string[] {
  const warnings: string[] = [];
  for (const node of nodes) {
    if (node.warning) {
      const label = node.title || node.name;
      warnings.push(`${node.warning}: ${label} at position ${node.position} (${node.rollup_seconds}s)`);
    }
    warnings.push(...collectWarnings(node.children));
  }
  return warnings;
}
