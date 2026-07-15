import assert from "node:assert/strict";
import test from "node:test";

import { XanoClient } from "../src/xano-client.js";

test("custom hostname is tried first and canonical routing fallback reuses the credential", async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("Authorization") });
    if (calls.length === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const client = new XanoClient({
    instance: "custom.example.com",
    canonicalHostname: "x1.n7.xano.io",
    token: "same-token",
    fetcher,
  });

  assert.deepEqual(await client.fetchJson("api:mvp-admin/workspace"), { ok: true });
  assert.match(calls[0].url, /^https:\/\/custom\.example\.com\//);
  assert.match(calls[1].url, /^https:\/\/x1\.n7\.xano\.io\//);
  assert.equal(calls[0].authorization, calls[1].authorization);
});

test("a failed mutating request is not replayed to the canonical hostname", async () => {
  let calls = 0;
  const client = new XanoClient({
    instance: "custom.example.com",
    canonicalHostname: "x1.n7.xano.io",
    token: "same-token",
    fetcher: async () => {
      calls++;
      throw new TypeError("connection reset");
    },
  });

  await assert.rejects(() => client.fetch("api:mvp-admin/app/1", { method: "POST" }));
  assert.equal(calls, 1);
});

test("XanoScript generation refreshes once after a 401 and retries", async () => {
  const calls: Array<{ authorization: string | null }> = [];
  const client = new XanoClient({
    instance: "api.statechange.ai",
    token: "old-token",
    refreshToken: async () => "new-token",
    fetcher: async (_input, init) => {
      calls.push({ authorization: new Headers(init?.headers).get("Authorization") });
      if (calls.length === 1) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify({ output: "query test {}" }), { status: 200 });
    },
  });

  const result = await client.generateXanoScript(19, { id: 1 }, "schema:query");
  assert.equal(result.status, "success");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "Bearer old-token");
  assert.equal(calls[1].authorization, "Bearer new-token");
});

test("a second XanoScript 401 stops with safe connection context", async () => {
  const secret = "client:never-print-this";
  let calls = 0;
  const client = new XanoClient({
    instance: "api.statechange.ai",
    token: secret,
    refreshToken: async () => "still-invalid",
    fetcher: async () => {
      calls++;
      return new Response(JSON.stringify({ token: secret }), { status: 401 });
    },
    connectionContext: {
      requestedIdentity: "api.statechange.ai",
      registryIdentity: "api.statechange.ai",
      workspace: 19,
    },
  });

  const result = await client.generateXanoScript(19, { id: 1 }, "schema:query");
  assert.equal(calls, 2);
  assert.equal(result.status, "error");
  assert.match(result.payload.message, /requested=api\.statechange\.ai/);
  assert.match(result.payload.message, /request=api\.statechange\.ai/);
  assert.match(result.payload.message, /workspace=19/);
  assert.match(result.payload.message, /registry=api\.statechange\.ai/);
  assert.ok(!result.payload.message.includes(secret));
});

test("an unrecoverable read 401 reports safe connection context without the token", async () => {
  const secret = "client:never-print-this";
  const client = new XanoClient({
    instance: "api.statechange.ai",
    token: secret,
    fetcher: async () => new Response(JSON.stringify({ token: secret }), { status: 401 }),
    connectionContext: {
      requestedIdentity: "api.statechange.ai",
      registryIdentity: "api.statechange.ai",
      workspace: 19,
    },
  });

  await assert.rejects(
    () => client.fetchJson("api:mvp-admin/workspace", undefined, 0, 0),
    (error: Error) => {
      assert.match(error.message, /requested=api\.statechange\.ai/);
      assert.match(error.message, /request=api\.statechange\.ai/);
      assert.match(error.message, /workspace=19/);
      assert.match(error.message, /registry=api\.statechange\.ai/);
      assert.ok(!error.message.includes(secret));
      return true;
    },
  );
});
