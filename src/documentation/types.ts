/**
 * Workspace snapshot for markdown documentation (browser extension inventory shape).
 */

export interface DocInventory {
  workspace: Record<string, any>;
  branch?: Record<string, any>;
  apps: any[];
  queries: any[];
  functions?: any[];
  tasks?: any[];
  triggers?: any[];
  middleware?: any[];
  dbos?: any[];
  toolsets?: any[];
  tools?: any[];
  [key: string]: any[] | Record<string, any> | undefined;
}
