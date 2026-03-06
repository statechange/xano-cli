/**
 * Performance CLI Commands
 */

import { Command } from "commander";
import { XanoClient } from "../xano-client.js";
import { generateLoadAnalysis, RequestSummary } from "../performance/load-analysis.js";
import { resolveXanoToken, resolveInstance, resolveWorkspace } from "../registry-client.js";
import {
  buildStepListFromXray,
  getStepWarnings,
  nestingLevel,
} from "@statechange/xano-xray";
import { OutputFormat, FORMAT_HELP, parseFormat, outputFormatted, toYaml } from "../format.js";

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
      const instance = await resolveInstance({ instance: options.instance, apiKey: options.apiKey });
      if (!instance) {
        console.error(
          "Error: Xano instance required (--instance or XANO_INSTANCE env var)",
        );
        process.exit(1);
      }

      const token = await resolveXanoToken({
        instance,
        token: options.token,
        apiKey: options.apiKey,
      });
      if (!token) {
        console.error(
          "Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')",
        );
        process.exit(1);
      }

      const workspace = await resolveWorkspace({ workspace: options.workspace, apiKey: options.apiKey });
      if (!workspace) {
        console.error(
          "Error: Workspace ID required (--workspace or XANO_WORKSPACE env var)",
        );
        process.exit(1);
      }

      const branchId = parseInt(options.branch);
      const lookBackHours = parseInt(options.lookback);
      const lookBack = lookBackHours * 60 * 60 * 1000;
      const limit = parseInt(options.limit);
      const format = parseFormat(options.format);

      const client = new XanoClient({ instance, token });

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
      const instance = await resolveInstance({ instance: options.instance, apiKey: options.apiKey });
      if (!instance) {
        console.error(
          "Error: Xano instance required (--instance or XANO_INSTANCE env var)",
        );
        process.exit(1);
      }

      const token = await resolveXanoToken({
        instance,
        token: options.token,
        apiKey: options.apiKey,
      });
      if (!token) {
        console.error(
          "Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')",
        );
        process.exit(1);
      }

      const workspace = await resolveWorkspace({ workspace: options.workspace, apiKey: options.apiKey });
      if (!workspace) {
        console.error(
          "Error: Workspace ID required (--workspace or XANO_WORKSPACE env var)",
        );
        process.exit(1);
      }

      const branchId = parseInt(options.branch);
      const minNesting = parseInt(options.minNesting || "2");
      const format = parseFormat(options.format);
      const client = new XanoClient({ instance, token });

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

  return perf;
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
