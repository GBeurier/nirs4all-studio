/**
 * Workspace API client — local studio workspace, dataset groups, storage
 * maintenance, workspace settings, data-loading defaults, and workspace
 * management (recent/list/create/export/import).
 */

import { api } from "./transport";
import type { DatasetInfo } from "./datasets";
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
import type {
  StorageStatusResponse,
  MigrationStatusResponse,
  MigrationReport,
  MigrationJobResponse,
  WorkspaceTransitionStatusResponse,
  LegacyWorkspaceConversionResponse,
  StorageHealthResponse,
  CompactReport,
  CleanDeadLinksReport,
  RemoveBottomReport,
} from "@/types/storage";

export interface WorkspaceResponse {
  workspace: {
    path: string;
    name: string;
    created_at: string;
  } | null;
  datasets: DatasetInfo[];
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

/**
 * Get workspace statistics including space usage breakdown
 */
export async function getWorkspaceStats(): Promise<WorkspaceStatsResponse> {
  return api.get("/workspace/stats");
}

/**
 * Get storage backend status for current workspace.
 */
export async function getStorageStatus(): Promise<StorageStatusResponse> {
  return api.get("/workspace/storage-status");
}

/**
 * Get migration status/estimate for current workspace.
 */
export async function getMigrationStatus(): Promise<MigrationStatusResponse> {
  return api.get("/workspace/migrate/status");
}

/**
 * Start migration (background job) or run dry run synchronously.
 */
export async function startMigration(options?: {
  dry_run?: boolean;
  batch_size?: number;
}): Promise<MigrationJobResponse | MigrationReport> {
  return api.post("/workspace/migrate", options ?? {});
}

/**
 * Get transition status for legacy workspace formats.
 */
export async function getWorkspaceTransitionStatus(): Promise<WorkspaceTransitionStatusResponse> {
  return api.get("/workspace/transition-status");
}

/**
 * Convert the active legacy workspace into a fresh V1 workspace.
 */
export async function convertLegacyWorkspace(options?: {
  output_path?: string;
  verify?: boolean;
  dry_run?: boolean;
  strict?: boolean;
}): Promise<LegacyWorkspaceConversionResponse> {
  return api.post("/workspace/legacy-convert", options ?? {});
}

/**
 * Get combined storage health data.
 */
export async function getStorageHealth(): Promise<StorageHealthResponse> {
  return api.get("/workspace/storage-health");
}

/**
 * Compact parquet arrays for one dataset or all datasets.
 */
export async function compactStorage(datasetName?: string): Promise<CompactReport> {
  return api.post("/workspace/compact", { dataset_name: datasetName });
}

/**
 * Clean dead metadata/array links.
 */
export async function cleanDeadLinks(dryRun: boolean): Promise<CleanDeadLinksReport> {
  return api.post("/workspace/clean-dead-links", { dry_run: dryRun });
}

/**
 * Remove bottom-ranked predictions with optional dry-run.
 */
export async function removeBottomPredictions(options: {
  fraction: number;
  metric?: string;
  partition?: string;
  dataset_name?: string;
  dry_run: boolean;
}): Promise<RemoveBottomReport> {
  return api.post("/workspace/remove-bottom", options);
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
