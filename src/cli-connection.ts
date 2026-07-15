import { loadAuthFromFile, saveAuthToFile } from "./auth.js";
import { resolveConnection, type ResolveConnectionOptions } from "./connection.js";
import { XanoClient } from "./xano-client.js";

/** Validate identity, workspace, routing, and credentials before client construction. */
export async function makeClient(
  options: ResolveConnectionOptions,
  { requireWorkspace = true }: { requireWorkspace?: boolean } = {},
) {
  const selection = await resolveConnection(options);
  if (requireWorkspace && !selection.workspace) {
    throw new Error("Workspace ID required (--workspace or XANO_WORKSPACE).");
  }

  // Only an explicit user identity becomes the saved default. A DNS-derived
  // canonical hostname is routing metadata and is never persisted here.
  if (options.instance) {
    const auth = loadAuthFromFile();
    if (auth) {
      auth.xanoInstance = selection.requestedIdentity;
      if (selection.workspace) auth.xanoWorkspace = selection.workspace;
      else delete auth.xanoWorkspace;
      saveAuthToFile(auth);
    }
  }

  const client = new XanoClient({
    instance: selection.requestHostname,
    canonicalHostname: selection.canonicalHostname,
    token: selection.token,
    refreshToken: selection.refreshToken,
    connectionContext: {
      requestedIdentity: selection.requestedIdentity,
      registryIdentity: selection.registryIdentity,
      workspace: selection.workspace,
    },
  });
  return {
    client,
    selection,
    instance: selection.requestHostname,
    workspace: selection.workspace,
    branchId: selection.branchId,
  };
}
