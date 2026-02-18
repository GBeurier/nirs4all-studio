/**
 * Settings and Workspace Statistics type definitions for nirs4all webapp
 * Phase 5 Implementation
 */
import type { NaPolicy, NaFillConfig } from "./datasets";

/**
 * Space usage for a single category
 */
export interface SpaceUsageItem {
  name: string;
  size_bytes: number;
  file_count: number;
  percentage: number;
}

/**
 * Workspace statistics response
 */
export interface WorkspaceStatsResponse {
  path: string;
  name: string;
  total_size_bytes: number;
  space_usage: SpaceUsageItem[];
  linked_datasets_count: number;
  linked_datasets_external_size: number;
  duckdb_size_bytes: number;
  parquet_arrays_size_bytes: number;
  storage_mode: string;

  created_at: string;
  last_accessed: string;
}

/**
 * Clean cache request options
 */
export interface CleanCacheRequest {
  clean_temp: boolean;
  clean_orphan_results: boolean;
  clean_old_predictions: boolean;
  days_threshold: number;
}

/**
 * Clean cache response
 */
export interface CleanCacheResponse {
  success: boolean;
  files_removed: number;
  bytes_freed: number;
  categories_cleaned: string[];
}



/**
 * Data loading default settings
 */
export interface DataLoadingDefaults {
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_unit: "nm" | "cm-1" | "text" | "none" | "index";
  signal_type: "absorbance" | "reflectance" | "reflectance%" | "transmittance" | "transmittance%" | "auto";
  na_policy: NaPolicy;
  na_fill_config?: NaFillConfig;
  auto_detect: boolean;
}

/**
 * Complete workspace settings
 */
export interface WorkspaceSettings {
  data_loading_defaults: DataLoadingDefaults;
  developer_mode: boolean;
  cache_enabled: boolean;

  // General UI settings
  general?: GeneralSettings;
}

// ============= Phase 3: Workspace Management Types =============

/**
 * Workspace information for recent workspaces list
 */
export interface WorkspaceInfo {
  path: string;
  name: string;
  created_at: string;
  last_accessed: string;
  num_datasets: number;
  num_pipelines: number;
  description?: string;
}

/**
 * Response from listing workspaces
 */
export interface WorkspaceListResponse {
  workspaces: WorkspaceInfo[];
  total: number;
}

/**
 * Request to create a new workspace
 */
export interface CreateWorkspaceRequest {
  path: string;
  name: string;
  description?: string;
  create_dir: boolean;
}

/**
 * Request to export a workspace
 */
export interface ExportWorkspaceRequest {
  output_path: string;
  include_datasets: boolean;
  include_models: boolean;
  include_results: boolean;
}

/**
 * Response from exporting a workspace
 */
export interface ExportWorkspaceResponse {
  success: boolean;
  output_path: string;
  archive_size_bytes: number;
  items_exported: number;
  message: string;
}

/**
 * Request to import a workspace from archive
 */
export interface ImportWorkspaceRequest {
  archive_path: string;
  destination_path: string;
  workspace_name?: string;
}

/**
 * Response from importing a workspace
 */
export interface ImportWorkspaceResponse {
  success: boolean;
  workspace_path: string;
  workspace_name: string;
  items_imported: number;
  message: string;
}



/**
 * Theme options
 */
export type ThemeOption = "light" | "dark" | "system";

/**
 * UI density options
 */
export type UIDensity = "compact" | "comfortable" | "spacious";

/**
 * UI zoom level options (percentage)
 */
export type UIZoomLevel = 75 | 80 | 90 | 100 | 110 | 125 | 150;

/**
 * Application settings (local, not workspace-specific)
 */
export interface AppSettings {
  theme: ThemeOption;
  language: string;
  backend_url: string;
}

/**
 * Supported language codes
 */
export type LanguageCode = "en" | "fr" | "de";

/**
 * General UI settings (stored in workspace settings)
 */
export interface GeneralSettings {
  theme: ThemeOption;
  ui_density: UIDensity;
  reduce_animations: boolean;
  sidebar_collapsed: boolean;
  language?: LanguageCode;
  zoom_level?: UIZoomLevel;
}

/**
 * Default data loading settings
 */
export const DEFAULT_DATA_LOADING_DEFAULTS: DataLoadingDefaults = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "nm",
  signal_type: "auto",
  na_policy: "auto",
  auto_detect: true,
};

/**
 * Default general settings
 */
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  theme: "system",
  ui_density: "comfortable",
  reduce_animations: false,
  sidebar_collapsed: false,
  language: "en",
  zoom_level: 100,
};

/**
 * Default workspace settings
 */
export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  data_loading_defaults: DEFAULT_DATA_LOADING_DEFAULTS,
  developer_mode: false,
  cache_enabled: true,

  general: DEFAULT_GENERAL_SETTINGS,
};

// ============= Phase 6: Synthetic Data Generation Types =============

/**
 * Request parameters for synthetic dataset generation
 */
export interface GenerateSyntheticRequest {
  task_type: "regression" | "binary_classification" | "multiclass_classification";
  n_samples: number;
  complexity: "simple" | "realistic" | "complex";
  n_classes?: number;
  target_range?: [number, number];
  train_ratio?: number;
  include_metadata?: boolean;
  include_repetitions?: boolean;
  repetitions_per_sample?: number;
  noise_level?: number;
  add_batch_effects?: boolean;
  n_batches?: number;
  wavelength_range?: [number, number];
  name?: string;
  auto_link?: boolean;
}

/**
 * Summary of generated dataset
 */
export interface GeneratedDatasetSummary {
  task_type: string;
  n_samples: number;
  complexity: string;
  train_ratio: number;
  n_classes?: number;
  target_range?: [number, number];
  wavelength_range?: [number, number];
  include_metadata: boolean;
  include_repetitions: boolean;
  noise_level: number;
  add_batch_effects: boolean;
  generated_at: string;
  num_features?: number;
  train_samples?: number;
  test_samples?: number;
  link_error?: string;
}

/**
 * Response from synthetic dataset generation
 */
export interface GenerateSyntheticResponse {
  success: boolean;
  dataset_id?: string;
  name: string;
  path: string;
  summary: GeneratedDatasetSummary;
  linked: boolean;
  message: string;
}

/**
 * Preset configuration for synthetic data generation
 */
export interface SyntheticPreset {
  id: string;
  name: string;
  description: string;
  task_type: "regression" | "binary_classification" | "multiclass_classification";
  n_samples: number;
  complexity: "simple" | "realistic" | "complex";
  icon: string;
}

/**
 * Default values for synthetic generation form
 */
export const DEFAULT_SYNTHETIC_CONFIG: GenerateSyntheticRequest = {
  task_type: "regression",
  n_samples: 500,
  complexity: "simple",
  n_classes: 3,
  train_ratio: 0.8,
  include_metadata: true,
  include_repetitions: false,
  repetitions_per_sample: 3,
  noise_level: 0.05,
  add_batch_effects: false,
  n_batches: 3,
  auto_link: true,
};

// ============= Phase 5: System Information & Diagnostics Types =============

/**
 * Python environment information
 */
export interface PythonInfo {
  version: string;
  platform: string;
  executable: string;
}

/**
 * System/OS information
 */
export interface SystemDetails {
  os: string;
  release: string;
  machine: string;
  processor: string;
}

/**
 * Package version mapping
 */
export interface PackageVersions {
  [packageName: string]: string;
}

/**
 * System information response from /system/info
 */
export interface SystemInfoResponse {
  python: PythonInfo;
  system: SystemDetails;
  nirs4all_version: string;
  packages: PackageVersions;
}

/**
 * Capabilities response from /system/capabilities
 */
export interface SystemCapabilities {
  basic: boolean;
  nirs4all: boolean;
  tensorflow: boolean;
  pytorch: boolean;
  gpu_cuda: boolean;
  gpu_mps: boolean;
  visualization: boolean;
  export_excel: boolean;
}

export interface SystemCapabilitiesResponse {
  capabilities: SystemCapabilities;
}

/**
 * Health check response
 */
export interface HealthCheckResponse {
  status: string;
  message: string;
}

/**
 * Health check with latency measurement
 */
export interface HealthCheckWithLatency extends HealthCheckResponse {
  latency_ms: number;
  timestamp: string;
}

/**
 * System status response from /system/status
 */
export interface SystemStatusResponse {
  status: {
    workspace_loaded: boolean;
    workspace: {
      name: string;
      path: string;
      datasets_count: number;
      last_modified: string | null;
    } | null;
    nirs4all_available: boolean;
  };
}

/**
 * System paths response from /system/paths
 */
export interface SystemPathsResponse {
  paths: {
    working_directory: string;
    home_directory: string;
    python_executable: string;
    workspace?: string;
    pipelines?: string;
    predictions?: string;
  };
}

/**
 * Error log entry
 */
export interface ErrorLogEntry {
  id: string;
  timestamp: string;
  level: "error" | "warning" | "critical";
  endpoint: string;
  message: string;
  details?: string;
  traceback?: string;
}

/**
 * Error log response
 */
export interface ErrorLogResponse {
  errors: ErrorLogEntry[];
  total: number;
  max_stored: number;
}
