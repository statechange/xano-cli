/**
 * Performance Load Analysis - Portable from src/workers/performance.ts
 */

import { XanoClient } from "../xano-client.js";

export interface LoadAnalysisRequest {
  instance: string;
  workspace: number;
  branch_id: number;
  lookBack: number; // milliseconds
  apps?: any[];
  queries?: any[];
}

export interface RequestSummary {
  totalDuration: number;
  totalRequests: number;
  avgDuration: number;
  type?: string;        // "endpoint" | "trigger" | "task" | "tool"
  name?: string;        // human-readable name
  description?: string; // object description if available
  verb?: string;        // HTTP verb for endpoints
  status?: number;      // HTTP status for endpoints
  objectId?: number | string; // source object ID
}

export interface HistoryAnalysis {
  date: number;
  lookBack: number;
  requestSummary: Record<string, RequestSummary>;
  totals: RequestSummary;
  reportTime: number;
  reportDuration: number;
}

export async function generateLoadAnalysis(
  client: XanoClient,
  options: LoadAnalysisRequest
): Promise<HistoryAnalysis> {
  const startTime = Date.now();
  const { workspace, branch_id, lookBack } = options;

  let stuff: { apps: any[]; queries: any[] };
  if (options.apps && options.queries) {
    stuff = { apps: options.apps, queries: options.queries };
  } else {
    const result = await client.getAPIAppsAndQueries(workspace, branch_id);
    stuff = { apps: result.apps, queries: result.queries };
  }

  const canonicalObj = stuff.apps.reduce((acc: Record<string, any>, app: any) => {
    acc[app.canonical] = app;
    const endpoints = stuff.queries
      .filter((endpoint: any) => endpoint.app.id === app.id)
      .map((endpoint: any) => {
        const { name } = endpoint;
        const blobName = name.replace(/{[^}]*}/g, ".?");
        return { blobName, ...endpoint };
      });
    app.endpoints = endpoints;
    return acc;
  }, {});

  let page = 1;
  let requests: any[] = [];

  // Process triggers
  const triggers = await client.getTriggers(workspace, branch_id);
  if (triggers.length > 0) {
    for (const trigger of triggers) {
      page = 1;
      while (true) {
        try {
          const { items: triggerHistory } = await client.getTriggerHistory(
            trigger.id,
            branch_id,
            page
          );
          if (!triggerHistory || triggerHistory.length === 0) {
            break;
          }
          triggerHistory.forEach((item: any) => {
            item.scpType = "trigger";
            item.scpSource = "trigger:" + trigger.id;
            item.scpSourceId = trigger.id;

            const time =
              new Date(item.created_at).valueOf() - item.duration * 1000;
            if (time > startTime - lookBack) {
              requests.push(item);
            }
          });

          const oldestTime = Math.min(
            ...triggerHistory.map(
              (item: any) =>
                new Date(item.created_at).valueOf() - item.duration * 1000
            )
          );
          if (oldestTime < startTime - lookBack) {
            break;
          }
          page = page + 1;
          if (page > 1000) {
            console.error("Too many pages for trigger", trigger.id);
            break;
          }
        } catch (e) {
          console.error("Error in trigger", trigger.id, e);
          break;
        }
      }
    }
  }

  // Process API requests
  page = 1;
  while (true) {
    const { items: newRequests } = await client.getRequestHistory(
      workspace,
      page,
      branch_id
    );
    if (!newRequests || newRequests.length === 0) {
      break;
    }
    newRequests.forEach((request: any) => {
      request.scpType = "request";
      const url = new URL(request.uri);
      const path = url.pathname;
      request.path = path;
      const pieces = path.split("/");
      const appCanonical = pieces[1].split(":")[1];

      const app = canonicalObj[appCanonical];
      if (app) {
        request.app = app;
        const endpoint = app.endpoints?.find((ep: any) => {
          const { blobName } = ep;
          const regex = new RegExp(blobName);
          const newPath = "/" + pieces.slice(2).join("/");
          return regex.test(newPath);
        });
        request.endpoint = endpoint;
        if (endpoint) {
          request.scpSource =
            "endpoint:" +
            endpoint.id +
            "::" +
            request.verb +
            "::" +
            request.status;
          request.scpSourceId = endpoint.id;
        } else {
          request.scpSource =
            "endpoint:unknown::" + request.verb + "::" + request.status;
          request.scpSourceId = "unknown";
        }
      } else if (pieces[1] === "api:meta") {
        request.app = "metadata";
        const id = pieces.slice(2).join("/");
        request.scpSource =
          "endpoint:" +
          id +
          "::" +
          request.verb +
          "::" +
          request.app +
          "::" +
          request.status;
        request.scpSourceId = id;
      } else {
        request.app = pieces[1].split(":")[1].replace("::", " ") + " (Deleted)";
        const id = pieces.slice(2).join("/");
        request.scpSource =
          "endpoint:" +
          id +
          "::" +
          request.verb +
          "::" +
          request.app +
          "::" +
          request.status;
        request.scpSourceId = id;
      }

      const time =
        new Date(request.created_at).valueOf() - request.duration * 1000;
      if (time > startTime - lookBack) requests.push(request);
    });

    const oldestTime = Math.min(
      ...newRequests.map(
        (request: any) =>
          new Date(request.created_at).valueOf() - request.duration * 1000
      )
    );
    if (oldestTime < startTime - lookBack) {
      break;
    }
    page = page + 1;
    if (page > 1000) {
      console.error("Too many pages");
      break;
    }
  }

  // Process tasks
  const tasks = await client.getTasks(workspace, branch_id);
  if (tasks.length > 0) {
    for (const task of tasks) {
      page = 1;
      while (true) {
        try {
          const { items: taskHistory } = await client.getTaskHistory(task.id, page);
          if (!taskHistory || taskHistory.length === 0) {
            break;
          }
          taskHistory.forEach((item: any) => {
            item.scpType = "task";
            item.scpSource = "task:" + task.id;
            item.scpSourceId = task.id;

            const time =
              new Date(item.created_at).valueOf() - item.duration * 1000;
            if (time > startTime - lookBack) {
              requests.push(item);
            }
          });

          const oldestTime = Math.min(
            ...taskHistory.map(
              (item: any) =>
                new Date(item.created_at).valueOf() - item.duration * 1000
            )
          );
          if (oldestTime < startTime - lookBack) {
            break;
          }
          page = page + 1;
          if (page > 1000) {
            console.error("Too many pages for task", task.id);
            break;
          }
        } catch (e) {
          console.error("Error in task", task.id, e);
          break;
        }
      }
    }
  }

  // Process MCP servers
  const mcpServers = await client.getMCPServers(workspace, branch_id);
  if (mcpServers.length > 0) {
    for (const mcpServer of mcpServers) {
      page = 1;
      while (page <= 10) {
        try {
          const { items: mcpServerHistory } = await client.getMCPServerHistory(
            mcpServer.id,
            branch_id,
            page
          );
          if (!mcpServerHistory || mcpServerHistory.length === 0) {
            break;
          }
          mcpServerHistory.forEach((item: any) => {
            item.scpType = "tool";
            item.scpSource = "tool:" + item.tool.id;
            item.scpSourceId = item.tool.id;

            const time =
              new Date(item.created_at).valueOf() - item.duration * 1000;
            if (time > startTime - lookBack) {
              requests.push(item);
            }
          });

          const oldestTime = Math.min(
            ...mcpServerHistory.map(
              (item: any) =>
                new Date(item.created_at).valueOf() - item.duration * 1000
            )
          );
          if (oldestTime < startTime - lookBack) {
            break;
          }
          page = page + 1;
        } catch (e) {
          console.error("Error in mcp server", mcpServer.id, e);
          break;
        }
      }
    }
  }

  // Build summary
  requests.sort((a, b) => {
    const aDate = new Date(a.created_at).valueOf() - a.duration * 1000;
    const bDate = new Date(b.created_at).valueOf() - b.duration * 1000;
    return bDate - aDate;
  });

  // Build lookup maps for names/descriptions
  const triggerMap = new Map(triggers.map((t: any) => [t.id, t]));
  const taskMap = new Map(tasks.map((t: any) => [t.id, t]));
  const mcpToolMap = new Map<number, any>();
  for (const server of mcpServers) {
    mcpToolMap.set(server.id, server);
  }

  const requestSummary = requests.reduce((acc: Record<string, RequestSummary>, request: any) => {
    const { duration, scpSource, scpType, scpSourceId } = request;
    const old = acc[scpSource] || { totalDuration: 0, totalRequests: 0, avgDuration: 0 };
    old.totalDuration += duration;
    old.totalRequests++;
    old.avgDuration = old.totalDuration / old.totalRequests;

    // Enrich with metadata on first encounter
    if (!old.type) {
      old.type = scpType;
      old.objectId = scpSourceId;

      if (scpType === "request" && request.endpoint) {
        const ep = request.endpoint;
        const appName = typeof request.app === "object" ? request.app.name : String(request.app || "");
        old.name = `${appName} / ${ep.name || ep.path || "unknown"}`;
        old.description = ep.description || request.app?.description || undefined;
        old.verb = request.verb;
        old.status = request.status;
        old.objectId = ep.id;
      } else if (scpType === "request") {
        const appName = typeof request.app === "object" ? request.app.name : String(request.app || "unknown");
        old.name = `${appName} (unmatched endpoint)`;
        old.verb = request.verb;
        old.status = request.status;
      } else if (scpType === "trigger") {
        const trigger = triggerMap.get(scpSourceId);
        old.name = trigger?.name || `Trigger ${scpSourceId}`;
        old.description = trigger?.description || undefined;
      } else if (scpType === "task") {
        const task = taskMap.get(scpSourceId);
        old.name = task?.name || `Task ${scpSourceId}`;
        old.description = task?.description || undefined;
      } else if (scpType === "tool") {
        const tool = mcpToolMap.get(scpSourceId);
        old.name = tool?.name || `MCP Tool ${scpSourceId}`;
        old.description = tool?.description || undefined;
      }
    }

    acc[scpSource] = old;
    return acc;
  }, {} as Record<string, RequestSummary>);

  const totals = Object.values(requestSummary).reduce(
    (
      acc: RequestSummary,
      item: RequestSummary
    ) => {
      acc.totalDuration += item.totalDuration;
      acc.totalRequests += item.totalRequests;
      acc.avgDuration = acc.totalDuration / acc.totalRequests;
      return acc;
    },
    { totalDuration: 0, totalRequests: 0, avgDuration: 0 }
  );

  return {
    date: startTime,
    lookBack,
    requestSummary,
    totals,
    reportTime: Date.now(),
    reportDuration: Date.now() - startTime,
  };
}
