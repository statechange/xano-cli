# Decisions

This log records settled, load-bearing decisions for the standalone CLI. Newest entries come first.

## 2026-07-15 — Keep connection identity separate from network routing

The requested instance, registry credential identity, HTTP request hostname, and optional canonical CNAME are distinct concepts. An explicit custom domain remains the preferred registry and request identity. A canonical `.xano.io` hostname is fallback routing metadata; discovering it must not replace a fresh exact/workspace credential with another record or overwrite the saved user identity. This contract is being completed under issue #2.

Why: a live workspace-19 reproduction showed that forced CNAME normalization selected an expired canonical-host token even though the explicitly requested custom domain had a fresh working token.

## 2026-07-15 — Complete exports remain explicit

A complete workspace export is selected with `xanoscript export-all --type all`. Omitting `--type` remains an error. The selector expands to the concrete type registry and reuses the per-type export path instead of introducing a second export implementation. This is tracked in issue #1.

Why: a full export can be large and should never happen accidentally; one shared concrete-type registry prevents validation, help text, and iteration from drifting.

## 2026-07-15 — Export filenames never overwrite earlier successes

The first available sanitized basename keeps the existing filename. Collisions prefer a stable object-ID suffix and fall back to a deterministic numeric suffix. Collision detection happens after sanitization and summaries count files retained on disk. This is tracked in issue #3.

Why: workspace 19 produced 342 API objects but retained only 249 files because duplicate and sanitize-colliding names silently overwrote 93 prior exports.

## 2026-07-15 — This repository is the authoritative CLI package

`statechange/xano-cli` is the source of the published `@statechange/xano-cli` package. The embedded CLI formerly carried by the browser extension is reference evidence, not an implementation target. Useful behavior and tests should be adapted rather than whole files blindly copied.

Why: the standalone package has additional commands and authentication behavior, and has intentionally diverged from the extension copy.
