---
name: sc-xano
description: Interact with Xano workspaces via the StateChange CLI. Use when the user wants to list workspace objects, analyze performance, generate XanoScript, browse execution history, audit security, or manage log retention settings from the command line.
---

# StateChange Xano CLI (`sc-xano`)

Run commands with `npx @statechange/xano-cli <command>` (or `sc-xano` if installed globally).

Once authenticated, instance/workspace/token auto-resolve. No extra flags needed for single-instance users.

## Authentication

```bash
npx @statechange/xano-cli auth init                    # Interactive API key setup
npx @statechange/xano-cli auth init --api-key <key>    # Direct API key setup
npx @statechange/xano-cli auth whoami                  # Show auth status and instances
npx @statechange/xano-cli auth set-instance <host>     # Save default instance
```

## Command Reference

### Inventory (list workspace objects)

```bash
npx @statechange/xano-cli inventory workspace      # Object counts summary
npx @statechange/xano-cli inventory functions      # List functions with tags
npx @statechange/xano-cli inventory tables         # List database tables
npx @statechange/xano-cli inventory tasks          # List background tasks
npx @statechange/xano-cli inventory triggers       # List triggers
npx @statechange/xano-cli inventory addons         # List addons
npx @statechange/xano-cli inventory middleware     # List middleware
npx @statechange/xano-cli inventory mcp-servers    # List MCP/toolset servers
```

### X-Ray Analysis

```bash
npx @statechange/xano-cli xray function --id <id>          # Analyze single function
npx @statechange/xano-cli xray scan-workspace              # Scan all functions for errors
npx @statechange/xano-cli xray scan-workspace --include-warnings
```

### Performance

```bash
npx @statechange/xano-cli performance top-endpoints                    # Slowest endpoints (last 24h)
npx @statechange/xano-cli performance top-endpoints --lookback 48      # Custom lookback
npx @statechange/xano-cli performance scan-functions                   # Find nested slow steps
npx @statechange/xano-cli performance trace endpoint <query-id>        # Aggregate stack analysis
npx @statechange/xano-cli performance deep-dive <request-id>           # Single request stack expansion
```

### Audit

```bash
npx @statechange/xano-cli audit workspace      # Audit API configurations
npx @statechange/xano-cli audit swagger        # Find unsecured Swagger
npx @statechange/xano-cli audit database       # Audit table schemas and indexes
npx @statechange/xano-cli audit middleware
npx @statechange/xano-cli audit addons
npx @statechange/xano-cli audit tasks
npx @statechange/xano-cli audit triggers
npx @statechange/xano-cli audit mcp-servers
```

### Security

```bash
npx @statechange/xano-cli secure swagger --app-id <id> --disable         # Disable Swagger
npx @statechange/xano-cli secure swagger --app-id <id> --require-token   # Secure Swagger with token
```

### Execution History

```bash
npx @statechange/xano-cli history requests                          # Recent API requests
npx @statechange/xano-cli history requests --page 2                 # Paginate
npx @statechange/xano-cli history request <request-id>              # Detailed request info
npx @statechange/xano-cli history tasks <task-id>                   # Task execution history
npx @statechange/xano-cli history task-run <task-id> <run-id>       # Detailed task run
npx @statechange/xano-cli history triggers <trigger-id>             # Trigger history
npx @statechange/xano-cli history mcp-servers <tool-id>             # MCP server history
```

### Log Retention

```bash
npx @statechange/xano-cli logs show                                 # All objects' retention settings
npx @statechange/xano-cli logs show --custom-only                   # Only non-default settings
npx @statechange/xano-cli logs show endpoint <id>                   # Single endpoint with parent app context
npx @statechange/xano-cli logs show app <id>                        # App + all its endpoints
npx @statechange/xano-cli logs set endpoint <id> --limit -1         # Set to unlimited
npx @statechange/xano-cli logs set endpoint <id> --limit 100        # Set to default
npx @statechange/xano-cli logs watch endpoint <id>                  # Poll for new executions
```

### XanoScript

```bash
npx @statechange/xano-cli xanoscript generate function <id>
npx @statechange/xano-cli xanoscript generate table <id>
npx @statechange/xano-cli xanoscript generate api <id>
npx @statechange/xano-cli xanoscript export-all --type function
npx @statechange/xano-cli xanoscript convert myfunction.xs
```

### Instance Health (Master API)

```bash
npx @statechange/xano-cli health instances
npx @statechange/xano-cli health database --instance-id <id>
npx @statechange/xano-cli health clear-history --instance-id <id>
npx @statechange/xano-cli health restart-tasks --instance-id <id>
```

### Cache

```bash
npx @statechange/xano-cli flush    # Clear cached sink data
```

## Common Flags

These flags work on most commands but are usually auto-resolved:

| Flag | Description |
|------|-------------|
| `--instance <host>` | Xano instance hostname |
| `--workspace <id>` | Workspace ID |
| `--branch <id>` | Branch ID (default: 0) |
| `--token <token>` | Xano API token |
| `--api-key <key>` | StateChange API key |
| `--format <fmt>` | Output: `table` (default), `json`, or `yaml` |

Use `--format yaml` when feeding output to an AI/LLM — it is the most token-efficient structured format.

## Typical Workflows

### "What's in my workspace?"
```bash
npx @statechange/xano-cli inventory workspace
```

### "Why is my API slow?"
```bash
npx @statechange/xano-cli performance top-endpoints --lookback 24 --format yaml
npx @statechange/xano-cli performance trace endpoint <worst-id> --format yaml
npx @statechange/xano-cli performance deep-dive <request-id> --format yaml
npx @statechange/xano-cli xray function --id <function-id> --format yaml
```

### "Audit my workspace security"
```bash
npx @statechange/xano-cli audit swagger
npx @statechange/xano-cli audit workspace
npx @statechange/xano-cli audit database
```
