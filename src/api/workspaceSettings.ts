/**
 * Workspace statistics, settings, and management API client functions.
 */

import { api } from "./http";

// ============= Workspace Statistics & Settings (Phase 5) =============

import type {
  WorkspaceStatsResponse,
  CleanCacheRequest,
  CleanCacheResponse,

  DataLoadingDefaults,
  WorkspaceSettings,
  WorkspaceInfo,
  WorkspaceListResponse,
  CreateWorkspaceRequest,
  ExportWorkspaceRequest,
  ExportWorkspaceResponse,
  ImportWorkspaceRequest,
  ImportWorkspaceResponse,

} from "@/types/settings";

/**
 * Get workspace statistics including space usage breakdown
 */
export async function getWorkspaceStats(): Promise<WorkspaceStatsResponse> {
  return api.get("/workspace/stats");
}

/**
 * Clean workspace cache and temporary files
 */
export async function cleanWorkspaceCache(
  options: Partial<CleanCacheRequest> = {}
): Promise<CleanCacheResponse> {
  const request: CleanCacheRequest = {
    clean_temp: options.clean_temp ?? true,
    clean_orphan_results: options.clean_orphan_results ?? false,
    clean_old_predictions: options.clean_old_predictions ?? false,
    days_threshold: options.days_threshold ?? 30,
  };
  return api.post("/workspace/clean-cache", request);
}



/**
 * Get workspace settings including data loading defaults
 */
export async function getWorkspaceSettings(): Promise<WorkspaceSettings> {
  return api.get("/workspace/settings");
}

/**
 * Update workspace settings
 */
export async function updateWorkspaceSettings(
  settings: Partial<WorkspaceSettings>
): Promise<{ success: boolean; message: string }> {
  return api.put("/workspace/settings", settings);
}

/**
 * Get data loading defaults for the dataset wizard
 */
export async function getDataLoadingDefaults(): Promise<DataLoadingDefaults> {
  return api.get("/workspace/data-defaults");
}

/**
 * Update data loading defaults
 */
export async function updateDataLoadingDefaults(
  defaults: Partial<DataLoadingDefaults>
): Promise<{ success: boolean; message: string; defaults: DataLoadingDefaults }> {
  return api.put("/workspace/data-defaults", defaults);
}

// ============= Phase 3: Workspace Management =============

/**
 * Get list of recent workspaces
 */
export async function getRecentWorkspaces(
  limit: number = 10
): Promise<WorkspaceListResponse> {
  return api.get(`/workspace/recent?limit=${limit}`);
}

/**
 * List all known workspaces
 */
export async function listWorkspaces(): Promise<WorkspaceListResponse> {
  return api.get("/workspace/list");
}

/**
 * Create a new workspace
 */
export async function createWorkspace(
  request: CreateWorkspaceRequest
): Promise<WorkspaceInfo> {
  return api.post("/workspace/create", request);
}

/**
 * Remove a workspace from the recent list (does not delete files)
 */
export async function removeWorkspaceFromList(
  path: string
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/workspace/remove?path=${encodeURIComponent(path)}`);
}

/**
 * Export workspace to archive
 */
export async function exportWorkspace(
  request: ExportWorkspaceRequest
): Promise<ExportWorkspaceResponse> {
  return api.post("/workspace/export", request);
}

/**
 * Import workspace from archive
 */
export async function importWorkspace(
  request: ImportWorkspaceRequest
): Promise<ImportWorkspaceResponse> {
  return api.post("/workspace/import", request);
}
