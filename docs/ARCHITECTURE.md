# Architecture

`sc-xano` is a Commander.js CLI that combines State Change registry authentication with Xano's private admin APIs. The package entry point is `src/index.ts`; compiled output is published from `dist/`.

## Request flow

1. A command in `src/commands/` receives flags and calls `makeClient()` in `src/registry-client.ts`.
2. Registry resolution combines explicit flags, environment variables, persisted State Change auth, and the State Change backend to select an instance, workspace, and Xano token.
3. `XanoClient` in `src/xano-client.ts` performs workspace operations against `api:mvp-admin`; `XanoMasterClient` handles instance-level `api:master` operations.
4. Commands format output through `src/format.ts` or a command-specific table renderer.

The connection layer must keep requested identity, credential identity, request hostname, optional canonical hostname, workspace, and token separate. DNS/CNAME information is routing metadata, not permission to silently choose a different registry record.

## Command surface

- `src/index.ts` registers all Commander subcommands.
- `src/commands/` contains one command group per operational area: auth, inventory, performance, xray, audit, history, logs, docs, health, secure, and XanoScript.
- `src/commands/xanoscript.ts` maps public object-type selectors to Xano schema kinds and owns single-object generation plus bulk export.
- `src/documentation/` exports workspace objects as Markdown using sink data and `@statechange/xano-xray` step analysis.
- `src/performance/load-analysis.ts` aggregates execution history into request, trigger, task, and MCP performance summaries.

## Runtime performance analysis

`performance deep-dive` fetches one request detail and uses
`src/performance/stack-rollup.ts` to produce a recursive timing tree.
`performance trace` fetches endpoint, task, or trigger history, computes duration
percentiles in the command layer, and uses `src/performance/trace-analysis.ts`
for target metadata, structural ancestry, conservative function identity and
single-target ROI, plus high-confidence actionable issues. The command derives
additive flat hotspots from stack aggregates. Runtime `timing` is inclusive;
direct time subtracts child rollups.

Runtime coordinates and IDs are used only when the payload supports them.
Fallback positions are deterministic, static function identity must be exact,
unambiguous, and version-aligned, and missing facts remain explicitly
unresolved. Runtime counts, retained nodes, loop iterations, and function
invocations stay distinct; truncation marks retained counts incomplete.
`TRACE-DEEP-DIVE-PLAN.md` records the payload boundary and design history,
including the hardening completed in issues #9 and #10. README and the bundled
performance skill are the current behavior reference.

## Data-access constraints

- Prefer sink/list endpoints and select objects locally. Individual-object admin endpoints are unreliable on custom domains.
- Read commands may resolve credentials automatically; explicit CLI flags and environment tokens remain authoritative.
- Sink responses are cached in memory for 60 seconds. Writes flush the relevant cache.
- Four subcommands intentionally mutate a live Xano instance: `logs set`, `secure swagger`, `health clear-history`, and `health restart-tasks`. Authentication persists local configuration, while documentation and XanoScript exports write only user-requested local files; other operational commands are read-only against Xano.

## XanoScript export boundary

XanoScript generation calls `api:mvp-admin/mvp/xs` after loading objects from the relevant sink. Bulk export behavior and its verification contract are documented with the command implementation and tests.

## Build and verification

- `npm run build` compiles TypeScript to `dist/`.
- `npm start -- <command>` runs the compiled CLI.
- `npx tsx src/index.ts <command>` runs from source.
- `npm test` runs the behavioral test suite.
- Targeted live read-only commands remain the executable verification surface for external Xano payload behavior that fixtures cannot establish.
