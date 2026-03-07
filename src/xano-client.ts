/**
 * Xano API Client - Portable version for CLI use
 * Based on src/workers/xanoapi.ts
 */

export interface XanoClientConfig {
  instance: string;
  token: string;
}

// Sink cache: keyed by "sinkType:workspaceId:branchId", stores { data, timestamp }
interface CacheEntry {
  data: any;
  timestamp: number;
}

const sinkCache = new Map<string, CacheEntry>();
const SINK_TTL_MS = 60_000; // 1 minute

/** Flush all sink caches (or a specific key) */
export function flushSinkCache(key?: string) {
  if (key) {
    sinkCache.delete(key);
  } else {
    sinkCache.clear();
  }
}

export class XanoClient {
  private instance: string;
  private token: string;

  constructor(config: XanoClientConfig) {
    this.instance = config.instance;
    this.token = config.token;
  }

  /** Flush the sink cache (call after writes) */
  flushCache() {
    flushSinkCache();
  }

  private getCached<T>(key: string): T | undefined {
    const entry = sinkCache.get(key);
    if (entry && Date.now() - entry.timestamp < SINK_TTL_MS) {
      return entry.data as T;
    }
    if (entry) sinkCache.delete(key);
    return undefined;
  }

  private setCache(key: string, data: any) {
    sinkCache.set(key, { data, timestamp: Date.now() });
  }

  async fetch(path: string, options?: RequestInit): Promise<Response> {
    const uri = `https://${this.instance}/${path}`;
    const response = await fetch(uri, {
      ...(options || {}),
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    return response;
  }

  async fetchJson<T = Record<string, any>>(
    path: string,
    options?: RequestInit,
    attempts = 6,
    attemptTimeout = 10000
  ): Promise<T> {
    let currentAttempt = 0;
    const opts = options ? { ...options } : {};

    while (true) {
      try {
        const response = await this.fetch(path, opts);
        if (!response.ok) {
          if (currentAttempt >= attempts) {
            throw new Error(
              `Failed to fetch ${path} after ${attempts} attempts: ${response.status} ${response.statusText}`
            );
          } else if (response.status >= 500) {
            await new Promise((resolve) =>
              setTimeout(resolve, attemptTimeout * (currentAttempt + 1))
            );
            currentAttempt++;
            continue;
          } else {
            const errorText = await response.text();
            const apiError = new Error(
              `Xano API error: ${response.status} ${response.statusText} - ${errorText}`
            );
            (apiError as any).isApiError = true;
            throw apiError;
          }
        }
        const json = (await response.json()) as T;
        return json;
      } catch (error: any) {
        // Don't retry on 4xx API errors — only retry on network/timeout failures
        if (error.isApiError || currentAttempt >= attempts) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, attemptTimeout * (currentAttempt + 1))
        );
        currentAttempt++;
      }
    }
  }

  // Workspace methods
  async getWorkspaces() {
    return this.fetchJson(`api:mvp-admin/workspace`);
  }

  // Function methods (cached via sink)
  async getFunctions(workspaceId: number, branchId: number = 0) {
    const cacheKey = `functions:${workspaceId}:${branchId}`;
    const cached = this.getCached<{ functions: any[] }>(cacheKey);
    if (cached) return cached;

    const result = await this.fetchJson<{ functions: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/functions?branch_id=${branchId}`
    );
    this.setCache(cacheKey, result);
    return result;
  }

  /** Get a single function by plucking from the sink list */
  async getFunction(functionId: number, workspaceId?: number, branchId: number = 0): Promise<any> {
    if (workspaceId != null) {
      const { functions } = await this.getFunctions(workspaceId, branchId);
      const func = functions.find((f: any) => f.id === functionId);
      if (func) return func;
    }
    // Fallback to individual endpoint (may 404 on some instances)
    return this.fetchJson(`api:mvp-admin/function/${functionId}`);
  }

  // App/API methods (cached via sink)
  async getAPIAppsAndQueries(workspaceId: number, branchId: number = 0) {
    const cacheKey = `api:${workspaceId}:${branchId}`;
    const cached = this.getCached<{ apps: any[]; queries: any[] }>(cacheKey);
    if (cached) return cached;

    const result = await this.fetchJson<{ apps: any[]; queries: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/api?branch_id=${branchId}`
    );
    this.setCache(cacheKey, result);
    return result;
  }

  async getApp(appId: number, branchId: number) {
    return this.fetchJson(
      `api:mvp-admin/app/${appId}?branch_id=${branchId}`
    );
  }

  async updateApp(app: any) {
    this.flushCache();
    return this.fetchJson(`api:mvp-admin/app/${app.id}`, {
      method: "POST",
      body: JSON.stringify({
        data: app,
        last_updated_at: app.updated_at,
      }),
    });
  }

  // Query (endpoint) methods
  async getQuery(queryId: number) {
    return this.fetchJson(`api:mvp-admin/query/${queryId}`);
  }

  async updateQuery(query: any) {
    this.flushCache();
    return this.fetchJson(`api:mvp-admin/query/${query.id}`, {
      method: "POST",
      body: JSON.stringify({
        data: query,
        last_updated_at: query.updated_at,
      }),
    });
  }

  // Task update
  async updateTask(task: any) {
    this.flushCache();
    return this.fetchJson(`api:mvp-admin/task/${task.id}`, {
      method: "POST",
      body: JSON.stringify({
        data: task,
        last_updated_at: task.updated_at,
      }),
    });
  }

  // Trigger update
  async updateTrigger(trigger: any) {
    this.flushCache();
    return this.fetchJson(`api:mvp-admin/trigger/${trigger.id}`, {
      method: "POST",
      body: JSON.stringify({
        data: trigger,
        last_updated_at: trigger.updated_at,
      }),
    });
  }

  // History methods
  async getRequestHistory(
    workspaceId: number,
    page = 1,
    branchId = -1
  ): Promise<{
    curPage: number;
    items: any[];
    nextPage?: number;
  }> {
    return this.fetchJson(
      `api:mvp-admin/workspace/${workspaceId}/request?page=${page}&branch_id=${branchId}`
    );
  }

  async getRequestHistoryForQuery(
    queryId: number,
    page = 1,
    branchId = -1
  ): Promise<{
    curPage: number;
    items: any[];
    nextPage?: number;
  }> {
    return this.fetchJson(
      `api:mvp-admin/query/${queryId}/request?page=${page}&branch_id=${branchId}`
    );
  }

  async getRequest(requestId: number) {
    return this.fetchJson(`api:mvp-admin/request/${requestId}`);
  }

  // Task methods (cached via sink)
  async getTasks(workspaceId: number, branchId: number = 0): Promise<any[]> {
    const cacheKey = `tasks:${workspaceId}:${branchId}`;
    const cached = this.getCached<any[]>(cacheKey);
    if (cached) return cached;

    const payload = await this.fetchJson<{ tasks: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/tasks?branch_id=${branchId}`
    );
    const tasks = payload.tasks ?? [];
    this.setCache(cacheKey, tasks);
    return tasks;
  }

  async getTaskHistory(taskId: number, page = 1): Promise<{
    curPage: number;
    items: any[];
    nextPage?: number;
  }> {
    return this.fetchJson(
      `api:mvp-admin/task/${taskId}/history?page=${page}`
    );
  }

  // Trigger methods (cached via sink)
  async getTriggers(workspaceId: number, branchId: number = 0): Promise<any[]> {
    const cacheKey = `triggers:${workspaceId}:${branchId}`;
    const cached = this.getCached<any[]>(cacheKey);
    if (cached) return cached;

    const payload = await this.fetchJson<{ triggers: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/trigger?branch_id=${branchId}`
    );
    const triggers = payload.triggers ?? [];
    this.setCache(cacheKey, triggers);
    return triggers;
  }

  async getTriggerHistory(
    triggerId: number,
    branchId: number = 0,
    page = 1
  ): Promise<{
    curPage: number;
    items: any[];
    nextPage?: number;
  }> {
    return this.fetchJson(
      `api:mvp-admin/trigger/${triggerId}/request?branch_id=${branchId}&page=${page}`
    );
  }

  // MCP/Tool methods (cached via sink)
  async getMCPServers(workspaceId: number, branchId: number = 0): Promise<any[]> {
    const cacheKey = `toolsets:${workspaceId}:${branchId}`;
    const cached = this.getCached<any[]>(cacheKey);
    if (cached) return cached;

    const payload = await this.fetchJson<{ toolsets: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/toolset?branch_id=${branchId}`
    );
    const toolsets = payload.toolsets ?? [];
    this.setCache(cacheKey, toolsets);
    return toolsets;
  }

  async getMCPServerHistory(
    toolId: number,
    branchId: number = 0,
    page = 1
  ): Promise<{
    curPage: number;
    items: any[];
    nextPage?: number;
  }> {
    return this.fetchJson(
      `api:mvp-admin/toolset/${toolId}/request?branch_id=${branchId}&page=${page}`
    );
  }

  // Middleware methods (cached via sink)
  async getMiddleware(workspaceId: number, branchId: number = 0): Promise<any[]> {
    const cacheKey = `middleware:${workspaceId}:${branchId}`;
    const cached = this.getCached<any[]>(cacheKey);
    if (cached) return cached;

    const payload = await this.fetchJson<{ middleware: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/middleware?branch_id=${branchId}`
    );
    const middleware = payload.middleware ?? [];
    this.setCache(cacheKey, middleware);
    return middleware;
  }

  // Addon methods (cached via sink)
  async getAddons(workspaceId: number, branchId: number = 0): Promise<any[]> {
    const cacheKey = `addons:${workspaceId}:${branchId}`;
    const cached = this.getCached<any[]>(cacheKey);
    if (cached) return cached;

    const payload = await this.fetchJson<{ addons: any[] }>(
      `api:mvp-admin/workspace/${workspaceId}/sink/addons?branch_id=${branchId}`
    );
    const addons = payload.addons ?? [];
    this.setCache(cacheKey, addons);
    return addons;
  }

  // Workspace sink — tables/dbos (cached)
  async getWorkspaceSink(workspaceId: number): Promise<{ dbos: any[]; workspace?: any; branch?: any }> {
    const cacheKey = `sink:${workspaceId}`;
    const cached = this.getCached<{ dbos: any[]; workspace?: any; branch?: any }>(cacheKey);
    if (cached) return cached;

    const result = await this.fetchJson<{ dbos: any[]; workspace?: any; branch?: any }>(
      `api:mvp-admin/workspace/${workspaceId}/sink`
    );
    this.setCache(cacheKey, result);
    return result;
  }

  /** Get a single table by plucking from the workspace sink */
  async getTable(tableId: number, workspaceId?: number): Promise<any> {
    if (workspaceId != null) {
      const sink = await this.getWorkspaceSink(workspaceId);
      const table = (sink.dbos ?? []).find((t: any) => t.id === tableId);
      if (table) return table;
    }
    // Fallback to individual endpoint
    return this.fetchJson(`api:mvp-admin/dbo/${tableId}`);
  }

  // Task history item detail
  async getTaskHistoryItem(taskId: number, runId: number): Promise<any> {
    return this.fetchJson(`api:mvp-admin/task/${taskId}/history/${runId}`);
  }

  // XanoScript generation with 429 rate-limit retry
  async generateXanoScript(
    workspaceId: number,
    data: any,
    kind: string
  ): Promise<{ status: string; payload: any }> {
    const body = JSON.stringify({ data, kind, path: "", type: "xs" });
    const maxRetries = 5;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.fetch(
        `api:mvp-admin/workspace/${workspaceId}/script`,
        { method: "POST", body }
      );

      if (response.ok) {
        const result = await response.json();
        return { status: "success", payload: result };
      }

      if (response.status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      try {
        const result = await response.json();
        return { status: "error", payload: result };
      } catch {
        return {
          status: "error",
          payload: {
            message: response.status === 429
              ? `Rate limited. Failed after ${maxRetries} retries.`
              : "Failed to generate XanoScript",
            doIgnore: response.status !== 429,
          },
        };
      }
    }

    return { status: "error", payload: { message: "Failed to generate XanoScript", doIgnore: true } };
  }

  // XanoScript conversion with 429 rate-limit retry
  async convertXanoScript(
    workspaceId: number,
    script: string
  ): Promise<{ status: string; payload: any }> {
    const body = JSON.stringify({ script, type: "xs" });
    const maxRetries = 5;
    const baseDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.fetch(
        `api:mvp-admin/workspace/${workspaceId}/script/convert`,
        { method: "POST", body }
      );

      if (response.ok) {
        const result = await response.json();
        return { status: "success", payload: result };
      }

      if (response.status === 429 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      try {
        const result = await response.json();
        return { status: "error", payload: result };
      } catch {
        return {
          status: "error",
          payload: {
            message: response.status === 429
              ? `Rate limited. Failed after ${maxRetries} retries.`
              : "Failed to convert XanoScript",
            doIgnore: response.status !== 429,
          },
        };
      }
    }

    return { status: "error", payload: { message: "Failed to convert XanoScript", doIgnore: true } };
  }
}

/**
 * Xano Master API Client - for api:master endpoints on app.xano.com
 */
export interface MasterClientConfig {
  token: string;
}

export class XanoMasterClient {
  private token: string;

  constructor(config: MasterClientConfig) {
    this.token = config.token;
  }

  private async fetchJson<T = any>(path: string, options?: RequestInit): Promise<T> {
    const url = `https://app.xano.com/api:master/${path}`;
    const response = await fetch(url, {
      ...(options || {}),
      headers: {
        ...(options?.headers || {}),
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Xano Master API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return (await response.json()) as T;
  }

  async getInstances(): Promise<any[]> {
    return this.fetchJson("instance");
  }

  async getInstanceDatabases(instanceId: number): Promise<any> {
    return this.fetchJson(`instance/${instanceId}/request-history/database`);
  }

  async clearInstanceDatabases(instanceId: number, tables: string[], force = false): Promise<void> {
    await this.fetchJson(`instance/${instanceId}/request-history/database/clear`, {
      method: "POST",
      body: JSON.stringify({ tables, force }),
    });
  }

  async restartDeployment(instanceId: number, name: string): Promise<void> {
    await this.fetchJson(`instance/${instanceId}/deployments/restart`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
  }
}
