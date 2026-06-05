/**
 * Dataset API client functions.
 */

import { api, authorizedFetch } from "./http";

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

  // authorizedFetch resolves the base URL and attaches the desktop token.
  const response = await authorizedFetch(
    `/datasets/preview-upload?metadata=${encodeURIComponent(metadata)}`,
    {
      method: "POST",
      // Do not set Content-Type: the browser sets the multipart boundary.
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
