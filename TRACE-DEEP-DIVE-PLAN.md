# Performance Trace and Deep-Dive: Status and Design History

This document records what shipped from the original performance-tracing plan
and where the implementation intentionally differs. It is not an implementation
checklist or field reference. Current behavior lives in [README](README.md) and
the [bundled performance skill](skills/performance-analysis/SKILL.md);
implementation lives in `src/commands/performance.ts`,
`src/performance/stack-rollup.ts`, and `src/performance/trace-analysis.ts`.

## Status snapshot

The command core shipped in commit
[`1a63a35`](https://github.com/statechange/xano-cli/commit/1a63a359798621ff60c089cf9e5a692122fea2f7)
on March 7, 2026. Correctness hardening shipped through
[#9](https://github.com/statechange/xano-cli/issues/9), and trace enrichment
shipped through [#10](https://github.com/statechange/xano-cli/issues/10), both
closed on July 16, 2026.

| Original deliverable | Status | Current boundary |
| --- | --- | --- |
| Reusable runtime stack walker | **Shipped, intentionally changed** | `walkStack()` produces a recursive tree instead of reproducing the extension's flat `_xsid`-keyed `perfByXsid()` output. |
| `performance deep-dive <request-id>` | **Shipped** | Expands one request with tested inclusive/direct timing, runtime-or-fallback coordinates, count semantics, warnings, and truncation context. |
| `performance trace <type> <id>` | **Shipped** | Supports endpoint, task, and trigger history with target metadata, percentiles, ancestry, additive hotspots, function summaries, truncation context, and actionable issues. |
| Function-name enrichment | **Shipped, intentionally conservative** | Runtime IDs win. Static `_xsid` identity resolves only when exact, unambiguous, and version-aligned; otherwise the call remains explicitly unresolved. |
| Nested slow-step warnings | **Shipped, intentionally changed** | Runtime warnings use tested loop ancestry and available suppression metadata rather than promising every static `xano-xray` warning. |
| AI performance-analysis skill | **Shipped** | `skills/performance-analysis/SKILL.md` documents the current workflow and its reliable-identity boundary. |
| Cross-target function ROI | **Intentionally changed** | Trace reports ROI metrics and caller scope for one target. It does not fabricate workspace-wide callers; a future workspace scan would require a new issue. |
| Discriminating rollup/count/truncation/suppression tests | **Shipped** | Added by [#9](https://github.com/statechange/xano-cli/issues/9) and extended by [#10](https://github.com/statechange/xano-cli/issues/10). |

## Current commands

### Single-request deep dive

```bash
sc-xano performance deep-dive <request-id> --format yaml
```

The command fetches a request detail, recursively walks `stack`, and emits:

- request metadata and `stack_truncated` from `stack_maxed`;
- a recursive stack tree with authoritative-or-fallback positions, direct and
  rollup seconds, percentages, retained-node and runtime counts, loop
  iterations, and warnings;
- function summaries for reliably resolved calls.

### Multi-request trace

```bash
sc-xano performance trace endpoint <query-id> --samples 20 --format yaml
sc-xano performance trace task <task-id> --samples 20 --format yaml
sc-xano performance trace trigger <trigger-id> --samples 20 --format yaml
```

The command fetches recent history and the corresponding request/task details,
then emits target metadata, sample count, average and p50/p95/p99 duration,
structural ancestry, flat additive hotspots, resolved or unresolved function
summaries, and high-confidence actionable issues.

## Verified payload boundary

The original plan treated several fields as universally available and described
`timing` as direct time. Neither assumption is an honest current contract.

- **`timing` is inclusive.** The walker derives direct time by subtracting child
  rollups and clamps negative clock/rounding residue. Nested and zero-duration
  fixtures cover this contract.
- **`position2` and `position` are optional runtime coordinates.** The walker
  prefers `position2`, then `position`, and uses deterministic tree positions
  when live payloads omit both.
- **`raw.context.function.id` is optional, but authoritative when valid.** A read-only
  workspace-19 request probe recorded in [#10](https://github.com/statechange/xano-cli/issues/10)
  contained an `mvp:function` node titled `Circle Authenticated Request` but no
  `raw` field. Trace now attempts an exact, unambiguous, version-aligned static
  `_xsid` match and emits explicit unresolved identity when no safe ID exists.
- **`cnt` and retained child nodes describe different quantities.** A live
  workspace-19 request recorded in [#9](https://github.com/statechange/xano-cli/issues/9)
  had `cnt: 270` and `stack_maxed: true`. Output now separates runtime counts,
  loop iterations, retained nodes, and function invocations, and marks counts
  incomplete when samples are truncated.
- **Performance suppression depends on available metadata.**
  `#ignore-performance`, explicit suppression flags, and task-wide opt-out are
  honored when exposed. The CLI does not infer author-side suppression when
  Xano omits the metadata.
- **Task history is a separate payload path.** Trace uses task-history detail
  rather than request detail. Any absence of stack data must be represented as
  a task limitation, not inferred to match endpoint payloads. Target metadata
  and duration percentiles remain useful even when structural sections are empty.

## Historical target contract outcome

The richer contract preserved from the original plan was resolved as follows:

- **Shipped:** ancestry and flat hotspots, target metadata, authoritative or
  fallback coordinates, distinct count semantics, tested direct/inclusive time,
  truncation completeness, conservative function identity, single-target ROI
  metrics, and actionable issues with supported suppression.
- **Intentionally changed:** hotspots use exclusive/direct percentages so they
  remain additive; function callers are scoped to the traced target rather than
  claiming a workspace-wide scan.
- **Accepted external limitation:** task history can lack retained stack data,
  and runtime payloads can lack identity or suppression metadata. Output stays
  explicit rather than inventing those facts.

## Analysis workflow

The currently valid sequence is:

```text
1. performance top-endpoints
2. performance trace endpoint <id>
3. performance deep-dive <request-id>
4. xray function --id <id>       # only when a reliable function ID exists
5. xanoscript generate function <id>
```

Trace supports function optimization within the selected target. Cross-target
caller analysis remains outside this command's scope.

## Design history

The initial implementation order was:

1. port the extension rollup idea into a reusable CLI utility;
2. ship a single-request deep dive;
3. build multi-request trace aggregation;
4. document the agent workflow;
5. refine the contract against real payloads.

Steps 1-4 shipped together in `1a63a35`. Step 1 deliberately became a recursive
tree walker rather than a literal port. Step 5 exposed the payload and semantic
gaps later closed by #9 and #10. New work should be captured in a new issue
rather than treating this historical plan as an executable queue.
