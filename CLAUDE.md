# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # tsc → dist/
npm run dev            # tsc --watch
node dist/index.js     # run CLI directly
npx tsx src/index.ts   # run from source without building
```

No test framework is configured. There are no tests.

## Architecture

This is a Commander.js CLI (`sc-xano`) that talks to Xano's private `api:mvp-admin` endpoints — the same APIs that power the Xano dashboard, not the public Meta API.

### Core layers

- **`src/index.ts`** — Entry point. Registers all subcommands with Commander and parses argv.
- **`src/xano-client.ts`** — `XanoClient` (workspace operations via `api:mvp-admin`) and `XanoMasterClient` (instance-level operations via `api:master` on app.xano.com). All sink endpoints are cached in-memory with 60s TTL; write operations flush the cache.
- **`src/auth.ts`** — Manages StateChange API key persistence in `~/.statechange/auth.json`. Exchanges API key for short-lived auth token via StateChange backend.
- **`src/registry-client.ts`** — Resolves instance hostname, workspace ID, and Xano token from the StateChange backend (`api.statechange.ai`). Handles CNAME resolution for custom domains → `.xano.io` hostnames (required because `api:mvp-admin` only works on raw Xano hostnames).
- **`src/format.ts`** — Shared `outputFormatted()`, `toYaml()`, `parseFormat()`, `FORMAT_HELP`. All commands support `--format table|json|yaml`.
- **`src/performance/load-analysis.ts`** — Aggregates request/trigger/task/MCP history into performance summaries.

### Command pattern

Each file in `src/commands/` exports a `create*Command(program)` function that attaches a subcommand group. Every command follows the same pattern:

1. Call `makeClient(options)` which resolves instance/workspace/token via the registry client
2. Use the `XanoClient` to fetch data (sink endpoints are preferred over individual-object endpoints)
3. Output via `outputFormatted(format, data)` for json/yaml, or custom table rendering for `table` format

### Key constraints

- **Sink-based lookups**: Individual object endpoints (`function/{id}`) return 404 on custom domains. Always use sink/list endpoints and pluck by ID.
- **CNAME resolution**: Custom domains must be resolved to raw `.xano.io` hostnames via DNS CNAME lookup before making `api:mvp-admin` calls.
- **Zero-flag design**: Instance, workspace, and token auto-resolve from StateChange backend. Single-instance users need no flags after `auth init`.
- **`@statechange/xano-xray`**: Shared analysis library (also used by the browser extension) that provides `analyzeAPI`, `analyzeFunction`, etc.

### Origin: browser extension

This CLI was extracted from the `cli/` directory of `../GitHub/parcel-test-2`, a Chrome extension for Xano workspace analysis. That repo is the reference for patterns, prior art, and logic to port — particularly:

- `src/workers/xanoapi.ts` — original Xano API client (basis for `xano-client.ts`)
- `src/content/performance.ts` — `perfByXsid()` rollup logic for deep-dive performance analysis (not yet ported)
- `src/workers/` — background workers with analysis pipelines

When adding new features, check the extension repo first for existing implementations.

### Credential resolution order

For instance, workspace, and token: CLI flag → env var → `~/.statechange/auth.json` → StateChange backend auto-detect (if single instance).
