/**
 * Custom Nodes API client functions.
 */

import { api } from "./http";

// Custom Nodes API (Phase 5)
export interface CustomNodeParameter {
  name: string;
  type: "int" | "float" | "string" | "bool" | "select" | "range";
  default?: unknown;
  required?: boolean;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface CustomNodeDefinition {
  id: string;
  label: string;
  category: string;
  description?: string;
  classPath: string;
  stepType: string;
  parameters: CustomNodeParameter[];
  icon?: string;
  color?: string;
  // Server-added metadata
  created_at?: string;
  updated_at?: string;
  imported_at?: string;
  source?: "workspace" | "user" | "admin";
}

export interface CustomNodeSettings {
  enabled: boolean;
  allowedPackages: string[];
  requireApproval: boolean;
  allowUserNodes: boolean;
}

export interface GetCustomNodesResponse {
  nodes: CustomNodeDefinition[];
  settings: CustomNodeSettings;
  count: number;
}

export interface ImportCustomNodesResult {
  success: boolean;
  message: string;
  imported: number;
  skipped: number;
  errors: number;
}

export interface ExportCustomNodesResponse {
  success: boolean;
  nodes: CustomNodeDefinition[];
  settings: CustomNodeSettings;
  exportedAt: string;
  version: string;
}

/**
 * Get all custom nodes for the current workspace
 */
export async function getCustomNodes(): Promise<GetCustomNodesResponse> {
  return api.get("/workspace/custom-nodes");
}

/**
 * Add a new custom node to the workspace
 */
export async function addCustomNode(
  node: Omit<CustomNodeDefinition, "created_at" | "updated_at" | "source">
): Promise<{ success: boolean; message: string; node: CustomNodeDefinition }> {
  return api.post("/workspace/custom-nodes", node);
}

/**
 * Update an existing custom node
 */
export async function updateCustomNode(
  nodeId: string,
  node: Omit<CustomNodeDefinition, "created_at" | "updated_at" | "source">
): Promise<{ success: boolean; message: string; node: CustomNodeDefinition }> {
  return api.put(`/workspace/custom-nodes/${nodeId}`, node);
}

/**
 * Delete a custom node from the workspace
 */
export async function deleteCustomNode(
  nodeId: string
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/workspace/custom-nodes/${nodeId}`);
}

/**
 * Import custom nodes from an external source
 */
export async function importCustomNodes(
  nodes: CustomNodeDefinition[],
  overwrite: boolean = false
): Promise<ImportCustomNodesResult> {
  return api.post("/workspace/custom-nodes/import", { nodes, overwrite });
}

/**
 * Export all custom nodes for backup/sharing
 */
export async function exportCustomNodes(): Promise<ExportCustomNodesResponse> {
  return api.get("/workspace/custom-nodes/export");
}

/**
 * Get custom node settings for the workspace
 */
export async function getCustomNodeSettings(): Promise<{ success: boolean; settings: CustomNodeSettings }> {
  return api.get("/workspace/custom-nodes/settings");
}

/**
 * Update custom node settings for the workspace
 */
export async function updateCustomNodeSettings(
  settings: CustomNodeSettings
): Promise<{ success: boolean; message: string; settings: CustomNodeSettings }> {
  return api.put("/workspace/custom-nodes/settings", settings);
}
