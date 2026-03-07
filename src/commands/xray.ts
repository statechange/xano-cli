/**
 * X-Ray CLI Commands
 */

import { Command } from "commander";
import {
  buildStepListFromXray,
  getFunctionDependencies,
  getStepWarnings,
  analyzeStack,
} from "@statechange/xano-xray";
import { makeClient } from "../registry-client.js";
import { FORMAT_HELP, parseFormat, outputFormatted } from "../format.js";

export function createXRayCommand(program: Command) {
  const xray = program.command("xray").description("X-Ray analysis commands");

  xray
    .command("function")
    .description("Analyze a function's X-Ray data")
    .requiredOption("--id <id>", "Function ID")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (options) => {
      const { client, workspace: workspaceId, branchId } = await makeClient(options);
      const functionId = parseInt(options.id);
      const format = parseFormat(options.format);

      try {
        const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
        log(`Fetching function ${functionId}...`);
        const func = await client.getFunction(functionId, workspaceId ?? undefined, branchId);

        // Build step list
        const steps = buildStepListFromXray(func);

        // Analyze for warnings
        const warnings: Array<{ step: any; warnings: any[] }> = [];
        steps.forEach((step) => {
          const stepWarnings = getStepWarnings(step, func);
          if (stepWarnings.length > 0) {
            warnings.push({ step, warnings: stepWarnings });
          }
        });

        // Analyze stack
        const analysis = analyzeStack(func);

        // Function dependencies
        let dependencies: Array<{ id: number; name: string }> = [];
        if (workspaceId) {
          try {
            const { functions } = await client.getFunctions(
              workspaceId,
              branchId,
            );
            const depIds = getFunctionDependencies(func, { functions });
            dependencies = Array.from(depIds).map((depId) => {
              const dep = functions.find((f) => f.id === depId);
              return { id: depId, name: dep?.name || `Function ${depId}` };
            });
          } catch (e) {
            // Silently fail if we can't get dependencies
          }
        }

        const data = {
          id: func.id,
          name: func.name,
          description: func.description || null,
          total_steps: steps.length,
          steps: steps.map((step: any) => ({
            position: step.position2 || step.position,
            name: step.name,
            description: step.description || null,
            disabled: !!(step.disabled || step.inheritedDisabled),
          })),
          warnings: warnings.map(({ step, warnings: sw }) => ({
            position: step.position2 || step.position,
            step_name: step.name,
            issues: sw.map((w: any) => w.description),
          })),
          stack_analysis: {
            has_errors: analysis.isError || false,
            has_warnings: analysis.isWarning || false,
          },
          dependencies,
        };

        if (outputFormatted(format, data)) return;

        // Table output
        console.log(`\nFunction: ${func.name}`);
        if (func.description) {
          console.log(`Description: ${func.description}`);
        }
        console.log(`ID: ${func.id}`);

        console.log(`\nTotal steps: ${steps.length}`);

        console.log("\nStep hierarchy:");
        steps.forEach((step) => {
          const indent = "  ".repeat(step.position2?.split(".").length || 0);
          const status =
            step.disabled || step.inheritedDisabled ? "[DISABLED] " : "";
          console.log(
            `${indent}${status}${step.position2 || step.position}: ${step.name}${step.description ? ` - ${step.description}` : ""}`,
          );
        });

        if (warnings.length > 0) {
          console.log("\nPerformance Warnings:");
          warnings.forEach(({ step, warnings: stepWarnings }) => {
            console.log(`\n  ${step.position2 || step.position}: ${step.name}`);
            stepWarnings.forEach((w) => {
              console.log(`    - ${w.description}`);
            });
          });
        }

        if (analysis.isError || analysis.isWarning) {
          console.log("\nStack Analysis:");
          if (analysis.isError) console.log("  - Has errors");
          if (analysis.isWarning) console.log("  - Has warnings");
        }

        if (dependencies.length > 0) {
          console.log("\nFunction Dependencies:");
          dependencies.forEach((dep) => {
            console.log(`  - ${dep.name} (ID: ${dep.id})`);
          });
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  xray
    .command("scan-workspace")
    .description("Scan all functions in workspace for X-Ray issues")
    .option("--instance <instance>", "Xano instance (e.g., app.xano.com)")
    .option("--workspace <workspace>", "Workspace ID")
    .option("--branch <branch>", "Branch ID", "0")
    .option("--token <token>", "Xano API token")
    .option("--api-key <key>", "StateChange API key (overrides saved key)")
    .option("--include-warnings", "Include warnings in output")
    .option("--format <format>", FORMAT_HELP, "table")
    .action(async (options) => {
      const { client, workspace, branchId } = await makeClient(options);
      const format = parseFormat(options.format);

      try {
        const log = format === "table" ? console.log.bind(console) : console.error.bind(console);
        log(`Scanning workspace ${workspace}...\n`);
        const { functions } = await client.getFunctions(workspace, branchId);
        log(`Found ${functions.length} functions\n`);

        const errors: Array<{ function: any; analysis: any }> = [];
        const warnings: Array<{ function: any; analysis: any }> = [];

        for (const func of functions) {
          const analysis = analyzeStack(func);
          if (analysis.isError) {
            errors.push({ function: func, analysis });
          }
          if (options.includeWarnings && analysis.isWarning) {
            warnings.push({ function: func, analysis });
          }
        }

        const data = {
          total_functions_scanned: functions.length,
          errors: errors.map(({ function: f }) => ({
            id: f.id,
            name: f.name,
            description: f.description || null,
          })),
          warnings: options.includeWarnings
            ? warnings.map(({ function: f }) => ({
                id: f.id,
                name: f.name,
                description: f.description || null,
              }))
            : undefined,
        };

        if (outputFormatted(format, data)) return;

        if (errors.length > 0) {
          console.log(`Functions with errors (${errors.length}):\n`);
          errors.forEach(({ function: func }) => {
            console.log(`  - ${func.name} (ID: ${func.id})`);
            if (func.description) console.log(`    ${func.description}`);
          });
          console.log();
        }

        if (warnings.length > 0) {
          console.log(`Functions with warnings (${warnings.length}):\n`);
          warnings.forEach(({ function: func }) => {
            console.log(`  - ${func.name} (ID: ${func.id})`);
            if (func.description) console.log(`    ${func.description}`);
          });
          console.log();
        }

        if (errors.length === 0 && warnings.length === 0) {
          console.log("No issues found!");
        }
      } catch (error: any) {
        console.error("Error:", error.message);
        process.exit(1);
      }
    });

  return xray;
}
