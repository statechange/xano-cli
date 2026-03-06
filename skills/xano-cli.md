# Xano CLI Skill (`sc-xano`)

Use this skill when the user wants to interact with their Xano workspace from the command line -- listing objects, analyzing performance, generating XanoScript, browsing execution history, or auditing their workspace.

## Prerequisites

The CLI must be installed and authenticated:

```bash
npm install -g @statechange/xano-cli
sc-xano auth init --api-key <statechange-api-key>
```

Once authenticated, instance/workspace/token auto-resolve. No extra flags needed for single-instance users.

## Command Reference

### Authentication

```bash
sc-xano auth init                    # Interactive API key setup
sc-xano auth init --api-key <key>    # Direct API key setup
sc-xano auth whoami                  # Show auth status and instances
sc-xano auth set-instance <host>     # Save default instance
```

### Inventory (list workspace objects)

```bash
sc-xano inventory workspace      # Object counts summary
sc-xano inventory functions      # List functions with tags
sc-xano inventory tables         # List database tables
sc-xano inventory tasks          # List background tasks
sc-xano inventory triggers       # List triggers
sc-xano inventory addons         # List addons
sc-xano inventory middleware     # List middleware
sc-xano inventory mcp-servers    # List MCP/toolset servers
```

### X-Ray Analysis

```bash
sc-xano xray function --id <id>          # Analyze single function (steps, warnings, dependencies)
sc-xano xray scan-workspace              # Scan all functions for errors
sc-xano xray scan-workspace --include-warnings
```

### Performance

```bash
sc-xano performance top-endpoints                    # Slowest endpoints (last 24h)
sc-xano performance top-endpoints --lookback 48      # Custom lookback in hours
sc-xano performance scan-functions                   # Find nested slow steps
sc-xano performance scan-functions --min-nesting 3   # Custom nesting threshold

# Machine-readable output (use --format yaml for AI/LLM consumption)
sc-xano performance top-endpoints --format yaml
sc-xano performance top-endpoints --format json
sc-xano performance scan-functions --format yaml
```

Output includes name, description, type, and ID for each element. The `--format yaml` output is recommended when feeding results to an AI or LLM for analysis.

### Audit

```bash
sc-xano audit workspace      # Audit API configurations
sc-xano audit swagger        # Find unsecured Swagger
sc-xano audit database       # Audit table schemas and indexes
sc-xano audit middleware     # List middleware
sc-xano audit addons         # List addons
sc-xano audit tasks          # Audit background tasks
sc-xano audit triggers       # Audit triggers
sc-xano audit mcp-servers    # Audit MCP servers
```

### Security

```bash
sc-xano secure swagger --app-id <id> --disable         # Disable Swagger
sc-xano secure swagger --app-id <id> --require-token   # Secure Swagger with token
```

### Execution History

```bash
sc-xano history requests                          # Recent API requests
sc-xano history requests --page 2                 # Paginate
sc-xano history request <request-id>              # Detailed request (stack, timing, I/O)
sc-xano history tasks <task-id>                   # Task execution history
sc-xano history task-run <task-id> <run-id>       # Detailed task run
sc-xano history triggers <trigger-id>             # Trigger history
sc-xano history mcp-servers <tool-id>             # MCP server history
```

### XanoScript

```bash
# Generate XanoScript from live objects
sc-xano xanoscript generate function <id>
sc-xano xanoscript generate table <id>
sc-xano xanoscript generate api <id>
sc-xano xanoscript generate task <id>
sc-xano xanoscript generate trigger <id>
sc-xano xanoscript generate mcp_server <id>
sc-xano xanoscript generate addon <id>
sc-xano xanoscript generate middleware <id>

# Bulk export all objects of a type
sc-xano xanoscript export-all --type function
sc-xano xanoscript export-all --type table --output-dir ./backup

# Convert .xs back to Xano JSON
sc-xano xanoscript convert myfunction.xs
```

### Instance Health (Master API)

Requires Xano master token (from app.xano.com):

```bash
sc-xano health instances                                      # List instances
sc-xano health database --instance-id <id>                    # Database sizes
sc-xano health clear-history --instance-id <id>               # Clear history DBs
sc-xano health restart-tasks --instance-id <id>               # Restart task service
```

### Cache

```bash
sc-xano flush    # Clear cached sink data (forces fresh API calls)
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

**All commands support `--format yaml` and `--format json`.** Use `--format yaml` when feeding output to an AI or LLM for analysis — it is the most token-efficient structured format.

## Typical Workflows

### "What's in my workspace?"
```bash
sc-xano inventory workspace
```

### "Why is my API slow?"
```bash
sc-xano performance top-endpoints --lookback 24
sc-xano history request <slow-request-id>
sc-xano xray function --id <function-id>
```

### "Export everything as XanoScript for version control"
```bash
sc-xano xanoscript export-all --type function --output-dir ./xs-backup
sc-xano xanoscript export-all --type table --output-dir ./xs-backup
sc-xano xanoscript export-all --type api --output-dir ./xs-backup
```

### "Audit my workspace security"
```bash
sc-xano audit swagger
sc-xano audit workspace
sc-xano audit database
```
