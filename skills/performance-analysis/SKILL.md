---
name: performance-analysis
description: Analyze and optimize Xano workspace performance. Use when the user wants to find slow endpoints, trace execution bottlenecks, deep-dive request stacks, or understand why their Xano API is slow. Also use when the user mentions "performance," "slow endpoint," "bottleneck," "stack trace," or "optimization."
---

# Xano Performance Analysis

**Requires:** A [State Change](https://statechange.ai) subscription, the [State Change browser extension](https://chromewebstore.google.com/detail/statechange-power-tools-f/jgednopabapolfhfbgipkkigkafnlmla) installed in Chrome, and the `sc-xano` CLI to be authenticated (see the `sc-xano` skill).

## Workflow: "Why is my workspace slow?"

Start broad, then drill into specifics.

### Step 1: Identify the hottest endpoints

```bash
npx @statechange/xano-cli performance top-endpoints --lookback 24 --format yaml
```

Returns all endpoints, tasks, triggers, and MCP tools ranked by total duration. Look at:
- **Total duration** — which objects consume the most aggregate server time
- **Avg duration** — which individual calls are slowest
- **Request count** — high-frequency low-duration items may still matter

### Step 2: Trace the worst offender

```bash
npx @statechange/xano-cli performance trace endpoint <query-id> --samples 10 --format yaml
npx @statechange/xano-cli performance trace task <task-id> --samples 10 --format yaml
npx @statechange/xano-cli performance trace trigger <trigger-id> --samples 10 --format yaml
```

**Note:** Task history items don't include stack traces (Xano API limitation). Trace will show duration percentiles but no step breakdown for tasks.

The trace output shows:
- **Duration percentiles** (avg, p50, p95, p99) across samples
- **Step breakdown** aggregated by `_xsid` — which steps consume the most time across all executions
- **Functions called** — which custom functions are invoked and how often
- Steps with high `occurrences` relative to `samples` indicate they run inside loops

### Step 3: Deep-dive a single request

```bash
npx @statechange/xano-cli performance deep-dive <request-id> --format yaml
```

This shows:
- **Recursive stack tree** with direct vs rollup timing at each step
- **pct_of_total** / **pct_of_parent** — percentage breakdowns
- **iterations** — how many times loop bodies executed
- **Warnings** for slow steps inside loops (DB queries, lambdas, external API calls)
- **functions_called** summary with call counts and total time
- **stack_truncated: true** means Xano capped the stack — see "Handling truncated stacks" below

### Step 4: X-Ray the hot function

```bash
npx @statechange/xano-cli xray function --id <function-id> --format yaml
```

Static analysis of the function's step hierarchy — warnings about nested slow steps, dependencies on other functions.

### Step 5: Read the source

```bash
npx @statechange/xano-cli xanoscript generate function <function-id>
```

Generate XanoScript source to understand what the function does and recommend fixes.

## Workflow: "Why do I get errors?"

```bash
# 1. Find requests with error status codes
npx @statechange/xano-cli history requests --format yaml

# 2. Deep-dive the error request to see which step failed
npx @statechange/xano-cli performance deep-dive <error-request-id> --format yaml

# 3. X-Ray the failing function for structural issues
npx @statechange/xano-cli xray function --id <failing-function-id> --format yaml
```

## Workflow: "Which functions should I optimize first?"

```bash
# 1. Get endpoint ranking
npx @statechange/xano-cli performance top-endpoints --lookback 24 --format yaml

# 2. Trace the top 3-5 endpoints
npx @statechange/xano-cli performance trace endpoint <id1> --format yaml
npx @statechange/xano-cli performance trace endpoint <id2> --format yaml
npx @statechange/xano-cli performance trace endpoint <id3> --format yaml

# 3. Look at functions_called across all traces
# Rank by: avg_seconds_per_call x total_calls x number_of_callers
# This gives "optimization ROI" — fixing one function improves many endpoints
```

## Handling truncated stacks

When `stack_truncated: true` appears in a deep-dive, Xano capped the stack at the endpoint's retention limit. Large `direct_seconds` on a function step with truncation means the real bottleneck is hidden.

```bash
# 1. Check current retention settings
npx @statechange/xano-cli logs show endpoint <id>

# 2. Set to unlimited to capture full stacks
npx @statechange/xano-cli logs set endpoint <id> --limit -1

# 3. Watch for new executions
npx @statechange/xano-cli logs watch endpoint <id>

# 4. Deep-dive the new (untruncated) execution
npx @statechange/xano-cli performance deep-dive <new-request-id> --format yaml

# 5. Restore the default limit when done
npx @statechange/xano-cli logs set endpoint <id> --limit 100
```

## Interpreting Results

- **High `direct_seconds` with no children** — the step itself is slow (external API call, lambda, complex query)
- **Low `direct_seconds` but high `rollup_seconds`** — children are slow, drill deeper
- **Same `_xsid` with high `occurrences`** in trace — step runs inside a loop. Multiply `avg_rollup_seconds` by occurrences/samples to get per-request impact
- **DB queries inside loops** (warnings) — classic N+1 problem. Move the query outside the loop or use a batch query
- **Lambda steps with high timing** — interpreted code blocks are slower than native Xano steps

### History retention values

- `limit: 100` (default) — keeps top 100 stack steps, may truncate deep stacks
- `limit: -1` — unlimited, captures full stack (use for debugging)
- `limit: 0` — disabled, no history retained
- `inherit: true` — inherits from the parent API app settings
- `enabled: false` — history recording is off entirely
