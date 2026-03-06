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

# 3. Run commands (instance, workspace, and token auto-resolve)
sc-xano inventory workspace
sc-xano xray function --id 246
sc-xano audit workspace
```

Once authenticated, the CLI auto-resolves your Xano instance, workspace, and token from the StateChange backend. No extra flags needed if you have a single instance.

## Authentication

The CLI uses a StateChange API key to fetch Xano credentials automatically:

```bash
# Interactive setup
sc-xano auth init

# Or provide key directly
sc-xano auth init --api-key <key>

# Check auth status
sc-xano auth whoami

# Override defaults
sc-xano auth set-instance <hostname> --workspace <id>
```

### Fallback Options

You can also provide credentials directly via flags or environment variables:

| Flag | Environment Variable | Description |
|------|---------------------|-------------|
| `--api-key` | `STATECHANGE_API_KEY` | StateChange API key |
| `--instance` | `XANO_INSTANCE` | Xano instance hostname |
| `--workspace` | `XANO_WORKSPACE` | Workspace ID |
| `--token` | `XANO_TOKEN` | Xano API token |
| `--branch` | `XANO_BRANCH` | Branch ID (default: 0) |
| `--format` | — | Output format: `table`, `json`, or `yaml` |

All commands support `--format table` (default, human-readable), `--format json`, and `--format yaml`. The yaml format is recommended for AI/LLM consumption.

## Commands

### `inventory` -- Workspace Overview

Get a quick summary of everything in your workspace.

```bash
# Full workspace object counts
sc-xano inventory workspace

# List specific object types
sc-xano inventory functions
sc-xano inventory tables
sc-xano inventory tasks
sc-xano inventory triggers
sc-xano inventory addons
sc-xano inventory middleware
sc-xano inventory mcp-servers

# Machine-readable output
sc-xano inventory workspace --format yaml
sc-xano inventory functions --format json
```

### `xray` -- Function Analysis

Analyze function internals: step hierarchy, performance warnings, dependencies.

```bash
# Analyze a single function
sc-xano xray function --id <function-id>

# Scan entire workspace for X-Ray issues
sc-xano xray scan-workspace
sc-xano xray scan-workspace --include-warnings
```

### `performance` -- Performance Analysis

Find slow endpoints and nested performance issues. Output includes name, description, type, and ID for each element.

```bash
# Top slowest endpoints (last 24 hours)
sc-xano performance top-endpoints
sc-xano performance top-endpoints --lookback 48 --limit 10

# Scan functions for nested slow steps
sc-xano performance scan-functions
sc-xano performance scan-functions --min-nesting 3

# Machine-readable output (yaml recommended for AI/LLM consumption)
sc-xano performance top-endpoints --format yaml
sc-xano performance scan-functions --format json
```

Supported formats: `table` (default, human-readable), `json`, `yaml` (recommended for AI/LLM consumption)

### `audit` -- Workspace Auditing

Audit APIs, databases, and other workspace objects for issues.

```bash
# Audit API configurations
sc-xano audit workspace

# Find unsecured Swagger endpoints
sc-xano audit swagger

# Audit database tables (schemas, indexes)
sc-xano audit database

# Audit other object types
sc-xano audit middleware
sc-xano audit addons
sc-xano audit tasks
sc-xano audit triggers
sc-xano audit mcp-servers
```

### `secure` -- Security Management

Manage Swagger security for API apps.

```bash
# Disable Swagger entirely
sc-xano secure swagger --app-id <id> --disable

# Require token for Swagger access
sc-xano secure swagger --app-id <id> --require-token
```

### `history` -- Execution History

Browse request, task, trigger, and MCP server execution history.

```bash
# List recent API requests
sc-xano history requests
sc-xano history requests --page 2

# Detailed request info (stack trace, timing, I/O)
sc-xano history request <request-id>

# Task execution history
sc-xano history tasks <task-id>
sc-xano history task-run <task-id> <run-id>

# Trigger and MCP server history
sc-xano history triggers <trigger-id>
sc-xano history mcp-servers <tool-id>
```

### `xanoscript` -- XanoScript Generation & Conversion

Generate XanoScript from live Xano objects and convert it back.

```bash
# Generate XanoScript for a single object
sc-xano xanoscript generate function <id>
sc-xano xanoscript generate table <id>
sc-xano xanoscript generate api <id>
sc-xano xanoscript generate task <id>

# Bulk export all objects of a type to .xs files
sc-xano xanoscript export-all --type function
sc-xano xanoscript export-all --type table --output-dir ./backup

# Convert .xs file back to Xano JSON
sc-xano xanoscript convert myfunction.xs
cat myfunction.xs | sc-xano xanoscript convert
```

Supported types: `function`, `table`, `api`, `task`, `trigger`, `mcp_server`, `addon`, `middleware`

### `health` -- Instance Health (Master API)

Manage instance-level health and databases. Requires a Xano master token (from app.xano.com).

```bash
# List all instances
sc-xano health instances

# Show history database sizes
sc-xano health database --instance-id <id>

# Clear history databases
sc-xano health clear-history --instance-id <id>
sc-xano health clear-history --instance-id <id> --tables request_history,task_history

# Restart task service
sc-xano health restart-tasks --instance-id <id>
```

### `flush` -- Cache Management

The CLI caches sink data for ~60 seconds to avoid redundant API calls. Use `flush` when you know data has changed externally.

```bash
sc-xano flush
```

## How It Works

This CLI uses Xano's private `api:mvp-admin` endpoints (the same APIs that power the Xano dashboard) to provide operational capabilities beyond the public Meta API. It complements the [Xano Developer MCP](https://www.npmjs.com/package/@xano/developer-mcp) which provides offline documentation and XanoScript validation.

| Capability | This CLI | Xano MCP |
|-----------|----------|----------|
| Live workspace data | Yes | No |
| Performance analysis | Yes | No |
| Execution history | Yes | No |
| XanoScript generation | Yes | No |
| XanoScript validation | No | Yes |
| XanoScript docs | No | Yes |
| Meta API docs | No | Yes |

## Sink Caching

All workspace sink endpoints (functions, tables, APIs, tasks, etc.) are cached in-memory with a 60-second TTL. This means:

- Multiple commands in quick succession reuse cached data
- Write operations (like `secure swagger`) automatically flush the cache
- Use `sc-xano flush` to manually invalidate when external changes occur
