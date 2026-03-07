# @statechange/xano-cli

CLI for Xano workspace management, performance analysis, XanoScript generation, and operational insights. Uses Xano's private APIs to provide capabilities not available through the standard Meta API.

## Installation

```bash
npm install -g @statechange/xano-cli
```

Or run directly with npx:

```bash
npx @statechange/xano-cli <command>
```

## Quick Start

```bash
# 1. Authenticate with your StateChange API key
sc-xano auth init --api-key <your-api-key>

# 2. Verify connection and see available instances
sc-xano auth whoami

# 3. Check your Xano session health
sc-xano auth status

# 4. Run commands (instance, workspace, and token auto-resolve)
sc-xano inventory workspace
sc-xano performance top-endpoints
sc-xano audit workspace
```

Once authenticated, the CLI auto-resolves your Xano instance, workspace, and token from the StateChange backend. No extra flags needed if you have a single instance.

## Authentication & Session Management

The CLI uses a StateChange API key to fetch Xano credentials automatically:

```bash
# Interactive setup
sc-xano auth init

# Or provide key directly
sc-xano auth init --api-key <key>

# Check auth status
sc-xano auth whoami

# Check Xano token health
sc-xano auth status

# Override defaults
sc-xano auth set-instance <hostname> --workspace <id>
```

### Session Freshness

Your Xano session token is refreshed whenever you open Xano in the browser with the StateChange extension active. The CLI monitors token health automatically:

- **Fresh token** — commands run normally
- **Stale token** — a warning is shown, but commands still proceed
- **Expired token** — a warning is shown; if Xano rejects the request, the CLI prompts you to open Xano and polls until the session is refreshed
- **401/403 errors** — the CLI advises running `auth status` to diagnose

Run `sc-xano auth status` at any time to check your session.

### Fallback Options

You can also provide credentials directly via flags or environment variables:

| Flag | Environment Variable | Description |
|------|---------------------|-------------|
| `--api-key` | `STATECHANGE_API_KEY` | StateChange API key |
| `--instance` | `XANO_INSTANCE` | Xano instance hostname |
| `--workspace` | `XANO_WORKSPACE` | Workspace ID |
| `--token` | `XANO_TOKEN` | Xano API token |
| `--branch` | — | Branch ID (default: 0) |
| `--format` | — | Output format: `table`, `json`, or `yaml` |

All commands support `--format table` (default, human-readable), `--format json`, and `--format yaml`. The yaml format is recommended for AI/LLM consumption.

## Commands

### `inventory` — Workspace Overview

```bash
sc-xano inventory workspace           # Object counts summary
sc-xano inventory functions            # List functions with tags
sc-xano inventory tables               # List database tables
sc-xano inventory tasks                # List background tasks
sc-xano inventory triggers             # List triggers
sc-xano inventory addons               # List addons
sc-xano inventory middleware           # List middleware
sc-xano inventory mcp-servers          # List MCP/toolset servers
```

### `performance` — Performance Analysis

Find slow endpoints, trace execution bottlenecks, and deep-dive into request stacks.

```bash
# Top slowest endpoints (last 24 hours)
sc-xano performance top-endpoints
sc-xano performance top-endpoints --lookback 48 --limit 10

# Trace: aggregate stack analysis across multiple executions
sc-xano performance trace endpoint <query-id> --samples 10
sc-xano performance trace task <task-id> --samples 10
sc-xano performance trace trigger <trigger-id> --samples 10

# Deep-dive: full stack expansion for a single request
sc-xano performance deep-dive <request-id>

# Scan functions for nested slow steps
sc-xano performance scan-functions
sc-xano performance scan-functions --min-nesting 3

# Use yaml for AI-driven analysis
sc-xano performance top-endpoints --format yaml
sc-xano performance deep-dive <request-id> --format yaml
```

**Trace** aggregates timing data across N samples, showing duration percentiles (avg, p50, p95, p99) and per-step breakdown by `_xsid`.

**Deep-dive** expands a single request's stack into a tree with direct vs rollup timing, percentage breakdowns, loop iteration counts, and warnings for slow steps inside loops (N+1 queries, lambda blocks, external API calls).

### `xray` — Function Analysis

Analyze function internals: step hierarchy, performance warnings, dependencies.

```bash
sc-xano xray function --id <function-id>
sc-xano xray scan-workspace
sc-xano xray scan-workspace --include-warnings
```

### `audit` — Workspace Auditing

```bash
sc-xano audit workspace        # API configurations
sc-xano audit swagger           # Unsecured Swagger endpoints
sc-xano audit database          # Table schemas and indexes
sc-xano audit middleware
sc-xano audit addons
sc-xano audit tasks
sc-xano audit triggers
sc-xano audit mcp-servers
```

### `secure` — Security Management

```bash
sc-xano secure swagger --app-id <id> --disable           # Disable Swagger
sc-xano secure swagger --app-id <id> --require-token      # Require token
```

### `history` — Execution History

```bash
sc-xano history requests                          # Recent API requests
sc-xano history requests --page 2                 # Paginate
sc-xano history request <request-id>              # Detailed request info
sc-xano history tasks <task-id>                   # Task execution history
sc-xano history task-run <task-id> <run-id>       # Detailed task run
sc-xano history triggers <trigger-id>             # Trigger history
sc-xano history mcp-servers <tool-id>             # MCP server history
```

### `logs` — Log Retention Management

View and control how much execution history Xano retains per endpoint, task, or trigger.

```bash
# View retention settings
sc-xano logs show                             # All objects
sc-xano logs show --custom-only               # Only non-default settings
sc-xano logs show endpoint <id>               # Single endpoint with parent app context
sc-xano logs show app <id>                    # App + all its endpoints

# Update retention
sc-xano logs set endpoint <id> --limit -1     # Unlimited (for debugging)
sc-xano logs set endpoint <id> --limit 100    # Default
sc-xano logs set endpoint <id> --limit 0      # Disable

# Watch for new executions in real-time
sc-xano logs watch endpoint <id>
```

Useful when performance deep-dives show `stack_truncated: true` — set the limit to unlimited, trigger a new execution, then deep-dive the untruncated result.

### `xanoscript` — XanoScript Generation & Conversion

```bash
sc-xano xanoscript generate function <id>
sc-xano xanoscript generate table <id>
sc-xano xanoscript generate api <id>

sc-xano xanoscript export-all --type function
sc-xano xanoscript export-all --type table --output-dir ./backup

sc-xano xanoscript convert myfunction.xs
cat myfunction.xs | sc-xano xanoscript convert
```

### `health` — Instance Health (Master API)

```bash
sc-xano health instances
sc-xano health database --instance-id <id>
sc-xano health clear-history --instance-id <id>
sc-xano health restart-tasks --instance-id <id>
```

### `flush` — Cache Management

```bash
sc-xano flush     # Clear cached sink data
```

## How It Works

This CLI uses Xano's private `api:mvp-admin` endpoints (the same APIs that power the Xano dashboard) to provide operational capabilities beyond the public Meta API.

| Capability | This CLI | Xano MCP |
|-----------|----------|----------|
| Live workspace data | Yes | No |
| Performance analysis | Yes | No |
| Execution history | Yes | No |
| Log retention management | Yes | No |
| XanoScript generation | Yes | No |
| XanoScript validation | No | Yes |
| XanoScript docs | No | Yes |
| Meta API docs | No | Yes |

## AI Integration

The recommended way to use this CLI with AI coding assistants is to install the skills:

```bash
npx skills add @statechange/xano-cli
```

This teaches your AI agent how to use the CLI for workspace management and performance analysis workflows. Skills are included in the `skills/` directory of the package.

For manual use, add `--format yaml` to any command for the most token-efficient structured output.

## License

MIT
