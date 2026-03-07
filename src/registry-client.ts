/**
 * StateChange Backend Client - Fetch Xano token from StateChange backend
 */

import { getStateChangeApiKey, getAuthToken, loadAuthFromFile, saveAuthToFile } from "./auth.js";
import { XanoClient } from "./xano-client.js";
import { resolve as dnsResolve } from "dns/promises";

const STATECHANGE_BACKEND_URL = "https://api.statechange.ai/api:jKMCYXQa/";

// Token health thresholds
const STALE_THRESHOLD_MS = 60 * 60 * 1000; // warn when < 1h remaining

export interface ResolveTokenOptions {
  instance: string;
  token?: string;
  apiKey?: string;
}

export interface XanoTokenInfo {
  instanceId: string;
  instanceName?: string;
  workspaceId?: number;
  branchId?: number;
  createdAt?: number;
  ttl?: number;
}

export interface XanoTokenListResponse {
  tokens: XanoTokenInfo[];
}

export interface XanoTokenResponse {
  rawXanoToken: string;
  instanceId: string;
  instanceName?: string;
  workspaceId?: number;
  branchId?: number;
  createdAt: number;
  ttl: number;
}

async function fetchWithAuth(
  path: string,
  options: RequestInit = {},
  apiKey: string
): Promise<Response> {
  // Exchange API key for auth token
  const authToken = await getAuthToken(apiKey);
  
  const url = `${STATECHANGE_BACKEND_URL}${path}`;
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
    },
  });
}

export async function listXanoTokens(apiKey: string): Promise<XanoTokenListResponse> {
  const res = await fetchWithAuth("xano-tokens", { method: "GET" }, apiKey);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list tokens: ${res.status} ${res.statusText} - ${errorText}`);
  }
  return (await res.json()) as XanoTokenListResponse;
}

export async function getXanoToken(
  instanceId: string,
  apiKey: string
): Promise<XanoTokenResponse> {
  const res = await fetchWithAuth(
    `xano-tokens/${encodeURIComponent(instanceId)}`,
    { method: "GET" },
    apiKey
  );
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`No token found for instance: ${instanceId}`);
    }
    const errorText = await res.text();
    throw new Error(
      `Failed to get token: ${res.status} ${res.statusText} - ${errorText}`
    );
  }
  return (await res.json()) as XanoTokenResponse;
}

export interface XanoMasterTokenResponse {
  rawXanoToken: string;
}

export async function getXanoMasterToken(apiKey: string): Promise<XanoMasterTokenResponse> {
  const res = await fetchWithAuth("xano-master-token", { method: "GET" }, apiKey);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get master token: ${res.status} ${res.statusText} - ${errorText}`);
  }
  return (await res.json()) as XanoMasterTokenResponse;
}

export async function resolveMasterToken(options: { token?: string; apiKey?: string }): Promise<string> {
  // Direct token takes precedence
  if (options.token) return options.token;
  // Environment variable
  const envToken = process.env.XANO_MASTER_TOKEN;
  if (envToken) return envToken;
  // Try StateChange backend
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  if (apiKey) {
    try {
      const tokenData = await getXanoMasterToken(apiKey);
      return tokenData.rawXanoToken;
    } catch (e) {
      // Silently fail and fall through
    }
  }
  return "";
}

/**
 * Resolve a custom domain to its underlying .xano.io hostname via CNAME.
 * Xano admin APIs (api:mvp-admin) are only served on the raw hostname,
 * not on custom domains.
 */
async function resolveXanoHostname(hostname: string): Promise<string> {
  if (hostname.endsWith(".xano.io")) return hostname;
  try {
    const records = await dnsResolve(hostname, "CNAME");
    if (records.length > 0) {
      // CNAME may have trailing dot, strip it
      const cname = records[0].replace(/\.$/, "");
      if (cname.endsWith(".xano.io")) return cname;
      // Could be chained (e.g. custom -> x.n7.xano.io -> n7.xano.io)
      // The first xano.io CNAME is what we want
    }
  } catch (e) {
    // No CNAME record — hostname might already be correct
  }
  return hostname;
}

// Cache the token list to avoid redundant API calls within the same CLI invocation
let cachedTokenList: any[] | null = null;

async function getTokenList(apiKey: string): Promise<any[]> {
  if (cachedTokenList) return cachedTokenList;
  const response = await listXanoTokens(apiKey);
  cachedTokenList = response.tokens || [];
  return cachedTokenList;
}

function freshTokenList(apiKey: string): Promise<any[]> {
  cachedTokenList = null;
  return getTokenList(apiKey);
}

// --- Token health ---

export type TokenStatus = "fresh" | "stale" | "expired" | "unknown";

export interface TokenHealth {
  status: TokenStatus;
  updatedAt: number;
  ttl: number;
  expiresAt: number;
  ageHours: number;
  remainingHours: number;
  message: string;
}

export function checkTokenHealth(token: any): TokenHealth {
  const updatedAt = token.updated_at ?? token.updatedAt ?? 0;
  const ttl = (token.ttl ?? 86400) * 1000; // seconds → ms
  const expiresAt = updatedAt + ttl;
  const now = Date.now();
  const ageHours = Math.round(((now - updatedAt) / 3600000) * 10) / 10;
  const remainingMs = expiresAt - now;
  const remainingHours = Math.round((remainingMs / 3600000) * 10) / 10;

  if (updatedAt === 0) {
    return { status: "unknown", updatedAt, ttl: token.ttl ?? 86400, expiresAt, ageHours, remainingHours, message: "Token age unknown" };
  }
  if (remainingMs > STALE_THRESHOLD_MS) {
    return { status: "fresh", updatedAt, ttl: token.ttl ?? 86400, expiresAt, ageHours, remainingHours, message: "" };
  }
  if (remainingMs > 0) {
    const mins = Math.floor(remainingMs / 60000);
    return { status: "stale", updatedAt, ttl: token.ttl ?? 86400, expiresAt, ageHours, remainingHours, message: `Token expires in ${mins} minutes` };
  }
  const expiredAgo = Math.round((-remainingMs / 3600000) * 10) / 10;
  return { status: "expired", updatedAt, ttl: token.ttl ?? 86400, expiresAt, ageHours, remainingHours, message: `Token expired ${expiredAgo} hours ago` };
}

export async function getTokenHealthForInstance(
  apiKey: string,
  instanceId?: string
): Promise<{ token: any; health: TokenHealth } | null> {
  const tokens = await getTokenList(apiKey);
  let token: any;
  if (instanceId) {
    token = tokens.find((t) => (t.instanceId || t.instance_id) === instanceId);
  }
  if (!token && tokens.length === 1) {
    token = tokens[0];
  }
  if (!token) return null;
  return { token, health: checkTokenHealth(token) };
}

/** Print a refresh prompt and poll until the token is updated. Returns the fresh raw token. */
export async function waitForFreshToken(
  apiKey: string,
  instanceId: string,
  staleUpdatedAt: number,
  { timeoutMs = 300000, intervalMs = 5000 }: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<string> {
  console.error("");
  console.error("  Your Xano session has expired.");
  console.error("  To refresh it, open your Xano workspace in the browser");
  console.error("  with the StateChange extension active:");
  console.error("");
  console.error("    https://app.xano.com");
  console.error("");
  console.error("  Waiting for token refresh... (Ctrl+C to cancel)");
  console.error("");

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tokens = await freshTokenList(apiKey);
    const match = tokens.find(
      (t) => (t.instanceId || t.instance_id) === instanceId
    );
    if (match) {
      const newUpdatedAt = match.updated_at ?? match.updatedAt ?? 0;
      if (newUpdatedAt > staleUpdatedAt) {
        const rawToken = match.rawXanoToken || match.raw_xano_token;
        console.error("  Token refreshed! Continuing...");
        console.error("");
        return rawToken;
      }
    }
  }
  throw new Error(
    "Timed out waiting for token refresh. Please open Xano with the StateChange extension and try again."
  );
}

export async function resolveInstance(options: { instance?: string; apiKey?: string }): Promise<string> {
  let hostname = "";

  // Direct flag takes precedence
  if (options.instance) {
    hostname = options.instance;
  }
  // Environment variable
  if (!hostname && process.env.XANO_INSTANCE) {
    hostname = process.env.XANO_INSTANCE;
  }
  // Saved instance from auth config
  const auth = loadAuthFromFile();
  if (!hostname && auth?.xanoInstance) {
    hostname = auth.xanoInstance;
  }
  // Try StateChange backend — auto-select if only one instance
  if (!hostname) {
    const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
    if (apiKey) {
      try {
        const tokens = await getTokenList(apiKey);
        if (tokens.length === 1) {
          const t = tokens[0];
          hostname = t.instanceId || t.instance_id || "";
        }
      } catch (e) {
        // Silently fail
      }
    }
  }

  if (!hostname) return "";

  // Resolve custom domains to the real .xano.io hostname
  // (admin APIs are only served on the raw Xano hostname)
  hostname = await resolveXanoHostname(hostname);

  // Cache the resolved hostname
  if (auth && auth.xanoInstance !== hostname) {
    auth.xanoInstance = hostname;
    saveAuthToFile(auth);
  }

  return hostname;
}

export async function resolveWorkspace(options: { workspace?: string; apiKey?: string }): Promise<number> {
  if (options.workspace) return parseInt(options.workspace);
  if (process.env.XANO_WORKSPACE) return parseInt(process.env.XANO_WORKSPACE);
  // Saved workspace from auth config
  const auth = loadAuthFromFile();
  if (auth?.xanoWorkspace) return auth.xanoWorkspace;
  // Try from token list
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  if (apiKey) {
    try {
      const tokens = await getTokenList(apiKey);
      if (tokens.length === 1) {
        const wsId = tokens[0].workspaceId || tokens[0].workspace_id;
        if (wsId) {
          if (auth) {
            auth.xanoWorkspace = wsId;
            saveAuthToFile(auth);
          }
          return wsId;
        }
      }
    } catch (e) {
      // Silently fail
    }
  }
  return 0;
}

export async function resolveXanoToken(options: ResolveTokenOptions & { skipHealthCheck?: boolean }): Promise<string> {
  const { instance, token } = options;
  // Direct token takes precedence (no health check — user-provided)
  if (token) return token;
  // Environment variable token (no health check — user-managed)
  const envToken = process.env.XANO_TOKEN;
  if (envToken) return envToken;
  // Try StateChange backend if authenticated — find matching token from list
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  if (apiKey) {
    try {
      const tokens = await getTokenList(apiKey);
      // Find token matching the instance, handling both camelCase and snake_case
      let match = tokens.find((t) => {
        const id = t.instanceId || t.instance_id;
        return id === instance;
      });
      // Fallback: if only one token, use it regardless of instance match
      if (!match && tokens.length === 1) {
        match = tokens[0];
      }
      if (match) {
        const rawToken = match.rawXanoToken || match.raw_xano_token;
        if (!rawToken) return "";

        // Health check: warn if token is stale/expired (but still try — Xano may accept it)
        if (!options.skipHealthCheck) {
          const health = checkTokenHealth(match);
          if (health.status === "expired") {
            console.error(`⚠️  Xano token looks expired (${health.message}). Will try anyway...`);
          } else if (health.status === "stale") {
            console.error(`⚠️  ${health.message}. Consider opening Xano to refresh your session.`);
          }
        }
        return rawToken;
      }
    } catch (e) {
      // Silently fail and fall through
    }
  }
  return "";
}

/**
 * Resolve instance/workspace/token and create a XanoClient with auto-refresh on 401.
 * Replaces the per-command makeClient() boilerplate.
 */
export async function makeClient(options: any): Promise<{
  client: XanoClient;
  instance: string;
  workspace: number;
  branchId: number;
}> {
  const instance = await resolveInstance({ instance: options.instance, apiKey: options.apiKey });
  if (!instance) {
    console.error("Error: Xano instance required (--instance or XANO_INSTANCE env var)");
    process.exit(1);
  }
  const token = await resolveXanoToken({ instance, token: options.token, apiKey: options.apiKey });
  if (!token) {
    console.error("Error: Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init')");
    process.exit(1);
  }
  const workspace = await resolveWorkspace({ workspace: options.workspace, apiKey: options.apiKey });
  if (!workspace) {
    console.error("Error: Workspace ID required (--workspace or XANO_WORKSPACE env var)");
    process.exit(1);
  }
  const branchId = parseInt(options.branch || "0");

  // Wire up 401 refresh: on Xano token rejection, poll SC backend for a fresh token
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  const onTokenExpired = apiKey
    ? async () => {
        // First, check if backend has a newer token already (e.g. user refreshed recently)
        const tokens = await freshTokenList(apiKey);
        const match = tokens.find(
          (t) => (t.instanceId || t.instance_id) === instance
        ) || (tokens.length === 1 ? tokens[0] : null);
        if (!match) throw new Error("No token found");

        const matchInstance = match.instanceId || match.instance_id || instance;
        const currentUpdatedAt = match.updated_at ?? match.updatedAt ?? 0;

        // If the backend token is recent (updated in last 60s), just return it
        if (Date.now() - currentUpdatedAt < 60000) {
          return match.rawXanoToken || match.raw_xano_token || "";
        }

        // Otherwise, prompt user and poll for refresh
        return await waitForFreshToken(apiKey, matchInstance, currentUpdatedAt);
      }
    : undefined;

  const client = new XanoClient({ instance, token, onTokenExpired });
  return { client, instance, workspace, branchId };
}
