/**
 * Workspace API client functions.
 */

import { api } from "./http";

// Workspace API
export interface WorkspaceResponse {
  workspace: {
    path: string;
    name: string;
    created_at: string;
  } | null;
  datasets: DatasetInfo[];
}

export interface DatasetInfo {
  id: string;
  name: string;
  path: string;
  samples?: number;
  features?: number;
  targets?: number;
  config?: Record<string, unknown>;
  group_id?: string;
  created_at: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  color?: string;
  created_at: string;
}

export async function getWorkspace(): Promise<WorkspaceResponse> {
  return api.get("/workspace");
}

export async function selectWorkspace(
  path: string,
  persistGlobal: boolean = true
): Promise<{ success: boolean; workspace: WorkspaceResponse["workspace"] }> {
  return api.post("/workspace/select", { path, persist_global: persistGlobal });
}

export async function reloadWorkspace(): Promise<{
  success: boolean;
  message: string;
  workspace: WorkspaceResponse["workspace"];
}> {
  return api.post("/workspace/reload");
}

export async function linkDataset(
  path: string,
  config?: Record<string, unknown>
): Promise<{ success: boolean; dataset: DatasetInfo }> {
  return api.post("/datasets/link", { path, config });
}

export async function unlinkDataset(
  datasetId: string
): Promise<{ success: boolean }> {
  return api.delete(`/datasets/${datasetId}`);
}

export async function refreshDataset(
  datasetId: string
): Promise<{ success: boolean; dataset: DatasetInfo }> {
  return api.post(`/datasets/${datasetId}/refresh`);
}

export async function getGroups(): Promise<{ groups: GroupInfo[] }> {
  return api.get("/workspace/groups");
}

export async function createGroup(
  name: string
): Promise<{ success: boolean; group: GroupInfo }> {
  return api.post("/workspace/groups", { name });
}

export async function deleteGroup(
  groupId: string
): Promise<{ success: boolean }> {
  return api.delete(`/workspace/groups/${groupId}`);
}

export async function renameGroup(
  groupId: string,
  newName: string
): Promise<{ success: boolean }> {
  return api.put(`/workspace/groups/${groupId}`, { name: newName });
}

export async function addDatasetToGroup(
  groupId: string,
  datasetId: string
): Promise<{ success: boolean }> {
  return api.post(`/workspace/groups/${groupId}/datasets`, {
    dataset_id: datasetId,
  });
}

export async function removeDatasetFromGroup(
  groupId: string,
  datasetId: string
): Promise<{ success: boolean }> {
  return api.delete(`/workspace/groups/${groupId}/datasets/${datasetId}`);
}
