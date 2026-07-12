import type { XanoClient } from "../xano-client.js";
import type { DocInventory } from "./types.js";

function flattenTools(toolsets: any[]): any[] {
  const tools: any[] = [];
  for (const ts of toolsets || []) {
    const nested = ts.tools ?? ts.tool ?? [];
    const arr = Array.isArray(nested) ? nested : [];
    for (const t of arr) {
      tools.push({
        ...t,
        toolset: t.toolset ?? { id: ts.id, name: ts.name },
      });
    }
  }
  return tools;
}

/** Load workspace objects needed for Markdown documentation (same coverage as the browser extension inventory). */
export async function loadDocsInventory(
  client: XanoClient,
  workspaceId: number,
  branchId: number
): Promise<DocInventory> {
  const [
    { apps, queries },
    { functions },
    sink,
    tasks,
    triggers,
    middleware,
    toolsets,
  ] = await Promise.all([
    client.getAPIAppsAndQueries(workspaceId, branchId),
    client.getFunctions(workspaceId, branchId),
    client.getWorkspaceSink(workspaceId),
    client.getTasks(workspaceId, branchId),
    client.getTriggers(workspaceId, branchId),
    client.getMiddleware(workspaceId, branchId),
    client.getMCPServers(workspaceId, branchId),
  ]);

  const dbos = sink.dbos ?? [];
  let workspace = sink.workspace ?? {};
  const branch = sink.branch ?? workspace.branch ?? { id: branchId };
  if (!workspace.branch && branch) {
    workspace = { ...workspace, branch };
  }
  const tools = flattenTools(toolsets ?? []);

  return {
    apps,
    queries,
    functions,
    dbos,
    tasks,
    triggers,
    middleware,
    toolsets,
    tools,
    workspace,
    branch,
  };
}
