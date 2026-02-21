/**
 * API client for nirs4all backend communication
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("API");

// Default API base URL for web mode (uses Vite proxy)
const DEFAULT_API_BASE_URL = "/api";

// Cache for the resolved backend URL in Electron mode
let resolvedBackendUrl: string | null = null;
let backendUrlPromise: Promise<string> | null = null;

/**
 * Detect if we're running in Electron.
 * Uses multiple detection methods since electronApi may not be available immediately.
 */
function isElectronEnvironment(): boolean {
  if (typeof window === "undefined") return false;

  // Check if electronApi is exposed (preferred method)
  if ((window as unknown as { electronApi?: { isElectron?: boolean } }).electronApi?.isElectron) {
    return true;
  }

  // Check if we're using file:// protocol (fallback for when electronApi isn't ready)
  if (window.location.protocol === "file:") {
    return true;
  }

  return false;
}

/**
 * Wait for electronApi to become available (preload script may take time)
 */
async function waitForElectronApi(maxWaitMs: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if ((window as unknown as { electronApi?: { getBackendUrl?: () => Promise<string> } }).electronApi?.getBackendUrl) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Get the API base URL, resolving Electron backend URL if needed.
 * In Electron mode, this fetches the dynamic port from the main process.
 * In web mode, it returns "/api" (which Vite proxies to the backend).
 */
async function getApiBaseUrl(): Promise<string> {
  // Return cached URL if available
  if (resolvedBackendUrl !== null) {
    return resolvedBackendUrl;
  }

  // If already resolving, wait for that promise
  if (backendUrlPromise !== null) {
    return backendUrlPromise;
  }

  // Check if we're in Electron mode
  if (isElectronEnvironment()) {
    backendUrlPromise = (async () => {
      try {
        // Wait for electronApi to be available
        const apiAvailable = await waitForElectronApi();
        if (!apiAvailable) {
          logger.error("electronApi not available after waiting");
          throw new Error("electronApi not available");
        }

        const electronApi = (window as unknown as { electronApi: { getBackendUrl: () => Promise<string> } }).electronApi;
        const backendUrl = await electronApi.getBackendUrl();
        resolvedBackendUrl = `${backendUrl}/api`;
        logger.info(`Using Electron backend URL: ${resolvedBackendUrl}`);
        return resolvedBackendUrl;
      } catch (error) {
        logger.error("Failed to get backend URL from Electron:", error);
        // Fallback to default - may not work but provides better error messages
        resolvedBackendUrl = DEFAULT_API_BASE_URL;
        return resolvedBackendUrl;
      }
    })();
    return backendUrlPromise;
  }

  // Web mode - use relative URL (Vite proxy)
  resolvedBackendUrl = DEFAULT_API_BASE_URL;
  return resolvedBackendUrl;
}

interface ApiError {
  detail: string;
  status: number;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const baseUrl = await getApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;
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
      // Preserve AbortError for proper handling by callers
      if (error instanceof Error && error.name === "AbortError") {
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

async function requestBinary(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: unknown
): Promise<Blob> {
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const detail = errorData.detail || `HTTP error ${response.status}`;
    throw { detail, status: response.status } as ApiError;
  }

  return response.blob();
}

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

// Enriched Runs & Projects types
import type { EnrichedRunsResponse, ScoreDistribution } from "@/types/enriched-runs";
import type { ProjectsResponse } from "@/types/projects";

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
  DetectedFile,
  ParsingOptions,
  UnifiedDetectionResponse,
  PreviewDataRequest,
  PreviewDataResponse,
  VerifyDatasetResponse,
  RefreshDatasetRequest,
  RefreshDatasetResponse,
  RelinkDatasetRequest,
  RelinkDatasetResponse,
  ScanFolderResponse,
} from "@/types/datasets";

export async function listDatasets(verifyIntegrity: boolean = false): Promise<DatasetListResponse> {
  const query = verifyIntegrity ? "?verify_integrity=true" : "";
  return api.get(`/datasets${query}`);
}

export async function getDataset(datasetId: string): Promise<{ dataset: Dataset }> {
  return api.get(`/datasets/${datasetId}`);
}

export interface UpdateDatasetRequest {
  name?: string;
  description?: string;
  config?: Partial<DatasetConfig>;
  default_target?: string;
}

export async function updateDatasetConfig(
  datasetId: string,
  updates: UpdateDatasetRequest
): Promise<{ success: boolean; dataset: Dataset }> {
  return api.put(`/datasets/${datasetId}`, updates);
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
 * Unified file detection using nirs4all's FolderParser.
 * Returns files, parsing options, fold detection, and metadata columns.
 */
export async function detectUnified(
  request: DetectFilesRequest
): Promise<UnifiedDetectionResponse> {
  return api.post("/datasets/detect-unified", request);
}

/**
 * Detect file roles from a list of individual file paths using nirs4all patterns.
 * Returns same structure as detectUnified - files with roles, parsing options, etc.
 */
export async function detectFilesList(
  paths: string[]
): Promise<UnifiedDetectionResponse> {
  return api.post("/datasets/detect-files-list", { paths });
}

/**
 * Recursively scan a folder for datasets using nirs4all FolderParser.
 * Returns detected datasets with their files, groups (parent folders), and parsing options.
 */
export async function scanFolder(
  path: string
): Promise<ScanFolderResponse> {
  return api.post("/datasets/scan-folder", { path });
}

/**
 * Auto-detect file parameters using nirs4all's AutoDetector
 * Returns full detection results including confidence scores
 */
export async function autoDetectFile(
  path: string,
  attemptLoad: boolean = true
): Promise<{
  success: boolean;
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_unit: string;
  signal_type?: string;
  encoding: string;
  confidence: Record<string, number>;
  num_rows?: number;
  num_columns?: number;
  warnings: string[];
}> {
  return api.post("/datasets/auto-detect", { path, attempt_load: attemptLoad });
}

/**
 * Validate files by loading them and returning their actual shapes.
 * This is a lightweight endpoint that loads files to get exact shapes
 * without computing full preview data (spectra charts, etc.).
 */
export interface FileShapeInfo {
  path: string;
  num_rows?: number;
  num_columns?: number;
  error?: string;
}

export interface ValidateFilesResponse {
  success: boolean;
  shapes: Record<string, FileShapeInfo>;
  error?: string;
}

export async function validateFiles(
  path: string,
  files: DetectedFile[],
  parsing?: Partial<ParsingOptions>
): Promise<ValidateFilesResponse> {
  return api.post("/datasets/validate-files", { path, files, parsing });
}

/**
 * Preview dataset with current configuration
 */
export async function previewDataset(
  request: PreviewDataRequest
): Promise<PreviewDataResponse> {
  return api.post("/datasets/preview", request);
}

/**
 * Preview dataset from uploaded files (for web mode without filesystem access)
 */
export async function previewDatasetWithUploads(
  files: File[],
  fileConfigs: Array<{
    path: string;
    type: "X" | "Y" | "metadata";
    split: "train" | "test";
    source: number | null;
    overrides?: Partial<ParsingOptions>;
  }>,
  parsing: Partial<ParsingOptions>,
  maxSamples: number = 100
): Promise<PreviewDataResponse> {
  const formData = new FormData();

  // Add each file to the form data
  for (const file of files) {
    formData.append("files", file);
  }

  // Metadata is sent as a JSON query parameter
  const metadata = JSON.stringify({
    files: fileConfigs,
    parsing,
    max_samples: maxSamples,
  });

  // Get the API base URL (handles Electron mode)
  const baseUrl = await getApiBaseUrl();
  const response = await fetch(
    `${baseUrl}/datasets/preview-upload?metadata=${encodeURIComponent(metadata)}`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to preview dataset");
  }

  return response.json();
}

/**
 * Preview a linked dataset by ID using its stored configuration
 */
export async function previewDatasetById(
  datasetId: string,
  maxSamples: number = 100
): Promise<PreviewDataResponse> {
  return api.get(`/datasets/${datasetId}/preview?max_samples=${maxSamples}`);
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

// Note: This is a minimal type for API transport. The full pipeline step type
// with branches, generators, etc. is in @/components/pipeline-editor/types.ts
// We use Record<string, unknown> to preserve all fields during save/load.
export interface PipelineStep {
  id: string;
  type: string;  // Allow any step type
  name: string;
  params: Record<string, unknown>;
  // Additional fields are preserved via spread during serialization
  [key: string]: unknown;
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

export async function getActiveRuns(): Promise<RunListResponse> {
  return api.get("/runs?status=running,queued");
}

export async function getRunStats(): Promise<RunStatsResponse> {
  return api.get("/runs/stats");
}

export async function createRun(config: ExperimentConfig): Promise<Run> {
  return api.post("/runs", { config });
}

// Quick Run (Run A) - Single pipeline execution
export interface QuickRunRequest {
  pipeline_id: string;
  dataset_id: string;
  name?: string;
  export_model?: boolean;
  cv_folds?: number;
  random_state?: number;
}

export async function quickRun(request: QuickRunRequest): Promise<Run> {
  return api.post("/runs/quick", request);
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
import type {
  StorageStatusResponse,
  MigrationStatusResponse,
  MigrationReport,
  MigrationJobResponse,
  StorageHealthResponse,
  CompactReport,
  CleanDeadLinksReport,
  RemoveBottomReport,
} from "@/types/storage";

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

/**
 * Open a folder in the system file explorer.
 * Uses Electron shell API in desktop mode, backend endpoint in web mode.
 */
export async function openFolderInExplorer(path: string): Promise<void> {
  if (window.electronApi?.revealInExplorer) {
    await window.electronApi.revealInExplorer(path);
  } else {
    await api.post("/system/open-folder", { path });
  }
}

// ============= Phase 7: nirs4all Workspace Management =============

import type {
  LinkedWorkspace,
  LinkedWorkspaceCreateRequest,
  LinkedWorkspaceListResponse,
  LinkedWorkspaceScanResult,
  LinkedWorkspaceDiscoveredRuns,
  LinkedWorkspaceDiscoveredPredictions,
  LinkedWorkspaceDiscoveredExports,
  LinkedWorkspaceDiscoveredTemplates,
  PredictionDataResponse,
  PredictionSummaryResponse,
  AppSettingsResponse,
  AppSettingsUpdateRequest,
  FavoriteAddRequest,
} from "@/types/linked-workspaces";

/**
 * Get list of linked nirs4all workspaces
 */
export async function getLinkedWorkspaces(): Promise<LinkedWorkspaceListResponse> {
  return api.get("/workspaces");
}

/**
 * Link a nirs4all workspace
 */
export async function linkN4AWorkspace(
  request: LinkedWorkspaceCreateRequest
): Promise<{ success: boolean; workspace: LinkedWorkspace; message: string }> {
  return api.post("/workspaces/link", request);
}

/**
 * Unlink a nirs4all workspace (does not delete files)
 */
export async function unlinkN4AWorkspace(
  workspaceId: string
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/workspaces/${workspaceId}`);
}

/**
 * Set a workspace as the active workspace
 */
export async function activateN4AWorkspace(
  workspaceId: string
): Promise<{ success: boolean; workspace: LinkedWorkspace; message: string }> {
  return api.post(`/workspaces/${workspaceId}/activate`);
}

/**
 * Trigger a scan of a linked workspace
 */
export async function scanN4AWorkspace(
  workspaceId: string
): Promise<LinkedWorkspaceScanResult> {
  return api.post(`/workspaces/${workspaceId}/scan`);
}

/**
 * Get discovered runs for a workspace
 */
export async function getN4AWorkspaceRuns(
  workspaceId: string,
  options?: {
    source?: "unified" | "manifests" | "parquet";
  }
): Promise<LinkedWorkspaceDiscoveredRuns> {
  const params = new URLSearchParams();
  if (options?.source) params.set("source", options.source);
  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/runs${query ? `?${query}` : ""}`);
}

/**
 * Get detailed information about a specific run.
 * Returns full run info including templates, datasets, config, and results.
 */
export async function getN4AWorkspaceRunDetail(
  workspaceId: string,
  runId: string
): Promise<unknown> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}`);
}

/**
 * Get individual results (pipeline config × dataset combinations).
 * Results represent the granular level below runs.
 */
export async function getN4AWorkspaceResults(
  workspaceId: string,
  options?: {
    run_id?: string;
    dataset?: string;
    template_id?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{
  workspace_id: string;
  results: Array<{
    id: string;
    run_id?: string;
    template_id?: string;
    dataset: string;
    pipeline_config: string;
    pipeline_config_id: string;
    created_at?: string;
    best_score?: number | null;
    best_model?: string;
    metric?: string;
    predictions_count?: number;
    artifact_count?: number;
    manifest_path?: string;
    val_score?: number | null;
    test_score?: number | null;
    has_refit?: boolean;
    refit_model_id?: string;
  }>;
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}> {
  const params = new URLSearchParams();
  if (options?.run_id) params.set("run_id", options.run_id);
  if (options?.dataset) params.set("dataset", options.dataset);
  if (options?.template_id) params.set("template_id", options.template_id);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/results${query ? `?${query}` : ""}`);
}

/**
 * Get results summary: top 5 models per dataset across all runs,
 * with final (refit) scores.
 */
export async function getWorkspaceResultsSummary(
  workspaceId: string,
): Promise<import("@/types/runs").ResultsSummaryResponse> {
  return api.get(`/workspaces/${workspaceId}/results/summary`);
}

/**
 * Get datasets discovered from run manifests.
 * Includes full metadata like n_samples, y_stats, and path status.
 */
export async function getN4AWorkspaceDiscoveredDatasets(
  workspaceId: string
): Promise<{
  workspace_id: string;
  datasets: Array<{
    name: string;
    path: string;
    hash?: string;
    task_type?: string;
    n_samples?: number;
    n_features?: number;
    runs_count: number;
    versions_seen: string[];
    hashes_seen: string[];
    status: "valid" | "missing" | "hash_mismatch" | "relocated" | "unknown";
  }>;
  total: number;
}> {
  return api.get(`/workspaces/${workspaceId}/datasets/discovered`);
}

/**
 * Get discovered predictions for a workspace
 */
export async function getN4AWorkspacePredictions(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredPredictions> {
  return api.get(`/workspaces/${workspaceId}/predictions`);
}

/**
 * Get prediction records data from parquet files.
 * Reads the actual prediction metadata (without heavy arrays).
 */
export async function getN4AWorkspacePredictionsData(
  workspaceId: string,
  options?: {
    limit?: number;
    offset?: number;
    dataset?: string;
  }
): Promise<PredictionDataResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.dataset) params.set("dataset", options.dataset);

  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/predictions/data${query ? `?${query}` : ""}`);
}

/**
 * Get aggregated prediction summary from parquet metadata.
 *
 * This endpoint reads ONLY file footers, not row data.
 * Response time: ~10-50ms for any workspace size.
 *
 * Returns instant summary with:
 * - Total predictions across all datasets
 * - Score statistics (min/max/mean)
 * - Model breakdown with average scores
 * - Top predictions by validation score
 */
export async function getN4AWorkspacePredictionsSummary(
  workspaceId: string
): Promise<PredictionSummaryResponse> {
  return api.get(`/workspaces/${workspaceId}/predictions/summary`);
}

/**
 * Scatter data response for prediction quick view.
 */
export interface PredictionScatterResponse {
  prediction_id: string;
  y_true: number[];
  y_pred: number[];
  n_samples: number;
  partition: string;
  model_name: string;
  dataset_name: string;
}

/**
 * Get scatter plot data (y_true vs y_pred) for a specific prediction.
 * Used for the prediction quick view charts.
 */
export async function getN4AWorkspacePredictionScatter(
  workspaceId: string,
  predictionId: string
): Promise<PredictionScatterResponse> {
  return api.get(`/workspaces/${workspaceId}/predictions/${predictionId}/scatter`);
}

/**
 * Get discovered exports for a workspace
 */
export async function getN4AWorkspaceExports(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredExports> {
  return api.get(`/workspaces/${workspaceId}/exports`);
}

/**
 * Get discovered templates for a workspace
 */
export async function getN4AWorkspaceTemplates(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredTemplates> {
  return api.get(`/workspaces/${workspaceId}/templates`);
}

// ============= App Settings (webapp-specific) =============

/**
 * Get app settings
 */
export async function getAppSettings(): Promise<AppSettingsResponse> {
  return api.get("/app/settings");
}

/**
 * Update app settings
 */
export async function updateAppSettings(
  settings: AppSettingsUpdateRequest
): Promise<{ success: boolean; settings: AppSettingsResponse; message: string }> {
  return api.put("/app/settings", settings);
}

/**
 * Get favorite pipelines
 */
export async function getFavorites(): Promise<{ favorites: string[] }> {
  return api.get("/app/favorites");
}

/**
 * Add a favorite pipeline
 */
export async function addFavorite(
  request: FavoriteAddRequest
): Promise<{ success: boolean; favorites: string[]; message: string }> {
  return api.post("/app/favorites", request);
}

/**
 * Remove a favorite pipeline
 */
export async function removeFavorite(
  pipelineId: string
): Promise<{ success: boolean; favorites: string[]; message: string }> {
  return api.delete(`/app/favorites/${pipelineId}`);
}

// ============= Config Path Management =============

export interface ConfigPathResponse {
  current_path: string;
  default_path: string;
  is_custom: boolean;
}

export interface SetConfigPathResponse {
  success: boolean;
  message: string;
  current_path: string;
  requires_restart: boolean;
}

/**
 * Get the current and default app config folder paths
 */
export async function getConfigPath(): Promise<ConfigPathResponse> {
  return api.get("/app/config-path");
}

/**
 * Set a custom app config folder path
 */
export async function setConfigPath(
  path: string
): Promise<SetConfigPathResponse> {
  return api.post("/app/config-path", { path });
}

/**
 * Reset the app config folder to the default location
 */
export async function resetConfigPath(): Promise<SetConfigPathResponse> {
  return api.delete("/app/config-path");
}

// ============= Updates API =============

export interface UpdateSettings {
  auto_check: boolean;
  check_interval_hours: number;
  prerelease_channel: boolean;
  github_repo: string;
  pypi_package: string;
  dismissed_versions: string[];
}

export interface WebappUpdateInfo {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_url: string | null;
  release_notes: string | null;
  published_at: string | null;
  download_size_bytes: number | null;
  download_url: string | null;
  asset_name: string | null;
  checksum_sha256: string | null;
}

export interface Nirs4allUpdateInfo {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  pypi_url: string | null;
  release_notes: string | null;
  requires_restart: boolean;
}

export interface VenvInfo {
  path: string;
  exists: boolean;
  is_valid: boolean;
  python_version: string | null;
  pip_version: string | null;
  created_at: string | null;
  last_updated: string | null;
  size_bytes: number;
}

export interface PackageInfo {
  name: string;
  version: string;
  location: string | null;
}

export interface UpdateStatus {
  webapp: WebappUpdateInfo;
  nirs4all: Nirs4allUpdateInfo;
  venv: VenvInfo;
  last_check: string | null;
  check_interval_hours: number;
}

export interface VenvStatus {
  venv: VenvInfo;
  packages: PackageInfo[];
  nirs4all_version: string | null;
}

export interface VersionInfo {
  webapp_version: string;
  nirs4all_version: string | null;
  python_version: string;
  platform: string;
  machine: string;
}

/**
 * Get current update status for webapp and nirs4all
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  return api.get("/updates/status");
}

/**
 * Force a fresh check for updates
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  return api.post("/updates/check");
}

/**
 * Get update settings
 */
export async function getUpdateSettings(): Promise<UpdateSettings> {
  return api.get("/updates/settings");
}

/**
 * Update settings
 */
export async function updateUpdateSettings(
  settings: Partial<UpdateSettings>
): Promise<UpdateSettings> {
  return api.put("/updates/settings", settings);
}

/**
 * Get managed venv status and installed packages
 */
export async function getVenvStatus(): Promise<VenvStatus> {
  return api.get("/updates/venv/status");
}

/**
 * Create the managed virtual environment
 */
export async function createVenv(options?: {
  force?: boolean;
  install_nirs4all?: boolean;
  extras?: string[];
}): Promise<{
  success: boolean;
  message: string;
  already_existed?: boolean;
  nirs4all_installed?: boolean;
  install_message?: string;
}> {
  return api.post("/updates/venv/create", options || {});
}

/**
 * Install or upgrade nirs4all in the managed venv
 */
export async function installNirs4all(options?: {
  version?: string;
  extras?: string[];
}): Promise<{
  success: boolean;
  message: string;
  version: string | null;
  output: string[];
}> {
  return api.post("/updates/nirs4all/install", options || {});
}

/**
 * Get webapp download information
 */
export async function getWebappDownloadInfo(): Promise<{
  update_available: boolean;
  current_version: string;
  latest_version: string | null;
  download_url?: string;
  asset_name?: string;
  download_size_bytes?: number;
  release_notes?: string;
  release_url?: string;
}> {
  return api.get("/updates/webapp/download-info");
}

/**
 * Download the latest webapp update (legacy)
 */
export async function downloadWebappUpdate(): Promise<{
  status: string;
  download_url: string;
  asset_name: string;
  version: string;
  message: string;
}> {
  return api.post("/updates/webapp/download");
}

// ============= Changelog API =============

export interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
  prerelease: boolean;
}

/**
 * Get changelog entries between current and latest webapp version
 */
export async function getWebappChangelog(currentVersion?: string): Promise<{
  entries: ChangelogEntry[];
  current_version?: string;
  error?: string;
}> {
  const params = currentVersion ? `?current_version=${currentVersion}` : "";
  return api.get(`/updates/webapp/changelog${params}`);
}

// ============= Auto-Update API =============

export interface DownloadJobResponse {
  job_id: string;
  status: string;
  version: string;
  asset_name: string;
  message: string;
}

export interface DownloadStatusResponse {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: {
    staging_path: string;
    version: string;
    ready_to_apply: boolean;
  };
  error?: string;
}

export interface StagedUpdateInfo {
  has_staged_update: boolean;
  staging_path?: string;
  version?: string;
}

export interface ApplyUpdateResponse {
  success: boolean;
  message: string;
  restart_required?: boolean;
}

/**
 * Start downloading the webapp update in the background
 */
export async function startWebappDownload(): Promise<DownloadJobResponse> {
  return api.post("/updates/webapp/download-start");
}

/**
 * Get download job status
 */
export async function getDownloadStatus(
  jobId: string
): Promise<DownloadStatusResponse> {
  return api.get(`/updates/webapp/download-status/${jobId}`);
}

/**
 * Cancel an in-progress download
 */
export async function cancelDownload(
  jobId: string
): Promise<{ success: boolean; message: string }> {
  return api.post(`/updates/webapp/download-cancel/${jobId}`);
}

/**
 * Get information about any staged update
 */
export async function getStagedUpdateInfo(): Promise<StagedUpdateInfo> {
  return api.get("/updates/webapp/staged-update");
}

/**
 * Apply the staged update
 */
export async function applyWebappUpdate(
  confirm: boolean = true
): Promise<ApplyUpdateResponse> {
  return api.post("/updates/webapp/apply", { confirm });
}

/**
 * Cancel/remove a staged update
 */
export async function cancelStagedUpdate(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.delete("/updates/webapp/staged-update");
}

/**
 * Clean up old update artifacts
 */
export async function cleanupUpdates(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post("/updates/webapp/cleanup");
}

/**
 * Request webapp restart
 */
export async function requestRestart(): Promise<{
  success: boolean;
  message: string;
  restart_required: boolean;
}> {
  return api.post("/updates/webapp/restart");
}

/**
 * Get current version information
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  return api.get("/updates/version");
}


// ============= Dependencies Management API =============

export interface DependencyInfo {
  name: string;
  category: string;
  category_name: string;
  description: string;
  min_version: string;
  installed_version: string | null;
  latest_version: string | null;
  is_installed: boolean;
  is_outdated: boolean;
  can_update: boolean;
}

export interface DependencyCategory {
  id: string;
  name: string;
  description: string;
  packages: DependencyInfo[];
  installed_count: number;
  total_count: number;
}

export interface DependenciesResponse {
  categories: DependencyCategory[];
  venv_valid: boolean;
  venv_path: string;
  venv_is_custom: boolean;
  nirs4all_installed: boolean;
  nirs4all_version: string | null;
  total_installed: number;
  total_packages: number;
  cached_at: string | null;
}

export interface PackageActionResponse {
  success: boolean;
  message: string;
  package: string;
  version?: string | null;
  output?: string[];
}

export interface VenvPathInfo {
  current_path: string;
  default_path: string;
  is_custom: boolean;
  is_valid: boolean;
  exists: boolean;
}

/**
 * Get all nirs4all optional dependencies with installation status
 */
export async function getDependencies(forceRefresh: boolean = false): Promise<DependenciesResponse> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  return api.get(`/updates/dependencies${params}`);
}

/**
 * Install a dependency package
 */
export async function installDependency(
  packageName: string,
  version?: string,
  upgrade: boolean = false
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/install", {
    package: packageName,
    version,
    upgrade,
  });
}

/**
 * Uninstall a dependency package
 */
export async function uninstallDependency(
  packageName: string
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/uninstall", {
    package: packageName,
  });
}

/**
 * Update a dependency package to latest version
 */
export async function updateDependency(
  packageName: string
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/update", {
    package: packageName,
  });
}

/**
 * Refresh outdated packages cache
 */
export async function refreshDependencies(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post("/updates/dependencies/refresh");
}

/**
 * Get current venv path configuration
 */
export async function getVenvPath(): Promise<VenvPathInfo> {
  return api.get("/updates/venv/path");
}

/**
 * Set custom venv path (pass null to reset to default)
 */
export async function setVenvPath(path: string | null): Promise<{
  success: boolean;
  message: string;
  current_path: string;
  is_custom: boolean;
  is_valid: boolean;
}> {
  return api.post("/updates/venv/path", { path });
}

// ============= Working Config Snapshots API =============

export interface ConfigSnapshot {
  name: string;
  label: string;
  created_at: string;
  size_bytes: number;
}

/**
 * List all saved config snapshots
 */
export async function listSnapshots(): Promise<{ snapshots: ConfigSnapshot[] }> {
  return api.get("/updates/venv/snapshots");
}

/**
 * Create a config snapshot (pip freeze)
 */
export async function createSnapshot(label?: string): Promise<{
  success: boolean;
  name: string;
  label: string;
  created_at: string;
}> {
  return api.post("/updates/venv/snapshots", { label: label || null });
}

/**
 * Restore a config snapshot
 */
export async function restoreSnapshot(name: string): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`/updates/venv/snapshots/${name}/restore`);
}

/**
 * Delete a config snapshot
 */
export async function deleteSnapshot(name: string): Promise<{
  success: boolean;
  message: string;
}> {
  return api.delete(`/updates/venv/snapshots/${name}`);
}

// =============================================================================
// Aggregated Predictions (DuckDB store)
// =============================================================================

import type {
  AggregatedPredictionsResponse,
  TopAggregatedPredictionsResponse,
  ChainDetailResponse,
  ChainPartitionDetailResponse,
  PredictionArraysResponse,
  AggregatedPredictionFilters,
} from "@/types/aggregated-predictions";

/**
 * Query aggregated predictions from the DuckDB store.
 * Returns one row per (chain_id, metric, dataset_name).
 */
export async function getAggregatedPredictions(
  filters?: AggregatedPredictionFilters
): Promise<AggregatedPredictionsResponse> {
  const params = new URLSearchParams();
  if (filters?.run_id) params.set("run_id", filters.run_id);
  if (filters?.pipeline_id) params.set("pipeline_id", filters.pipeline_id);
  if (filters?.chain_id) params.set("chain_id", filters.chain_id);
  if (filters?.dataset_name) params.set("dataset_name", filters.dataset_name);
  if (filters?.model_class) params.set("model_class", filters.model_class);
  if (filters?.metric) params.set("metric", filters.metric);
  const query = params.toString();
  return api.get(`/aggregated-predictions${query ? `?${query}` : ""}`);
}

/**
 * Get top-N aggregated predictions ranked by metric score.
 * Sort direction is auto-detected from the metric name.
 */
export async function getTopAggregatedPredictions(
  metric: string,
  options?: {
    n?: number;
    score_column?: string;
    run_id?: string;
    pipeline_id?: string;
    dataset_name?: string;
    model_class?: string;
  }
): Promise<TopAggregatedPredictionsResponse> {
  const params = new URLSearchParams({ metric });
  if (options?.n) params.set("n", String(options.n));
  if (options?.score_column) params.set("score_column", options.score_column);
  if (options?.run_id) params.set("run_id", options.run_id);
  if (options?.pipeline_id) params.set("pipeline_id", options.pipeline_id);
  if (options?.dataset_name) params.set("dataset_name", options.dataset_name);
  if (options?.model_class) params.set("model_class", options.model_class);
  return api.get(`/aggregated-predictions/top?${params.toString()}`);
}

/**
 * Get chain detail — aggregated summary + individual prediction rows.
 */
export async function getChainDetail(
  chainId: string,
  options?: { metric?: string; dataset_name?: string }
): Promise<ChainDetailResponse> {
  const params = new URLSearchParams();
  if (options?.metric) params.set("metric", options.metric);
  if (options?.dataset_name) params.set("dataset_name", options.dataset_name);
  const query = params.toString();
  return api.get(
    `/aggregated-predictions/chain/${chainId}${query ? `?${query}` : ""}`
  );
}

/**
 * Get partition-level prediction rows for a chain.
 */
export async function getChainPartitionDetail(
  chainId: string,
  options?: { partition?: string; fold_id?: string }
): Promise<ChainPartitionDetailResponse> {
  const params = new URLSearchParams();
  if (options?.partition) params.set("partition", options.partition);
  if (options?.fold_id) params.set("fold_id", options.fold_id);
  const query = params.toString();
  return api.get(
    `/aggregated-predictions/chain/${chainId}/detail${query ? `?${query}` : ""}`
  );
}

/**
 * Get prediction arrays (y_true, y_pred, etc.) for a single prediction.
 */
export async function getPredictionArrays(
  predictionId: string
): Promise<PredictionArraysResponse> {
  return api.get(`/aggregated-predictions/${predictionId}/arrays`);
}

/**
 * Download portable parquet for one dataset.
 */
export async function downloadAggregatedDatasetParquet(
  datasetName: string,
  options?: { partition?: string; model_name?: string }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (options?.partition) params.set("partition", options.partition);
  if (options?.model_name) params.set("model_name", options.model_name);
  const query = params.toString();
  return requestBinary(
    `/aggregated-predictions/export/${encodeURIComponent(datasetName)}.parquet${query ? `?${query}` : ""}`,
    "GET"
  );
}

/**
 * Bulk export dataset parquet files as zip (or single parquet).
 */
export async function exportAggregatedPredictions(options: {
  dataset_names?: string[];
  format: "parquet" | "zip";
}): Promise<Blob> {
  return requestBinary("/aggregated-predictions/export", "POST", options);
}

export interface AggregatedSQLQueryResponse {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

/**
 * Run read-only SQL query against aggregated predictions metadata.
 */
export async function runAggregatedPredictionsQuery(
  sql: string
): Promise<AggregatedSQLQueryResponse> {
  return api.post("/aggregated-predictions/query", { sql });
}

// ============================================================================
// Enriched Runs
// ============================================================================

export async function getEnrichedRuns(workspaceId: string, projectId?: string): Promise<EnrichedRunsResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return api.get(`/workspaces/${workspaceId}/runs/enriched${query}`);
}

export async function getScoreDistribution(workspaceId: string, runId: string, datasetName: string): Promise<ScoreDistribution> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}/datasets/${encodeURIComponent(datasetName)}/scores`);
}

// ============================================================================
// Projects
// ============================================================================

export async function listProjects(): Promise<ProjectsResponse> {
  return api.get("/projects");
}

export async function createProject(data: { name: string; description?: string; color?: string }): Promise<{ project_id: string; name: string }> {
  return api.post("/projects", data);
}

export async function updateProject(projectId: string, data: { name?: string; description?: string; color?: string }): Promise<{ success: boolean }> {
  return api.put(`/projects/${projectId}`, data);
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  return api.delete(`/projects/${projectId}`);
}

