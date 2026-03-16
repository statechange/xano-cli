# @statechange/xano-cli

[![npm version](https://img.shields.io/npm/v/@statechange/xano-cli.svg)](https://www.npmjs.com/package/@statechange/xano-cli)
[![npm downloads](https://img.shields.io/npm/dm/@statechange/xano-cli.svg)](https://www.npmjs.com/package/@statechange/xano-cli)
[![license](https://img.shields.io/npm/l/@statechange/xano-cli.svg)](https://github.com/statechange/xano-cli/blob/main/LICENSE)

CLI for Xano performance analysis, operational insights, and critical security and restart abilities. Provides capabilities offered in the [State Change Extension for Xano](https://chromewebstore.google.com/detail/statechange-power-tools-f/jgednopabapolfhfbgipkkigkafnlmla).

### Requirements

- A [State Change](https://statechange.ai) subscription
- The [State Change browser extension](https://chromewebstore.google.com/detail/statechange-power-tools-f/jgednopabapolfhfbgipkkigkafnlmla) installed and having previously been active on your instance in Chrome (or a supported browser)

## Getting Started with AI Agents

The fastest way to put this CLI to work is to install the skills into your AI coding agent:

```bash
npx skills add @statechange/xano-cli
```

This teaches your agent (Claude Code, Cursor, etc.) how to analyze performance bottlenecks, trace slow endpoints, audit security, and generate XanoScript — all through natural conversation.

## Installation

```bash
npm install -g @statechange/xano-cli
```

Or run directly with npx (no install needed):

```bash
npx @statechange/xano-cli <command>
```

## Quick Start

```bash
# 1. Authenticate via browser (opens automatically)
sc-xano auth login

# 2. Verify connection and see available instances
sc-xano auth whoami

# 3. Run commands (instance, workspace, and token auto-resolve)
sc-xano inventory workspace
sc-xano performance top-endpoints
sc-xano audit workspace
```

Once authenticated, the CLI auto-resolves your Xano instance, workspace, and token from the StateChange backend. No extra flags needed if you have a single instance.

## Safety: Read-Only vs Write Commands

Most commands are **read-only** and safe to run without side effects. Four commands **write** to the Xano instance — confirm with the user before running these:

| Command | Effect |
|---------|--------|
| `logs set` | Changes history retention settings on endpoints, tasks, or triggers |
| `secure swagger` | Modifies API app Swagger/documentation configuration |
| `health clear-history` | Deletes history database tables on the instance |
| `health restart-tasks` | Restarts the task service deployment |

All other commands are **read-only**.

## Commands

### `auth` — Authentication & Session Management

```bash
sc-xano auth login                       # Authenticate via browser (device code flow) — recommended
sc-xano auth init                        # Interactive API key setup (manual)
sc-xano auth init --api-key <key>        # Direct API key setup
sc-xano auth whoami                      # Verify auth and list instances
sc-xano auth status                      # Check Xano token health and session freshness
sc-xano auth set-instance <host>         # Save default instance
sc-xano auth set-instance <host> --workspace <id>  # Save default instance and workspace
```

#### Session Freshness

Your Xano session token is refreshed whenever you open Xano in the browser with the StateChange extension active. The CLI monitors token health automatically:

- **Fresh token** — commands run normally
- **Stale token** — a warning is shown, but commands still proceed
- **Expired token** — a warning is shown; if Xano rejects the request, the CLI prompts you to open Xano and polls until the session is refreshed
- **401/403 errors** — the CLI advises running `auth status` to diagnose

### `performance` — Performance Analysis (read-only)

Find slow endpoints, trace execution bottlenecks, and deep-dive into request stacks.

```bash
# Rank all endpoints/tasks/triggers by total server time
sc-xano performance top-endpoints                       # Last 24 hours
sc-xano performance top-endpoints --lookback 48         # Custom lookback (hours)
sc-xano performance top-endpoints --limit 10            # Limit results

# Trace: aggregate stack analysis across multiple executions
sc-xano performance trace endpoint <query-id>           # Endpoint trace
sc-xano performance trace task <task-id>                # Task trace
sc-xano performance trace trigger <trigger-id>          # Trigger trace
sc-xano performance trace endpoint <id> --samples 20   # Custom sample count

# Deep-dive: full stack expansion for a single request
sc-xano performance deep-dive <request-id>

# Scan all functions for nested slow steps
sc-xano performance scan-functions
sc-xano performance scan-functions --min-nesting 3      # Custom nesting threshold
```

**Trace** aggregates timing data across N samples, showing duration percentiles (avg, p50, p95, p99) and per-step breakdown by `_xsid`. Steps with high occurrences relative to samples indicate they run inside loops.

**Deep-dive** expands a single request's stack into a recursive tree with direct vs rollup timing, percentage breakdowns (`pct_of_total`, `pct_of_parent`), loop iteration counts, and warnings for slow steps inside loops (N+1 queries, lambda blocks, external API calls).

### `xray` — Function Analysis (read-only)

Static analysis of function internals: step hierarchy, performance warnings, dependencies on other functions.

```bash
sc-xano xray function --id <function-id>        # Analyze a single function
sc-xano xray scan-workspace                      # Scan all functions for errors
sc-xano xray scan-workspace --include-warnings   # Include warnings (not just errors)
```

### `audit` — Security Auditing (read-only)

Audit workspace objects for configuration issues, unsecured endpoints, and schema problems.

```bash
sc-xano audit workspace        # Audit all API group configurations
sc-xano audit swagger           # Find unsecured Swagger/documentation endpoints
sc-xano audit database          # Audit table schemas, indexes, and relationships
sc-xano audit middleware        # Audit middleware configurations
sc-xano audit addons            # Audit addon configurations
sc-xano audit tasks             # Audit background task configurations
sc-xano audit triggers          # Audit trigger configurations
sc-xano audit mcp-servers       # Audit MCP/toolset server configurations
```

### `secure` — Security Management (WRITE)

Apply security changes to workspace objects. **These commands modify your Xano instance.**

```bash
sc-xano secure swagger --app-id <id> --disable           # Disable Swagger entirely
sc-xano secure swagger --app-id <id> --require-token      # Require token for Swagger access
```

### `history` — Execution History (read-only)

Browse request, task, trigger, and MCP server execution history.

```bash
# API request history
sc-xano history requests                          # Recent requests (page 1)
sc-xano history requests --page 2                 # Paginate
sc-xano history request <request-id>              # Full request detail (stack, timing, I/O)

# Task history
sc-xano history tasks <task-id>                   # List task executions
sc-xano history task-run <task-id> <run-id>       # Detailed task run

# Trigger history
sc-xano history triggers <trigger-id>             # List trigger executions

# MCP server history
sc-xano history mcp-servers <tool-id>             # List MCP server executions
```

### `logs` — Log Retention Management (show/watch read-only, set is WRITE)

View and control how much execution history Xano retains per endpoint, task, or trigger. Useful when performance deep-dives show `stack_truncated: true`. **`logs set` modifies your Xano instance.**

```bash
# View retention settings
sc-xano logs show                             # All objects' retention settings
sc-xano logs show --custom-only               # Only objects with non-default settings
sc-xano logs show endpoint <id>               # Single endpoint with parent app context
sc-xano logs show app <id>                    # App and all its child endpoints
sc-xano logs show task <id>                   # Single task
sc-xano logs show trigger <id>               # Single trigger

# Update retention
sc-xano logs set endpoint <id> --limit -1     # Unlimited (capture full stacks for debugging)
sc-xano logs set endpoint <id> --limit 100    # Default (top 100 stack steps)
sc-xano logs set endpoint <id> --limit 0      # Disable history retention
sc-xano logs set task <id> --limit -1         # Works for tasks too
sc-xano logs set trigger <id> --limit -1      # And triggers

# Watch for new executions in real-time
sc-xano logs watch endpoint <id>              # Poll and display new executions as they arrive
```

### `inventory` — Workspace Overview (read-only)

List and count all objects in your workspace.

```bash
sc-xano inventory workspace           # Object counts summary
sc-xano inventory functions            # List all functions with tags
sc-xano inventory tables               # List all database tables
sc-xano inventory tasks                # List all background tasks
sc-xano inventory triggers             # List all triggers
sc-xano inventory addons               # List all addons
sc-xano inventory middleware           # List all middleware
sc-xano inventory mcp-servers          # List all MCP/toolset servers
```

### `xanoscript` — XanoScript Generation (read-only)

Generate XanoScript source code from live Xano objects. Supports all object types.

```bash
# Generate XanoScript for a single object
sc-xano xanoscript generate function <id>
sc-xano xanoscript generate table <id>
sc-xano xanoscript generate api <id>
sc-xano xanoscript generate task <id>
sc-xano xanoscript generate trigger <id>
sc-xano xanoscript generate mcp_server <id>
sc-xano xanoscript generate addon <id>
sc-xano xanoscript generate middleware <id>

# Bulk export all objects of a type to .xs files
sc-xano xanoscript export-all --type function
sc-xano xanoscript export-all --type table
sc-xano xanoscript export-all --type api
sc-xano xanoscript export-all --type task
sc-xano xanoscript export-all --type trigger
sc-xano xanoscript export-all --type mcp_server
sc-xano xanoscript export-all --type addon
sc-xano xanoscript export-all --type middleware
sc-xano xanoscript export-all --type function --output-dir ./backup   # Custom output directory
```

### `health` — Instance Health & Restarts (instances/database read-only, clear-history/restart-tasks WRITE)

Instance-level operations for monitoring and recovery. **`clear-history` and `restart-tasks` modify your Xano instance.**

```bash
sc-xano health instances                              # List all instances with status
sc-xano health database --instance-id <id>            # Show history database sizes
sc-xano health clear-history --instance-id <id>       # Clear history databases
sc-xano health clear-history --instance-id <id> --tables request_history,task_history  # Clear specific tables
sc-xano health restart-tasks --instance-id <id>       # Restart the task service deployment
```

### `flush` — Cache Management

The CLI caches workspace data in-memory for 60 seconds. Use `flush` when you know data has changed externally.

```bash
sc-xano flush
```

## Common Flags

These flags work on most commands but are usually auto-resolved:

| Flag | Environment Variable | Description |
|------|---------------------|-------------|
| `--api-key <key>` | `STATECHANGE_API_KEY` | StateChange API key |
| `--instance <host>` | `XANO_INSTANCE` | Xano instance hostname |
| `--workspace <id>` | `XANO_WORKSPACE` | Workspace ID |
| `--token <token>` | `XANO_TOKEN` | Xano API token |
| `--branch <id>` | — | Branch ID (default: 0) |
| `--format <fmt>` | — | Output format: `table` (default), `json`, or `yaml` |

Use `--format yaml` when feeding output to an AI/LLM — it is the most token-efficient structured format.

## License

MIT
