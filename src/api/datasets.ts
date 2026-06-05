/**
 * Datasets API client — linking, CRUD, format/role detection, preview,
 * targets, versioning/integrity, and synthetic dataset generation.
 */

import { api, requestForm } from "./transport";
import type {
  Dataset,
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
  RelinkDatasetRequest,
  RelinkDatasetResponse,
  ScanFolderResponse,
  TargetConfig,
} from "@/types/datasets";
import type {
  GenerateSyntheticRequest,
  GenerateSyntheticResponse,
  SyntheticPreset,
} from "@/types/settings";

export interface DatasetInfo {
  id: string;
  name: string;
  path: string;
  samples?: number;
  num_samples?: number;
  train_samples?: number;
  test_samples?: number;
  features?: number;
  num_features?: number;
  targets?: number;
  default_target?: string;
  config?: Record<string, unknown>;
  group_id?: string;
  created_at: string;
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
  task_type?: string;
  signal_types?: string[];
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

export interface AutoDetectFileResponse {
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
}

/**
 * Auto-detect file parameters using nirs4all's AutoDetector
 * Returns full detection results including confidence scores
 */
export async function autoDetectFile(
  path: string,
  attemptLoad: boolean = true
): Promise<AutoDetectFileResponse> {
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
  parsing?: Partial<ParsingOptions>,
  perFileOverrides?: Record<string, Partial<ParsingOptions>>
): Promise<ValidateFilesResponse> {
  return api.post("/datasets/validate-files", { path, files, parsing, per_file_overrides: perFileOverrides });
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

  return requestForm(
    `/datasets/preview-upload?metadata=${encodeURIComponent(metadata)}`,
    formData,
  );
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
 * Relink dataset to a new path
 */
export async function relinkDataset(
  datasetId: string,
  request: RelinkDatasetRequest
): Promise<RelinkDatasetResponse> {
  return api.post(`/datasets/${datasetId}/relink`, request);
}

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

export interface DetectedTargetColumn {
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
}

export interface DetectDatasetTargetsResponse {
  dataset_id: string;
  y_file: string;
  detected_columns: DetectedTargetColumn[];
  num_columns: number;
}

/**
 * Detect available target columns from a dataset's Y file
 */
export async function detectDatasetTargets(
  datasetId: string,
  yFilePath?: string
): Promise<DetectDatasetTargetsResponse> {
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

/**
 * Get compact best-score-per-dataset payload used by the Datasets page.
 * Much cheaper than `/results/summary`: returns only the fields needed
 * to render per-dataset best-score badges (metric, best score, final/cv,
 * model name, linked dataset id).
 */
export async function getDatasetScores(
  workspaceId: string,
): Promise<import("@/types/datasets").DatasetScoresResponse> {
  return api.get(`/workspaces/${workspaceId}/results/dataset-scores`);
}
