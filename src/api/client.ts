/**
 * API client for nirs4all backend communication
 */

const API_BASE_URL = "/api";

interface ApiError {
  detail: string;
  status: number;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const { body, ...restOptions } = options;

    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...restOptions,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: ApiError = {
          detail: errorData.detail || `HTTP error ${response.status}`,
          status: response.status,
        };
        throw error;
      }

      return await response.json();
    } catch (error) {
      if ((error as ApiError).status) {
        throw error;
      }
      throw {
        detail: error instanceof Error ? error.message : "Network error",
        status: 0,
      } as ApiError;
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", ...options });
  }

  // POST request
  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data,
      ...options,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data,
      ...options,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", ...options });
  }
}

export const api = new ApiClient();

// Axios-like wrapper for backward compatibility with hooks expecting response.data pattern
class AxiosLikeClient {
  async get<T>(endpoint: string, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.get<T>(endpoint, options);
    return { data };
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.post<T>(endpoint, body, options);
    return { data };
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.put<T>(endpoint, body, options);
    return { data };
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.delete<T>(endpoint, options);
    return { data };
  }
}

export const apiClient = new AxiosLikeClient();

// Health check
export async function checkHealth(): Promise<{ status: string }> {
  return api.get("/health");
}

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

// Dataset API - Extended
import type {
  Dataset,
  DatasetGroup,
  DatasetConfig,
  DatasetStats,
  DatasetListResponse,
  ExportConfig,
  DetectFilesRequest,
  DetectFilesResponse,
  DetectFormatRequest,
  DetectFormatResponse,
  PreviewDataRequest,
  PreviewDataResponse,
  VerifyDatasetResponse,
  RefreshDatasetRequest,
  RefreshDatasetResponse,
  RelinkDatasetRequest,
  RelinkDatasetResponse,
} from "@/types/datasets";

export async function listDatasets(verifyIntegrity: boolean = false): Promise<DatasetListResponse> {
  const query = verifyIntegrity ? "?verify_integrity=true" : "";
  return api.get(`/datasets${query}`);
}

export async function getDataset(datasetId: string): Promise<{ dataset: Dataset }> {
  return api.get(`/datasets/${datasetId}`);
}

export async function updateDatasetConfig(
  datasetId: string,
  config: Partial<DatasetConfig>
): Promise<{ success: boolean; dataset: Dataset }> {
  return api.put(`/datasets/${datasetId}`, { config });
}

export async function getDatasetStats(
  datasetId: string,
  partition: string = "train"
): Promise<DatasetStats> {
  return api.get(`/datasets/${datasetId}/stats?partition=${partition}`);
}

export async function exportDataset(
  datasetId: string,
  config: ExportConfig
): Promise<{ success: boolean; export_path: string }> {
  return api.post(`/datasets/${datasetId}/export`, config);
}

export async function listGroups(): Promise<{ groups: DatasetGroup[] }> {
  return api.get("/workspace/groups");
}

/**
 * Detect files in a folder for dataset loading
 */
export async function detectFiles(
  request: DetectFilesRequest
): Promise<DetectFilesResponse> {
  return api.post("/datasets/detect-files", request);
}

/**
 * Detect file format (delimiter, decimal, header, etc.)
 */
export async function detectFormat(
  request: DetectFormatRequest
): Promise<DetectFormatResponse> {
  return api.post("/datasets/detect-format", request);
}

/**
 * Preview dataset with current configuration
 */
export async function previewDataset(
  request: PreviewDataRequest
): Promise<PreviewDataResponse> {
  return api.post("/datasets/preview", request);
}

// ============= Phase 2: Versioning & Integrity API =============

/**
 * Verify dataset integrity by comparing current hash with stored hash
 */
export async function verifyDataset(
  datasetId: string
): Promise<VerifyDatasetResponse> {
  return api.post(`/datasets/${datasetId}/verify`);
}

/**
 * Get cached version status for a dataset (quick check)
 */
export async function getDatasetVersionStatus(
  datasetId: string
): Promise<{
  dataset_id: string;
  version_status: string;
  hash: string | null;
  version: number;
  last_verified: string | null;
}> {
  return api.get(`/datasets/${datasetId}/version-status`);
}

/**
 * Refresh dataset by accepting changes and updating stored hash
 */
export async function refreshDatasetVersion(
  datasetId: string,
  request: RefreshDatasetRequest = { accept_changes: true }
): Promise<RefreshDatasetResponse> {
  return api.post(`/datasets/${datasetId}/refresh`, request);
}

/**
 * Relink dataset to a new path
 */
export async function relinkDataset(
  datasetId: string,
  request: RelinkDatasetRequest
): Promise<RelinkDatasetResponse> {
  return api.post(`/datasets/${datasetId}/relink`, request);
}

// ============= Phase 3: Multi-Target Support API =============

import type { TargetConfig } from "@/types/datasets";

/**
 * Get configured targets for a dataset
 */
export async function getDatasetTargets(
  datasetId: string
): Promise<{
  dataset_id: string;
  targets: TargetConfig[];
  default_target: string | null;
  num_targets: number;
}> {
  return api.get(`/datasets/${datasetId}/targets`);
}

/**
 * Update target configuration for a dataset
 */
export async function updateDatasetTargets(
  datasetId: string,
  targets: TargetConfig[],
  defaultTarget?: string
): Promise<{
  success: boolean;
  dataset_id: string;
  targets: TargetConfig[];
  default_target: string | null;
  updated_at: string;
}> {
  return api.put(`/datasets/${datasetId}/targets`, {
    targets,
    default_target: defaultTarget,
  });
}

/**
 * Detect available target columns from a dataset's Y file
 */
export async function detectDatasetTargets(
  datasetId: string,
  yFilePath?: string
): Promise<{
  dataset_id: string;
  y_file: string;
  detected_columns: Array<{
    column: string;
    type: string;
    unique_values: number;
    sample_values: (string | number)[];
    is_target_candidate: boolean;
    is_metadata_candidate: boolean;
    classes?: string[];
    min?: number;
    max?: number;
    mean?: number;
  }>;
  num_columns: number;
}> {
  const query = yFilePath ? `?y_file_path=${encodeURIComponent(yFilePath)}` : "";
  return api.post(`/datasets/${datasetId}/detect-targets${query}`);
}

/**
 * Set the default target for a dataset
 */
export async function setDefaultTarget(
  datasetId: string,
  targetColumn: string
): Promise<{
  success: boolean;
  dataset_id: string;
  default_target: string;
}> {
  return api.post(`/datasets/${datasetId}/set-default-target?target_column=${encodeURIComponent(targetColumn)}`);
}

// Pipeline API
export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
}

export interface PipelineStep {
  id: string;
  type: "preprocessing" | "splitting" | "model" | "metrics";
  name: string;
  params: Record<string, unknown>;
}

export async function listPipelines(): Promise<{ pipelines: PipelineInfo[] }> {
  return api.get("/pipelines");
}

export async function getPipeline(id: string): Promise<PipelineInfo> {
  return api.get(`/pipelines/${id}`);
}

export async function savePipeline(
  pipeline: Partial<PipelineInfo>
): Promise<{ success: boolean; pipeline: PipelineInfo }> {
  if (pipeline.id) {
    return api.put(`/pipelines/${pipeline.id}`, pipeline);
  }
  return api.post("/pipelines", pipeline);
}

export async function deletePipeline(
  id: string
): Promise<{ success: boolean }> {
  return api.delete(`/pipelines/${id}`);
}

// Predictions API
export interface PredictionRecord {
  id: string;
  dataset_name: string;
  pipeline_name: string;
  model_name: string;
  run_id: string;
  metrics: Record<string, number>;
  created_at: string;
}

export async function listPredictions(): Promise<{
  predictions: PredictionRecord[];
}> {
  return api.get("/predictions");
}

// Runs API
import type {
  Run,
  RunListResponse,
  RunStatsResponse,
  RunActionResponse,
  ExperimentConfig,
} from "@/types/runs";

export async function listRuns(): Promise<RunListResponse> {
  return api.get("/runs");
}

export async function getRun(runId: string): Promise<Run> {
  return api.get(`/runs/${runId}`);
}

export async function getRunStats(): Promise<RunStatsResponse> {
  return api.get("/runs/stats");
}

export async function createRun(config: ExperimentConfig): Promise<Run> {
  return api.post("/runs", { config });
}

export async function stopRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/stop`);
}

export async function pauseRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/pause`);
}

export async function resumeRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/resume`);
}

export async function retryRun(runId: string): Promise<Run> {
  return api.post(`/runs/${runId}/retry`);
}

export async function deleteRun(runId: string): Promise<RunActionResponse> {
  return api.delete(`/runs/${runId}`);
}

export async function getPipelineLogs(
  runId: string,
  pipelineId: string
): Promise<{ pipeline_id: string; logs: string[] }> {
  return api.get(`/runs/${runId}/logs/${pipelineId}`);
}

// Pipeline Samples API
export interface PipelineSampleInfo {
  id: string;
  filename: string;
  format: string;
  name: string;
  description: string;
}

export interface PipelineSamplesResponse {
  samples: PipelineSampleInfo[];
  total: number;
  samples_dir: string;
}

export interface PipelineSampleDetail {
  name: string;
  description: string;
  pipeline: unknown[];
  has_generators: boolean;
  num_configurations: number;
  source_file: string;
  error?: string;
}

export interface RoundtripValidationResult {
  valid: boolean;
  sample_id: string;
  differences: string[];
  original_step_count: number;
  editor_step_count: number;
}

export async function listPipelineSamples(): Promise<PipelineSamplesResponse> {
  return api.get("/pipelines/samples");
}

export async function getPipelineSample(
  sampleId: string,
  canonical: boolean = true
): Promise<PipelineSampleDetail> {
  return api.get(`/pipelines/samples/${sampleId}?canonical=${canonical}`);
}

export async function validateSampleRoundtrip(
  sampleId: string,
  editorSteps: unknown[]
): Promise<RoundtripValidationResult> {
  return api.post(`/pipelines/samples/${sampleId}/validate-roundtrip`, editorSteps);
}

// ============= Phase 4: Shape Propagation API =============

/**
 * Shape at a pipeline step
 */
export interface ShapeAtStep {
  step_id: string;
  step_name: string;
  input_shape: { samples: number; features: number };
  output_shape: { samples: number; features: number };
  warnings: ShapeWarning[];
}

/**
 * Shape warning
 */
export interface ShapeWarning {
  type: "param_exceeds_dimension" | "shape_mismatch" | "unknown_transform";
  step_id: string;
  step_name: string;
  message: string;
  param_name?: string;
  param_value?: number;
  max_value?: number;
  severity: "warning" | "error";
}

/**
 * Shape propagation response
 */
export interface ShapePropagationResponse {
  shapes: ShapeAtStep[];
  warnings: ShapeWarning[];
  output_shape: { samples: number; features: number };
  is_valid: boolean;
}

/**
 * Calculate shape propagation through a pipeline
 */
export async function propagateShape(
  steps: unknown[],
  inputShape: { samples: number; features: number }
): Promise<ShapePropagationResponse> {
  return api.post("/pipelines/propagate-shape", {
    steps,
    input_shape: inputShape,
  });
}

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



// ============= Phase 6: Synthetic Data Generation =============

import type {
  GenerateSyntheticRequest,
  GenerateSyntheticResponse,
  SyntheticPreset,
} from "@/types/settings";

/**
 * Generate a synthetic NIRS dataset
 */
export async function generateSyntheticDataset(
  request: GenerateSyntheticRequest
): Promise<GenerateSyntheticResponse> {
  return api.post("/datasets/generate-synthetic", request);
}

/**
 * Get available presets for synthetic data generation
 */
export async function getSyntheticPresets(): Promise<{ presets: SyntheticPreset[] }> {
  return api.get("/datasets/synthetic-presets");
}

// ============= Phase 5: System Information & Diagnostics =============

import type {
  SystemInfoResponse,
  SystemCapabilitiesResponse,
  HealthCheckResponse,
  HealthCheckWithLatency,
  SystemStatusResponse,
  SystemPathsResponse,
  ErrorLogResponse,
} from "@/types/settings";

/**
 * Get system and environment information
 */
export async function getSystemInfo(): Promise<SystemInfoResponse> {
  return api.get("/system/info");
}

/**
 * Get system capabilities based on installed packages
 */
export async function getSystemCapabilities(): Promise<SystemCapabilitiesResponse> {
  return api.get("/system/capabilities");
}

/**
 * Get current system status including workspace info
 */
export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return api.get("/system/status");
}

/**
 * Get important system paths
 */
export async function getSystemPaths(): Promise<SystemPathsResponse> {
  return api.get("/system/paths");
}

/**
 * Perform a health check with latency measurement
 */
export async function performHealthCheck(): Promise<HealthCheckWithLatency> {
  const startTime = performance.now();
  const response = await api.get<HealthCheckResponse>("/health");
  const endTime = performance.now();

  return {
    ...response,
    latency_ms: Math.round(endTime - startTime),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get recent error logs (stored in backend memory)
 */
export async function getErrorLogs(limit: number = 50): Promise<ErrorLogResponse> {
  return api.get(`/system/errors?limit=${limit}`);
}

/**
 * Clear error logs
 */
export async function clearErrorLogs(): Promise<{ success: boolean; cleared: number }> {
  return api.delete("/system/errors");
}
