/**
 * StateChange Backend Client - Fetch Xano token from StateChange backend
 */

import { getStateChangeApiKey, getAuthToken, loadAuthFromFile, saveAuthToFile } from "./auth.js";
import { resolve as dnsResolve } from "dns/promises";

const STATECHANGE_BACKEND_URL = "https://api.statechange.ai/api:jKMCYXQa/";

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

export async function resolveXanoToken(options: ResolveTokenOptions): Promise<string> {
  const { instance, token } = options;
  // Direct token takes precedence
  if (token) return token;
  // Environment variable token
  const envToken = process.env.XANO_TOKEN;
  if (envToken) return envToken;
  // Try StateChange backend if authenticated — find matching token from list
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  if (apiKey) {
    try {
      const tokens = await getTokenList(apiKey);
      // Find token matching the instance, handling both camelCase and snake_case
      const match = tokens.find((t) => {
        const id = t.instanceId || t.instance_id;
        return id === instance;
      });
      if (match) {
        const rawToken = match.rawXanoToken || match.raw_xano_token;
        if (rawToken) return rawToken;
      }
      // Fallback: if only one token, use it regardless of instance match
      if (tokens.length === 1) {
        const rawToken = tokens[0].rawXanoToken || tokens[0].raw_xano_token;
        if (rawToken) return rawToken;
      }
    } catch (e) {
      // Silently fail and fall through
    }
  }
  return "";
}
