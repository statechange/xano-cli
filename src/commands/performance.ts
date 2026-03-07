/**
 * Performance CLI Commands
 */

import { Command } from "commander";
import { generateLoadAnalysis, RequestSummary } from "../performance/load-analysis.js";
import { makeClient } from "../registry-client.js";
import {
  buildStepListFromXray,
  getStepWarnings,
  nestingLevel,
} from "@statechange/xano-xray";
import { OutputFormat, FORMAT_HELP, parseFormat, outputFormatted, toYaml } from "../format.js";
import { walkStack, collectFunctionCalls, collectWarnings, StackNode } from "../performance/stack-rollup.js";

export function createPerformanceCommand(program: Command) {
  const perf = program
    .command("performance")
    .description("Performance analysis commands");

  perf
    .command("top-endpoints")
    .description("Show top slowest endpoints")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--lookback <hours>", "Hours to look back", "24")
    .option("--limit <limit>", "Number of results to show", "20")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (options) => {
      const { client, instance, workspace, branchId } = await makeClient(options);
      const lookBackHours = parseInt(options.lookback);
      const lookBack = lookBackHours * 60 * 60 * 1000;
      const limit = parseInt(options.limit);
      const format = parseFormat(options.format);

      try {
        // Only show progress to stderr for non-table formats so stdout stays clean
        const log = format === "table"
          ? console.log.bind(console)
          : console.error.bind(console);

        log(`Analyzing performance for last ${lookBackHours} hours...`);
        log(
          `Instance: ${instance}, Workspace: ${workspace}, Branch: ${branchId}`,
        );
        log("This may take a while...\n");

        const analysis = await generateLoadAnalysis(client, {
          instance,
          workspace,
          branch_id: branchId,
          lookBack,
        });

        // Sort by total duration
        const sorted = Object.entries(analysis.requestSummary)
          .map(([source, summary]) => ({
            source,
            ...summary,
          }))
          .sort((a, b) => b.totalDuration - a.totalDuration)
          .slice(0, limit);

        if (format === "json") {
          const output = {
            summary: {
              lookbackHours: lookBackHours,
              reportDurationSeconds: +(analysis.reportDuration / 1000).toFixed(2),
              totalRequests: analysis.totals.totalRequests,
              totalDurationSeconds: +(analysis.totals.totalDuration / 1000).toFixed(2),
              avgDurationSeconds: +(analysis.totals.avgDuration / 1000).toFixed(2),
            },
            endpoints: sorted.map(formatEndpointRecord),
          };
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        if (format === "yaml") {
          const output = {
            summary: {
              lookback_hours: lookBackHours,
              report_duration_seconds: +(analysis.reportDuration / 1000).toFixed(2),
              total_requests: analysis.totals.totalRequests,
              total_duration_seconds: +(analysis.totals.totalDuration / 1000).toFixed(2),
              avg_duration_seconds: +(analysis.totals.avgDuration / 1000).toFixed(2),
            },
            endpoints: sorted.map(formatEndpointRecord),
          };
          console.log(toYaml(output));
          return;
        }

        // Table format
        console.log(
          `Analysis completed in ${(analysis.reportDuration / 1000).toFixed(2)}s`,
        );
        console.log(
          `Total requests analyzed: ${analysis.totals.totalRequests}`,
        );
        console.log(
          `Total duration: ${(analysis.totals.totalDuration / 1000).toFixed(2)}s`,
        );
        console.log(
          `Average duration: ${(analysis.totals.avgDuration / 1000).toFixed(2)}s\n`,
        );

        console.log(`Top ${limit} slowest endpoints:\n`);

        for (const item of sorted) {
          const name = item.name || item.source;
          const type = item.type || "unknown";
          const totalSec = (item.totalDuration / 1000).toFixed(2);
          const avgSec = (item.avgDuration / 1000).toFixed(2);

          console.log(`  ${name}`);
          console.log(`    Type: ${type}  |  Requests: ${item.totalRequests}  |  Total: ${totalSec}s  |  Avg: ${avgSec}s`);
          if (item.verb) {
            console.log(`    Verb: ${item.verb}  |  Status: ${item.status ?? "—"}`);
          }
          if (item.description) {
            console.log(`    Description: ${item.description}`);
          }
          if (item.objectId) {
            console.log(`    ID: ${item.objectId}`);
          }
          console.log();
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  perf
    .command("scan-functions")
    .description(
      "Scan all functions for nested slow steps and performance issues",
    )
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--min-nesting <level>", "Minimum nesting level to report", "2")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (options) => {
      const { client, workspace, branchId } = await makeClient(options);
      const minNesting = parseInt(options.minNesting || "2");
      const format = parseFormat(options.format);

      try {
        const log = format === "table"
          ? console.log.bind(console)
          : console.error.bind(console);

        log(`Scanning functions in workspace ${workspace}...\n`);
        const { functions } = await client.getFunctions(workspace, branchId);
        log(`Found ${functions.length} functions\n`);

        const issues: Array<{
          function: any;
          warnings: Array<{ step: any; warnings: any[]; nestingLevel: number }>;
        }> = [];

        for (const func of functions) {
          const steps = buildStepListFromXray(func);
          const functionWarnings: Array<{
            step: any;
            warnings: any[];
            nestingLevel: number;
          }> = [];

          steps.forEach((step) => {
            const stepWarnings = getStepWarnings(step, func, steps);
            if (stepWarnings.length > 0) {
              const level = nestingLevel(step, func, steps);
              if (level >= minNesting) {
                functionWarnings.push({
                  step,
                  warnings: stepWarnings,
                  nestingLevel: level,
                });
              }
            }
          });

          if (functionWarnings.length > 0) {
            issues.push({
              function: func,
              warnings: functionWarnings,
            });
          }
        }

        if (format === "json") {
          console.log(JSON.stringify({
            minNestingLevel: minNesting,
            totalFunctionsScanned: functions.length,
            issueCount: issues.length,
            functions: issues.map(formatScanIssue),
          }, null, 2));
          return;
        }

        if (format === "yaml") {
          console.log(toYaml({
            min_nesting_level: minNesting,
            total_functions_scanned: functions.length,
            issue_count: issues.length,
            functions: issues.map(formatScanIssue),
          }));
          return;
        }

        // Table format
        if (issues.length === 0) {
          console.log(
            `No functions found with nested slow steps (nesting level >= ${minNesting})`,
          );
          return;
        }

        console.log(
          `Found ${issues.length} function(s) with performance issues:\n`,
        );
        issues.forEach(({ function: func, warnings }) => {
          console.log(`Function: ${func.name} (ID: ${func.id})`);
          if (func.description) {
            console.log(`  Description: ${func.description}`);
          }
          warnings.forEach(({ step, warnings: stepWarnings, nestingLevel: nl }) => {
            console.log(
              `\n  Step ${step.position2 || step.position}: ${step.name} (nesting level: ${nl})`,
            );
            if (step.description) {
              console.log(`    Description: ${step.description}`);
            }
            stepWarnings.forEach((w) => {
              console.log(`    - ${w.description}`);
            });
          });
          console.log();
        });
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  perf
    .command("deep-dive")
    .description("Fully expand a single request's stack tree with timing rollups")
    .argument("<request-id>", "Request ID (from history)")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (requestId, options) => {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);

      try {
        const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
        log(`Fetching request ${requestId}...`);

        const req = await client.getRequest(parseInt(requestId));
        // req.duration is already in seconds (not ms)
        const durationSecs = req.duration ?? 0;

        // Build function name map for resolving function IDs
        const functionMap = new Map<number, string>();
        if (workspace) {
          try {
            const { functions } = await client.getFunctions(workspace, branchId);
            for (const f of functions) {
              functionMap.set(f.id, f.name);
            }
          } catch {
            // Non-fatal — we just won't resolve function names
          }
        }

        const stackTree = walkStack(req.stack || [], durationSecs, undefined, "", functionMap);
        const functionsCalled = collectFunctionCalls(stackTree);
        const warnings = collectWarnings(stackTree);

        const output = {
          request: {
            id: req.id,
            verb: req.verb || null,
            uri: req.uri || null,
            status: req.status ?? null,
            duration_seconds: +durationSecs.toFixed(4),
            created_at: req.created_at || null,
            stack_truncated: req.stack_maxed || false,
          },
          stack: stackTree,
          functions_called: functionsCalled.length > 0 ? functionsCalled : undefined,
          warnings: warnings.length > 0 ? warnings : undefined,
        };

        if (outputFormatted(format, output)) return;

        // Table format
        const r = output.request;
        console.log(`\nRequest ${r.id}:`);
        console.log(`  ${r.verb || ""} ${r.uri || ""} — ${r.status ?? "—"} (${r.duration_seconds}s)`);
        console.log(`  Date: ${r.created_at || "—"}`);
        if (r.stack_truncated) console.log(`  ⚠ Stack was truncated by Xano`);

        console.log(`\nStack Breakdown:\n`);
        printStackTree(stackTree, "  ");

        if (functionsCalled.length > 0) {
          console.log(`\nFunctions Called:\n`);
          for (const fc of functionsCalled) {
            const name = fc.name || `Function ${fc.id}`;
            console.log(`  ${name} (ID: ${fc.id}) — ${fc.call_count} call(s), ${fc.total_seconds}s total`);
          }
        }

        if (warnings.length > 0) {
          console.log(`\nWarnings:\n`);
          for (const w of warnings) {
            console.log(`  - ${w}`);
          }
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  perf
    .command("trace")
    .description("Aggregate stack analysis across multiple executions of an endpoint/task/trigger")
    .argument("<type>", "Object type: endpoint, task, or trigger")
    .argument("<id>", "Object ID (query ID for endpoints, task/trigger ID)")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--samples <n>", "Number of recent executions to analyze", "10")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (type, id, options) => {
      if (!["endpoint", "task", "trigger"].includes(type)) {
        console.error("Error: type must be endpoint, task, or trigger");
        process.exit(1);
      }

      const { client, workspace, branchId } = await makeClient(options);
      const maxSamples = parseInt(options.samples);
      const format = parseFormat(options.format);
      const objectId = parseInt(id);

      try {
        const log = format === "table" ? console.log.bind(console) : console.error.bind(console);

        // Build function name map
        const functionMap = new Map<number, string>();
        if (workspace) {
          try {
            const { functions } = await client.getFunctions(workspace, branchId);
            for (const f of functions) functionMap.set(f.id, f.name);
          } catch { /* non-fatal */ }
        }

        // Fetch history items
        log(`Fetching ${type} ${objectId} history (up to ${maxSamples} samples)...`);
        const historyItems: any[] = [];
        let page = 1;
        while (historyItems.length < maxSamples && page <= 20) {
          let result: { items: any[]; nextPage?: number };
          if (type === "endpoint") {
            result = await client.getRequestHistoryForQuery(objectId, page, branchId);
          } else if (type === "task") {
            result = await client.getTaskHistory(objectId, page);
          } else {
            result = await client.getTriggerHistory(objectId, branchId, page);
          }
          if (!result.items || result.items.length === 0) break;
          historyItems.push(...result.items);
          if (!result.nextPage) break;
          page++;
        }

        const samples = historyItems.slice(0, maxSamples);
        if (samples.length === 0) {
          console.error(`No history found for ${type} ${objectId}`);
          process.exit(1);
        }

        log(`Fetching stack details for ${samples.length} executions...`);

        // Fetch full request details for each sample
        const durations: number[] = [];
        const aggregateByXsid = new Map<string, {
          name: string;
          title?: string;
          totalDirect: number;
          totalRollup: number;
          count: number;
          function_id?: number;
          function_name?: string;
          warnings: Set<string>;
        }>();

        const allFunctionCalls = new Map<number, { name?: string; count: number; totalSecs: number }>();

        for (const item of samples) {
          let detail: any;
          if (type === "task") {
            detail = await client.getTaskHistoryItem(objectId, item.id);
          } else {
            detail = await client.getRequest(item.id);
          }

          const dur = detail.duration ?? 0;
          durations.push(dur);

          if (!detail.stack || detail.stack.length === 0) continue;

          const tree = walkStack(detail.stack, dur, undefined, "", functionMap);

          // Aggregate by _xsid
          aggregateNodes(tree, aggregateByXsid);

          // Collect function calls
          const fcs = collectFunctionCalls(tree);
          for (const fc of fcs) {
            const existing = allFunctionCalls.get(fc.id) || { name: fc.name, count: 0, totalSecs: 0 };
            existing.count += fc.call_count;
            existing.totalSecs += fc.total_seconds;
            if (fc.name) existing.name = fc.name;
            allFunctionCalls.set(fc.id, existing);
          }
        }

        durations.sort((a, b) => a - b);
        const avgDuration = durations.reduce((s, d) => s + d, 0) / durations.length;
        const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
        const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
        const p99 = durations[Math.floor(durations.length * 0.99)] ?? 0;

        // Sort steps by avg rollup time
        const stepBreakdown = Array.from(aggregateByXsid.entries())
          .map(([xsid, data]) => ({
            _xsid: xsid,
            name: data.name,
            title: data.title || undefined,
            avg_direct_seconds: +(data.totalDirect / data.count).toFixed(4),
            avg_rollup_seconds: +(data.totalRollup / data.count).toFixed(4),
            total_rollup_seconds: +data.totalRollup.toFixed(4),
            occurrences: data.count,
            function_id: data.function_id,
            function_name: data.function_name,
            warnings: data.warnings.size > 0 ? Array.from(data.warnings) : undefined,
          }))
          .sort((a, b) => b.total_rollup_seconds - a.total_rollup_seconds);

        const funcSummary = Array.from(allFunctionCalls.entries())
          .map(([fid, info]) => ({
            id: fid,
            name: info.name,
            total_calls: info.count,
            avg_calls_per_request: +(info.count / samples.length).toFixed(1),
            total_seconds: +info.totalSecs.toFixed(4),
            avg_seconds_per_call: info.count > 0 ? +(info.totalSecs / info.count).toFixed(4) : 0,
          }))
          .sort((a, b) => b.total_seconds - a.total_seconds);

        const output = {
          target: { type, id: objectId },
          samples: samples.length,
          duration: {
            avg_seconds: +avgDuration.toFixed(4),
            p50_seconds: +p50.toFixed(4),
            p95_seconds: +p95.toFixed(4),
            p99_seconds: +p99.toFixed(4),
          },
          step_breakdown: stepBreakdown.slice(0, 30),
          functions_called: funcSummary.length > 0 ? funcSummary : undefined,
        };

        if (outputFormatted(format, output)) return;

        // Table format
        console.log(`\nTrace: ${type} ${objectId} (${samples.length} samples)\n`);
        console.log(`  Avg duration: ${avgDuration.toFixed(4)}s  |  p50: ${p50.toFixed(4)}s  |  p95: ${p95.toFixed(4)}s\n`);
        console.log(`Top steps by total time:\n`);
        for (const step of stepBreakdown.slice(0, 20)) {
          const label = step.title || step.name;
          const fnLabel = step.function_name ? ` → ${step.function_name}` : "";
          console.log(`  ${label}${fnLabel}`);
          console.log(`    avg_direct: ${step.avg_direct_seconds}s  avg_rollup: ${step.avg_rollup_seconds}s  total: ${step.total_rollup_seconds}s  (${step.occurrences} occurrences)`);
          if (step.warnings) {
            for (const w of step.warnings) console.log(`    ⚠ ${w}`);
          }
        }

        if (funcSummary.length > 0) {
          console.log(`\nFunctions called:\n`);
          for (const fc of funcSummary) {
            const name = fc.name || `Function ${fc.id}`;
            console.log(`  ${name} (ID: ${fc.id}) — ${fc.avg_calls_per_request} calls/req, ${fc.avg_seconds_per_call}s/call, ${fc.total_seconds}s total`);
          }
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  return perf;
}

/** Aggregate StackNode data by _xsid across multiple executions */
function aggregateNodes(
  nodes: StackNode[],
  acc: Map<string, {
    name: string;
    title?: string;
    totalDirect: number;
    totalRollup: number;
    count: number;
    function_id?: number;
    function_name?: string;
    warnings: Set<string>;
  }>,
) {
  for (const node of nodes) {
    const key = node._xsid || `pos:${node.position}:${node.name}`;
    const existing = acc.get(key) || {
      name: node.name,
      title: node.title,
      totalDirect: 0,
      totalRollup: 0,
      count: 0,
      function_id: node.function_id,
      function_name: node.function_name,
      warnings: new Set<string>(),
    };
    existing.totalDirect += node.direct_seconds;
    existing.totalRollup += node.rollup_seconds;
    existing.count++;
    if (node.function_id) existing.function_id = node.function_id;
    if (node.function_name) existing.function_name = node.function_name;
    if (node.warning) existing.warnings.add(node.warning);
    acc.set(key, existing);
    aggregateNodes(node.children, acc);
  }
}

function printStackTree(nodes: StackNode[], indent: string) {
  for (const node of nodes) {
    const label = node.title || node.name;
    const fnLabel = node.function_name ? ` → ${node.function_name}` : "";
    const iterLabel = node.iterations ? ` ×${node.iterations}` : "";
    const pctLabel = `${node.pct_of_total}%`;
    const warnLabel = node.warning ? ` ⚠ ${node.warning}` : "";

    console.log(
      `${indent}${node.position} ${label}${fnLabel}${iterLabel}  ` +
      `direct: ${node.direct_seconds}s  rollup: ${node.rollup_seconds}s  (${pctLabel})${warnLabel}`
    );

    if (node.children.length > 0) {
      printStackTree(node.children, indent + "  ");
    }
  }
}

/** Format an endpoint record for JSON/YAML output */
function formatEndpointRecord(item: RequestSummary & { source: string }) {
  const record: Record<string, any> = {
    name: item.name || item.source,
    type: item.type || "unknown",
    id: item.objectId ?? null,
    requests: item.totalRequests,
    total_duration_seconds: +(item.totalDuration / 1000).toFixed(2),
    avg_duration_seconds: +(item.avgDuration / 1000).toFixed(2),
  };
  if (item.verb) record.verb = item.verb;
  if (item.status != null) record.status = item.status;
  if (item.description) record.description = item.description;
  record.source_key = item.source;
  return record;
}

/** Format a scan issue for JSON/YAML output */
function formatScanIssue(issue: { function: any; warnings: Array<{ step: any; warnings: any[]; nestingLevel: number }> }) {
  const func = issue.function;
  return {
    name: func.name,
    id: func.id,
    description: func.description || null,
    steps: issue.warnings.map(({ step, warnings, nestingLevel: nl }) => ({
      position: step.position2 || step.position,
      name: step.name,
      description: step.description || null,
      nesting_level: nl,
      warnings: warnings.map((w: any) => w.description),
    })),
  };
}
