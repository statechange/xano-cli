import assert from "node:assert/strict";
import test from "node:test";

import { resolveConnection, selectRegistryCredential, tokenHealthTimestamp, type RegistryToken } from "../src/connection.js";
import { checkTokenHealth } from "../src/registry-client.js";

const now = Date.parse("2026-07-13T12:00:00Z");
const fresh = now - 60_000;
const old = now - 2 * 86_400_000;

function record(overrides: Partial<RegistryToken>): RegistryToken {
  return {
    instanceId: "api.statechange.ai",
    rawXanoToken: "fresh-custom-token",
    workspaceId: 19,
    createdAt: fresh,
    ttl: 86_400,
    ...overrides,
  };
}

test("an explicit custom domain keeps its registry identity", () => {
  const result = selectRegistryCredential({
    requestedIdentity: "api.statechange.ai",
    canonicalHostname: "xw8v-tcfi-85ay.n7.xano.io",
    workspace: 19,
    now,
    tokens: [
      record({}),
      record({
        instanceId: "xw8v-tcfi-85ay.n7.xano.io",
        rawXanoToken: "expired-canonical-token",
        createdAt: old,
      }),
    ],
  });

  assert.equal(result.registryIdentity, "api.statechange.ai");
  assert.equal(result.requestHostname, "api.statechange.ai");
  assert.equal(result.token, "fresh-custom-token");
});

test("canonical identity is a deterministic fallback only when exact identity is absent", () => {
  const result = selectRegistryCredential({
    requestedIdentity: "custom.example.com",
    canonicalHostname: "x1.n7.xano.io",
    workspace: 19,
    now,
    tokens: [record({ instanceId: "x1.n7.xano.io", rawXanoToken: "canonical" })],
  });

  assert.equal(result.registryIdentity, "x1.n7.xano.io");
  assert.equal(result.requestHostname, "custom.example.com");
  assert.equal(result.token, "canonical");
});

test("a conflicting explicit instance and workspace fails safely", () => {
  assert.throws(
    () => selectRegistryCredential({
      requestedIdentity: "api.statechange.ai",
      workspace: 20,
      now,
      tokens: [record({ workspaceId: 19 })],
    }),
    /requested=api\.statechange\.ai.*workspace=20.*registry=api\.statechange\.ai/,
  );
});

test("ambiguous workspace candidates fail before client construction", () => {
  assert.throws(
    () => selectRegistryCredential({
      requestedIdentity: "missing.example.com",
      workspace: 19,
      now,
      tokens: [
        record({ instanceId: "one.xano.io", rawXanoToken: "one" }),
        record({ instanceId: "two.xano.io", rawXanoToken: "two" }),
      ],
    }),
    /Ambiguous.*one\.xano\.io, two\.xano\.io/,
  );
});

test("token health falls back to creation time when refresh time is null", () => {
  assert.equal(tokenHealthTimestamp(record({ createdAt: fresh, updatedAt: null })), fresh);
});

test("a flag token remains authoritative over XANO_TOKEN on direct xano.io usage", async () => {
  const previous = process.env.XANO_TOKEN;
  process.env.XANO_TOKEN = "environment-token";
  try {
    const result = await resolveConnection({
      instance: "direct.n7.xano.io",
      workspace: 19,
      token: "flag-token",
    });
    assert.equal(result.token, "flag-token");
    assert.equal(result.tokenSource, "flag");
    assert.equal(result.requestHostname, "direct.n7.xano.io");
  } finally {
    if (previous == null) delete process.env.XANO_TOKEN;
    else process.env.XANO_TOKEN = previous;
  }
});

test("displayed token health also falls back to creation time", () => {
  const health = checkTokenHealth({ createdAt: Date.now() - 60_000, updatedAt: null, ttl: 86_400 });
  assert.equal(health.status, "fresh");
});

test("displayed token health parses ISO creation timestamps", () => {
  const health = checkTokenHealth({
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: null,
    ttl: 86_400,
  });
  assert.equal(health.status, "fresh");
});
