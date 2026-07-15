import { resolve as dnsResolve } from "node:dns/promises";

import { getStateChangeApiKey, loadAuthFromFile } from "./auth.js";
import { listXanoTokens } from "./registry-client.js";

export interface RegistryToken {
  instanceId?: string;
  instance_id?: string;
  rawXanoToken?: string;
  raw_xano_token?: string;
  workspaceId?: number;
  workspace_id?: number;
  branchId?: number;
  branch_id?: number;
  createdAt?: number | string;
  created_at?: number | string;
  updatedAt?: number | string | null;
  updated_at?: number | string | null;
  ttl?: number;
}

export interface RegistrySelectionInput {
  requestedIdentity: string;
  canonicalHostname?: string;
  workspace: number;
  tokens: RegistryToken[];
  now?: number;
}

export class ConnectionSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectionSelectionError";
  }
}

export interface ConnectionSelection {
  requestedIdentity: string;
  registryIdentity: string;
  requestHostname: string;
  canonicalHostname?: string;
  workspace: number;
  branchId: number;
  token: string;
  tokenSource: "flag" | "environment" | "registry";
  refreshToken?: () => Promise<string>;
}

export interface ResolveConnectionOptions {
  instance?: string;
  workspace?: string | number;
  branch?: string | number;
  token?: string;
  apiKey?: string;
}

function identity(token: RegistryToken): string {
  return token.instanceId ?? token.instance_id ?? "";
}

function workspaceId(token: RegistryToken): number | undefined {
  return token.workspaceId ?? token.workspace_id;
}

function rawToken(token: RegistryToken): string {
  return token.rawXanoToken ?? token.raw_xano_token ?? "";
}

function finiteInteger(input: string | number, label: string): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    throw new ConnectionSelectionError(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

export function resolveRequestedWorkspace(input: {
  requestedIdentity: string;
  explicitWorkspace?: string | number;
  savedIdentity?: string;
  savedWorkspace?: number;
}): number {
  if (input.explicitWorkspace != null && input.explicitWorkspace !== "") {
    return finiteInteger(input.explicitWorkspace, "Workspace");
  }
  return input.requestedIdentity === input.savedIdentity ? input.savedWorkspace ?? 0 : 0;
}

function timestamp(input: number | string | null | undefined): number | undefined {
  if (input == null) return undefined;
  if (typeof input === "number") return input;
  const parsed = Date.parse(input);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function tokenHealthTimestamp(token: RegistryToken): number | undefined {
  return timestamp(token.updatedAt ?? token.updated_at) ?? timestamp(token.createdAt ?? token.created_at);
}

export function isTokenFresh(token: RegistryToken, now = Date.now()): boolean {
  if (!token.ttl) return true;
  const healthySince = tokenHealthTimestamp(token);
  return healthySince != null && now - healthySince < token.ttl * 1000;
}

export function selectRegistryCredential(input: RegistrySelectionInput) {
  const now = input.now ?? Date.now();
  const candidates = input.tokens.filter((token) => identity(token) && rawToken(token));
  const exactByIdentity = input.tokens.filter((token) => identity(token) === input.requestedIdentity && rawToken(token));
  if (input.workspace && exactByIdentity.length > 0) {
    const compatible = exactByIdentity.filter((token) => workspaceId(token) == null || workspaceId(token) === input.workspace);
    if (compatible.length === 0) {
      throw new ConnectionSelectionError(
        `Registry credential conflicts with the explicit selection (requested=${input.requestedIdentity}, request=${input.requestedIdentity}, workspace=${input.workspace}, registry=${identity(exactByIdentity[0])}).`,
      );
    }
  }
  const exactFresh = exactByIdentity.filter((token) =>
    (!input.workspace || workspaceId(token) == null || workspaceId(token) === input.workspace) &&
    isTokenFresh(token, now));
  let selected: RegistryToken | undefined;
  if (exactFresh.length === 1) selected = exactFresh[0];
  else if (exactFresh.length > 1) {
    throw new ConnectionSelectionError(`Ambiguous registry credentials for exact identity ${input.requestedIdentity}.`);
  } else if (exactByIdentity.length > 0) {
    throw new ConnectionSelectionError(
      `The exact registry credential is expired (requested=${input.requestedIdentity}, request=${input.requestedIdentity}, workspace=${input.workspace || "unset"}, registry=${input.requestedIdentity}).`,
    );
  }

  if (!selected && input.workspace) {
    const workspaceMatches = candidates.filter((token) => workspaceId(token) === input.workspace && isTokenFresh(token, now));
    if (workspaceMatches.length === 1) selected = workspaceMatches[0];
    else if (workspaceMatches.length > 1) {
      throw new ConnectionSelectionError(
        `Ambiguous registry credentials for workspace ${input.workspace}: ${workspaceMatches.map(identity).sort().join(", ")}. Specify the matching --instance.`,
      );
    }
  }

  if (!selected && input.canonicalHostname) {
    const canonical = candidates.filter((token) =>
      identity(token) === input.canonicalHostname &&
      (!input.workspace || workspaceId(token) == null || workspaceId(token) === input.workspace) &&
      isTokenFresh(token, now));
    if (canonical.length === 1) selected = canonical[0];
    else if (canonical.length > 1) {
      throw new ConnectionSelectionError(`Ambiguous canonical registry credentials for ${input.canonicalHostname}.`);
    }
  }
  if (!selected) {
    throw new ConnectionSelectionError(
      `No unambiguous, fresh registry credential matched (requested=${input.requestedIdentity || "unset"}, request=${input.requestedIdentity || "unset"}, workspace=${input.workspace || "unset"}, registry=unset).`,
    );
  }
  return {
    requestedIdentity: input.requestedIdentity,
    registryIdentity: identity(selected),
    requestHostname: input.requestedIdentity,
    canonicalHostname: input.canonicalHostname,
    workspace: input.workspace || workspaceId(selected) || 0,
    branchId: selected.branchId ?? selected.branch_id ?? 0,
    token: rawToken(selected),
  };
}

export async function resolveCanonicalHostname(hostname: string): Promise<string | undefined> {
  if (!hostname || hostname.endsWith(".xano.io")) return undefined;
  try {
    const records = await dnsResolve(hostname, "CNAME");
    return records.map((entry) => entry.replace(/\.$/, "")).find((entry) => entry.endsWith(".xano.io"));
  } catch {
    return undefined;
  }
}

const cachedTokens = new Map<string, RegistryToken[]>();

async function registryTokens(apiKey: string, fresh = false): Promise<RegistryToken[]> {
  const cached = cachedTokens.get(apiKey);
  if (!fresh && cached) return cached;
  const response = await listXanoTokens(apiKey);
  const tokens = (response.tokens ?? []) as RegistryToken[];
  cachedTokens.set(apiKey, tokens);
  return tokens;
}

export async function resolveConnection(options: ResolveConnectionOptions): Promise<ConnectionSelection> {
  const auth = loadAuthFromFile();
  const apiKey = getStateChangeApiKey({ apiKey: options.apiKey });
  let requestedIdentity = options.instance || process.env.XANO_INSTANCE || auth?.xanoInstance || "";
  const explicitWorkspace = options.workspace ?? process.env.XANO_WORKSPACE;
  let workspace = resolveRequestedWorkspace({
    requestedIdentity,
    explicitWorkspace,
    savedIdentity: auth?.xanoInstance,
    savedWorkspace: auth?.xanoWorkspace,
  });
  const branchId = finiteInteger(options.branch ?? process.env.XANO_BRANCH ?? 0, "Branch");
  const suppliedToken = options.token || process.env.XANO_TOKEN || "";

  let tokens: RegistryToken[] = [];
  if (apiKey && (!requestedIdentity || !suppliedToken || !workspace)) {
    try {
      tokens = await registryTokens(apiKey);
    } catch (error) {
      if (!suppliedToken) throw error;
    }
    if (!requestedIdentity) {
      const candidates = workspace ? tokens.filter((token) => workspaceId(token) === workspace) : tokens;
      if (candidates.length === 1) requestedIdentity = identity(candidates[0]);
    }
  }
  if (!requestedIdentity) {
    throw new ConnectionSelectionError("Xano instance required (--instance or XANO_INSTANCE).");
  }

  const canonicalHostname = await resolveCanonicalHostname(requestedIdentity);
  if (suppliedToken) {
    const metadata = tokens.filter((token) => identity(token) === requestedIdentity);
    if (!workspace && metadata.length === 1) workspace = workspaceId(metadata[0]) ?? 0;
    return {
      requestedIdentity,
      registryIdentity: requestedIdentity,
      requestHostname: requestedIdentity,
      canonicalHostname,
      workspace,
      branchId,
      token: suppliedToken,
      tokenSource: options.token ? "flag" : "environment",
    };
  }
  if (!apiKey) {
    throw new ConnectionSelectionError(
      "Xano token required (--token, XANO_TOKEN, or StateChange backend via 'sc-xano auth init').",
    );
  }
  const selected = selectRegistryCredential({ requestedIdentity, canonicalHostname, workspace, tokens });
  return {
    ...selected,
    branchId: options.branch != null ? branchId : selected.branchId,
    tokenSource: "registry",
    refreshToken: async () => selectRegistryCredential({
      requestedIdentity,
      canonicalHostname,
      workspace: selected.workspace,
      tokens: await registryTokens(apiKey, true),
    }).token,
  };
}
