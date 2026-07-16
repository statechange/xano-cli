# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

This repository is the canonical standalone State Change CLI for Xano. It is graveyard-managed: work is tracked in GitHub issues and autonomous shifts should leave resumable state in issues, pull requests, and the project docs linked below.

repo-type: code
project-types: none

Technical decisions live in `docs/DECISIONS.md`, architecture in `docs/ARCHITECTURE.md`, and strategic state in the Notion Project Overview linked from `docs/OVERVIEW.md`.

## Build & Run

```bash
npm run build          # tsc → dist/
npm run dev            # tsc --watch
node dist/index.js     # run CLI directly
npx tsx src/index.ts   # run from source without building
```

Behavioral tests use Node's built-in test runner with TypeScript loaded through
`tsx`:

```bash
npm test
```

## Architecture

This is a Commander.js CLI (`sc-xano`) that talks to Xano's private `api:mvp-admin` endpoints — the same APIs that power the Xano dashboard, not the public Meta API.

### Core layers

- **`src/index.ts`** — Entry point. Registers all subcommands with Commander and parses argv.
- **`src/xano-client.ts`** — `XanoClient` (workspace operations via `api:mvp-admin`) and `XanoMasterClient` (instance-level operations via `api:master` on app.xano.com). All sink endpoints are cached in-memory with 60s TTL; write operations flush the cache.
- **`src/auth.ts`** — Manages StateChange API key persistence in `~/.statechange/auth.json`. Exchanges API key for short-lived auth token via StateChange backend.
- **`src/registry-client.ts`** — Resolves requested instance identity, workspace ID, and Xano token from the StateChange backend (`api.statechange.ai`). It may discover a canonical `.xano.io` CNAME as routing metadata, but that derived hostname must remain separate from credential identity and saved user intent.
- **`src/format.ts`** — Shared `outputFormatted()`, `toYaml()`, `parseFormat()`, `FORMAT_HELP`. All commands support `--format table|json|yaml`.
- **`src/performance/load-analysis.ts`** — Aggregates request/trigger/task/MCP history into performance summaries.
- **`src/performance/stack-rollup.ts`** and **`src/performance/trace-analysis.ts`** — Walk and aggregate runtime execution stacks for `performance deep-dive` and `performance trace`. `TRACE-DEEP-DIVE-PLAN.md` records the shipped design history; current behavior is documented in README and the bundled performance skill.
- **`src/documentation/`** — Markdown export for workspaces (ported from the browser extension’s `documentation.ts`). Loads sinks + `api:mvp-admin/mvp/xs` and uses `buildStepListFromXray` from `@statechange/xano-xray`.

### Command pattern

Each file in `src/commands/` exports a `create*Command(program)` function that attaches a subcommand group. Every command follows the same pattern:

1. Call `makeClient(options)` which resolves instance/workspace/token via the registry client
2. Use the `XanoClient` to fetch data (sink endpoints are preferred over individual-object endpoints)
3. Output via `outputFormatted(format, data)` for json/yaml, or custom table rendering for `table` format

### Key constraints

- **Sink-based lookups**: Individual object endpoints (`function/{id}`) return 404 on custom domains. Always use sink/list endpoints and pluck by ID.
- **Connection identities**: Keep the user-requested instance, registry credential identity, request hostname, and optional canonical CNAME distinct. Do not let DNS routing silently change which credential record is selected; see `docs/DECISIONS.md` and issue #2.
- **Zero-flag design**: Instance, workspace, and token auto-resolve from StateChange backend. Single-instance users need no flags after `auth init`.
- **`@statechange/xano-xray`**: Shared analysis library (also used by the browser extension) that provides `analyzeAPI`, `analyzeFunction`, etc.

### Origin: browser extension

This CLI was extracted from the `cli/` directory of `../GitHub/parcel-test-2`, a Chrome extension for Xano workspace analysis. That repo is the reference for patterns, prior art, and logic to port — particularly:

- `src/workers/xanoapi.ts` — original Xano API client (basis for `xano-client.ts`)
- `src/content/performance.ts` — origin of the `perfByXsid()` rollup idea. The CLI shipped a deliberately redesigned recursive stack walker in `src/performance/stack-rollup.ts`; see `TRACE-DEEP-DIVE-PLAN.md` for the design history and verified payload boundary.
- `src/workers/` — background workers with analysis pipelines

When adding new features, check the extension repo first for existing implementations.

### Credential resolution order

For instance, workspace, and token: CLI flag → env var → `~/.statechange/auth.json` → StateChange backend auto-detect (if single instance).
