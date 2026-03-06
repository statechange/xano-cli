# Performance Trace & Deep-Dive Initiative

## Context

The Xano CLI (`@statechange/xano-cli`) already provides `performance top-endpoints` (aggregate endpoint timing) and `performance scan-functions` (static X-Ray analysis for nested slow steps). But the real power is in the **runtime stack traces** — every request/task/trigger execution includes a recursive tree of steps with per-step timing, step types, and function references.

An AI agent can do what the browser UI can't: analyze many executions in aggregate, cross-reference function usage across callers, and recommend specific fixes with XanoScript context.

## What's in a Stack Trace

Each execution's `stack` is a recursive tree:

```
stack[]:
  - name: "mvp:function"          # step type
    _xsid: "abc123"               # links to X-Ray step definition
    title: "validate_token"       # human-readable name
    timing: 0.45                  # seconds spent in this step
    stack_id: "def456"            # parent context
    cnt: 1                        # execution count (for loops)
    stack[]:                      # nested child steps
      - name: "mvp:dbo_view"
        timing: 0.38
        stack: []
```

### Step Types (from xano-xray library)

| Type | Category | Performance Impact |
|------|----------|-------------------|
| `mvp:dbo_view` | DB query (list) | Slow — returns multiple rows |
| `mvp:dbo_getby` | DB query (single) | Moderate |
| `mvp:dbo_add/editby/patch` | DB write | Moderate |
| `mvp:dbo_direct_query` | Raw SQL | Variable |
| `mvp:function` | Custom function call | Variable — expands to nested stack |
| `mvp:api_request` | External API call | Slow — network bound |
| `mvp:lambda` | Lambda/code block | Slow — interpreted |
| `mvp:foreach/for/while` | Loop | Multiplier — children execute N times |
| `mvp:conditional/switch` | Branching | Neutral |
| `mvp:try_catch` | Error handling | Neutral |
| `mvp:set_var/update_var` | Variable ops | Fast |
| `mvp:precondition` | Validation | Fast |
| `mvp:group` | Step group | Container |
| `mvp:db_transaction` | DB transaction | Container |

### Key Fields for Analysis

- `raw.context.function.id` — when step is `mvp:function`, references which custom function was called
- `position2` — dot-separated position accounting for conditionals/loops (e.g., "1.2.if.1.3")
- `timing` — direct time for this step
- Rollup time = step timing + sum of all nested child timings
- `cnt` — iteration count for loop steps

### Performance Markers in Descriptions

- `#ignore-performance` — author has opted out of performance warnings for this step
- Tasks have `ignorePerformance = true` by default

## New CLI Commands

### `performance trace`

**Purpose:** Fetch N recent executions for an endpoint/task/trigger, walk all stack trees, and produce an aggregate step-by-step breakdown.

```bash
# Trace an API endpoint by query ID
sc-xano performance trace endpoint <query-id> [--samples 20]

# Trace a task
sc-xano performance trace task <task-id> [--samples 20]

# Trace a trigger
sc-xano performance trace trigger <trigger-id> [--samples 20]

# Output as yaml for AI consumption
sc-xano performance trace endpoint 123 --format yaml
```

**What it produces:**

```yaml
endpoint:
  id: 123
  name: "GET /api:foo/users"
  description: "List users with filters"
samples: 20
avg_duration_seconds: 2.34
p95_duration_seconds: 4.12

# Aggregated step breakdown across all samples
step_breakdown:
  - step_type: mvp:foreach
    position: "3"
    avg_timing_seconds: 1.89
    pct_of_total: 80.8
    avg_iterations: 47
    children:
      - step_type: mvp:function
        function_id: 246
        function_name: "validate_token"
        avg_timing_seconds: 0.038
        total_across_iterations: 1.79
        pct_of_parent: 94.7
        children:
          - step_type: mvp:dbo_view
            avg_timing_seconds: 0.035
            pct_of_parent: 92.1
            warning: "DB query inside nested loop (depth 2)"

# Functions called (cross-referenced with inventory)
functions_called:
  - id: 246
    name: "validate_token"
    call_count_per_request: 47
    avg_time_per_call: 0.038
    total_time_pct: 76.5
    callers:
      - "GET /api:foo/users (query 123)"
      - "POST /api:foo/orders (query 456)"

# Identified issues
issues:
  - severity: high
    description: "DB query mvp:dbo_view at position 3.1.2 runs inside foreach loop averaging 47 iterations"
    suggestion: "Move query outside the loop or use a batch query"
    function_id: 246
    function_name: "validate_token"
```

**Implementation approach:**
1. Fetch recent history for the endpoint/task/trigger (reuse existing history APIs)
2. For each execution, fetch full request detail (which includes `stack`)
3. Recursively walk all stack trees, accumulating per-step timing stats
4. Cross-reference `mvp:function` steps with the functions sink to resolve names
5. Use `nestingLevel()` from xano-xray to identify loop-nested slow steps
6. Compute percentiles (p50, p95, p99) across samples

### `performance deep-dive`

**Purpose:** Fully expand a single request's stack tree with timing rollups.

```bash
sc-xano performance deep-dive <request-id> --format yaml
```

**What it produces:**

```yaml
request:
  id: 8293342
  verb: GET
  uri: "https://instance/api:foo/users"
  status: 200
  duration_seconds: 2.34
  created_at: "2026-03-05 12:57:11+0000"

stack:
  - position: "1"
    name: mvp:set_var
    title: "Initialize vars"
    direct_seconds: 0.001
    rollup_seconds: 0.001
    pct_of_total: 0.04

  - position: "2"
    name: mvp:dbo_view
    title: "Get all users"
    direct_seconds: 0.12
    rollup_seconds: 0.12
    pct_of_total: 5.1

  - position: "3"
    name: mvp:foreach
    title: "Process each user"
    iterations: 47
    direct_seconds: 0.01
    rollup_seconds: 1.89
    pct_of_total: 80.8
    children:
      - position: "3.1"
        name: mvp:function
        function_id: 246
        function_name: "validate_token"
        direct_seconds: 0.003
        rollup_seconds: 0.038
        pct_of_parent: 94.7
        children:
          - position: "3.1.1"
            name: mvp:dbo_view
            direct_seconds: 0.035
            rollup_seconds: 0.035
            warning: "Slow step inside loop (nesting depth: 2)"

  - position: "4"
    name: mvp:set_var
    title: "Build response"
    direct_seconds: 0.002
    rollup_seconds: 0.002
    pct_of_total: 0.09
```

**Implementation approach:**
1. Fetch request detail via existing `getRequest(id)` API
2. Port the `perfByXsid()` rollup logic from the extension (`src/content/performance.ts`)
3. Recursively walk the stack, computing direct vs rollup timing
4. Resolve function IDs to names via the cached functions sink
5. Apply xano-xray warnings for nested slow steps

## AI Analysis Skill

A skill file (`skills/performance-analysis.md`) that teaches AI agents to chain these tools:

### Workflow: "Why is my workspace slow?"

```
1. sc-xano performance top-endpoints --format yaml --lookback 24
   → Identifies which endpoints consume the most total time

2. sc-xano performance trace endpoint <worst-id> --format yaml --samples 20
   → Shows aggregate step breakdown, identifies hot functions and nested issues

3. sc-xano performance deep-dive <worst-request-id> --format yaml
   → Full stack expansion of the slowest individual request

4. sc-xano xray function --id <hot-function-id> --format yaml
   → X-Ray analysis of the problematic function (static step warnings)

5. sc-xano xanoscript generate function <hot-function-id>
   → Generate XanoScript source to understand and recommend fixes
```

### Workflow: "Why do I get errors?"

```
1. sc-xano history requests --format yaml
   → Find requests with error status codes

2. sc-xano performance deep-dive <error-request-id> --format yaml
   → See which step in the stack failed and what the error path looks like

3. sc-xano xray function --id <failing-function-id> --format yaml
   → Check for try/catch coverage, precondition issues
```

### Workflow: "Which functions should I optimize first?"

```
1. sc-xano performance top-endpoints --format yaml --lookback 24
   → Get endpoint ranking by total time

2. For each of the top 5 endpoints:
   sc-xano performance trace endpoint <id> --format yaml
   → Aggregate analysis reveals shared slow functions

3. Rank functions by: (avg_time_per_call × call_count × number_of_callers)
   → This gives "optimization ROI" — fixing one function improves many endpoints
```

## Dependencies

- Existing APIs: `getRequest(id)` returns full `stack` data, `getRequestHistoryForQuery(queryId)` for per-endpoint history
- xano-xray library: `nestingLevel()`, `isSlowStep()`, `getStepWarnings()`, `buildStepListFromXray()`
- Functions sink (cached): for resolving function IDs to names
- The `perfByXsid()` rollup logic needs to be ported from `src/content/performance.ts` to a shared utility

## Implementation Order

1. **Port `perfByXsid` rollup logic** to a reusable utility in the CLI
2. **`performance deep-dive`** — single request stack expansion (simpler, tests the rollup logic)
3. **`performance trace`** — multi-request aggregation (builds on deep-dive)
4. **Skills file** — document the analysis workflows for AI agents
5. **Iterate** — test with real data, refine the output format based on what's most useful for AI reasoning
