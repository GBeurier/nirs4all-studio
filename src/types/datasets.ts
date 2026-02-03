/**
 * Dataset-related type definitions for nirs4all webapp
 */

/**
 * Dataset file configuration for multi-source datasets
 */
export interface DatasetFile {
  path: string;
  type: "X" | "Y" | "metadata";
  split: "train" | "test";
  source: number | null;
  detected?: boolean;
  /** Per-file parsing overrides */
  overrides?: Partial<ParsingOptions>;
}

/**
 * Signal type for spectral data
 */
export type SignalType =
  | "absorbance"
  | "reflectance"
  | "reflectance%"
  | "transmittance"
  | "transmittance%"
  | "auto";

/**
 * Header unit for wavelength columns
 */
export type HeaderUnit = "nm" | "cm-1" | "text" | "none" | "index";

/**
 * NA handling policy
 */
export type NaPolicy = "auto" | "abort" | "remove_sample" | "remove_feature" | "replace" | "ignore";

/**
 * Configuration for NA value replacement (used when na_policy is "replace")
 */
export interface NaFillConfig {
  method: "value" | "mean" | "median" | "forward_fill" | "backward_fill";
  fill_value?: number;
  per_column?: boolean;
}

/**
 * Task type for the dataset
 */
export type TaskType = "auto" | "regression" | "binary_classification" | "multiclass_classification";

/**
 * Parsing options for CSV files
 */
export interface ParsingOptions {
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_unit: HeaderUnit;
  signal_type: SignalType;
  na_policy: NaPolicy;
  /** Configuration for NA replacement (when na_policy is "replace") */
  na_fill_config?: NaFillConfig;
  /** For Excel files */
  sheet_name?: string;
  /** Skip rows at start */
  skip_rows?: number;
  /** File encoding (utf-8, latin-1, cp1252, iso-8859-1) */
  encoding?: string;
}

// ============= Advanced Configuration Types =============

/**
 * Fold source type for cross-validation
 */
export type FoldSource = "none" | "column" | "file" | "inline";

/**
 * Single fold definition
 */
export interface FoldDefinition {
  train: number[];
  val: number[];
}

/**
 * Cross-validation fold configuration
 */
export interface FoldConfig {
  source: FoldSource;
  /** Column name containing fold assignments */
  column?: string;
  /** Path to fold file */
  file?: string;
  /** Inline fold definitions */
  folds?: FoldDefinition[];
}

/**
 * Source configuration for multi-source datasets
 */
export interface SourceConfig {
  id: number;
  name: string;
  files: DetectedFile[];
  params?: Partial<ParsingOptions>;
}

/**
 * Multi-source dataset configuration
 */
export interface MultiSourceConfig {
  sources: SourceConfig[];
  /** Column to link samples across sources */
  link_by?: string;
  /** Whether targets file is shared across sources */
  shared_targets?: boolean;
}

/**
 * Target column configuration
 */
export interface TargetConfig {
  column: string;
  type: TaskType;
  unit?: string;
  classes?: string[];
  /** Whether this is the default target when multiple are available */
  is_default?: boolean;
  /** Display label for the target (optional, defaults to column name) */
  label?: string;
  /** Description of what this target represents */
  description?: string;
}

/**
 * Aggregation configuration
 */
export interface AggregationConfig {
  enabled: boolean;
  column?: string;
  method: "mean" | "median" | "vote";
}

/**
 * CSV parsing configuration
 */
export interface DatasetConfig {
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_type?: "nm" | "cm-1" | "text" | "none";
  header_unit?: HeaderUnit;
  signal_type?: SignalType;
  na_policy?: NaPolicy;
  files?: DatasetFile[];
  train_x?: string;
  train_y?: string;
  test_x?: string;
  test_y?: string;
  train_group?: string;
  test_group?: string;
  /** Global parsing params */
  global_params?: Partial<ParsingOptions>;
  /** Per-file params */
  train_x_params?: Partial<ParsingOptions>;
  train_y_params?: Partial<ParsingOptions>;
  test_x_params?: Partial<ParsingOptions>;
  test_y_params?: Partial<ParsingOptions>;
  /** Target columns */
  targets?: TargetConfig[];
  /** Default target column name */
  default_target?: string;
  /** Task type */
  task_type?: TaskType;
  /** Aggregation settings */
  aggregation?: AggregationConfig;
}

/**
 * Dataset information returned from the API
 */
export interface Dataset {
  id: string;
  name: string;
  path: string;
  linked_at: string;
  status?: "available" | "missing" | "loading" | "error";
  group_id?: string;
  /** Optional description for the dataset */
  description?: string;

  // Version & Integrity (Phase 2)
  hash?: string;
  last_verified?: string;
  version?: number;
  version_status?: DatasetVersionStatus;

  // Computed fields (from loading the dataset)
  num_samples?: number;
  num_features?: number;
  n_sources?: number;
  is_multi_source?: boolean;
  task_type?: "regression" | "classification" | null;
  num_classes?: number;
  has_targets?: boolean;
  has_metadata?: boolean;
  metadata_columns?: string[];
  signal_types?: string[];
  num_folds?: number;

  // Configuration
  config?: DatasetConfig;

  // Multi-target support (Phase 3)
  /** Available target columns with their configurations */
  targets?: TargetConfig[];
  /** Name of the default target column */
  default_target?: string;

  // UI state
  load_warning?: string;
  last_refreshed?: string;
}

/**
 * Dataset group for organizing datasets
 */
export interface DatasetGroup {
  id: string;
  name: string;
  dataset_ids: string[];
  color?: string;
  created_at: string;
}

/**
 * Dataset statistics
 */
export interface DatasetStats {
  dataset_id: string;
  partition: string;
  global: {
    num_samples: number;
    num_features: number;
    global_mean: number;
    global_std: number;
    global_min: number;
    global_max: number;
  };
  features: {
    mean: number[];
    std: number[];
    min: number[];
    max: number[];
    median: number[];
  };
  targets?: {
    type: "regression" | "classification";
    mean?: number;
    std?: number;
    min?: number;
    max?: number;
    median?: number;
    num_classes?: number;
    classes?: (string | number)[];
    class_counts?: Record<string, number>;
  };
}

/**
 * Split configuration for dataset partitioning
 */
export interface SplitConfig {
  method: "random" | "stratified" | "kennard_stone" | "spxy";
  test_size: number;
  random_state?: number;
  n_bins?: number;
}

/**
 * Filter configuration for sample filtering
 */
export interface FilterConfig {
  column?: string;
  values?: (string | number)[];
  indices?: number[];
  exclude_outliers?: boolean;
  outlier_method?: string;
}

/**
 * Export configuration
 */
export interface ExportConfig {
  format: "csv" | "excel" | "parquet" | "npz";
  include_metadata?: boolean;
  include_targets?: boolean;
  partition?: string;
}

/**
 * Dataset version status for integrity tracking (Phase 2)
 */
export type DatasetVersionStatus = "current" | "modified" | "missing" | "unchecked";

/**
 * Dataset change summary for refresh confirmation
 */
export interface DatasetChangeSummary {
  samples_added: number;
  samples_removed: number;
  files_changed: string[];
  files_added?: string[];
  files_removed?: string[];
  size_change_bytes: number;
  old_hash: string;
  new_hash: string;
}

/**
 * Merge configuration for combining datasets
 */
export interface MergeConfig {
  dataset_ids: string[];
  name: string;
  merge_axis: "samples" | "features";
}

/**
 * Dataset list response from API
 */
export interface DatasetListResponse {
  datasets: Dataset[];
  total: number;
}

/**
 * Dataset link request
 */
export interface LinkDatasetRequest {
  path: string;
  config?: Partial<DatasetConfig>;
}

/**
 * Dataset update request
 */
export interface UpdateDatasetRequest {
  config?: Partial<DatasetConfig>;
  group_id?: string | null;
}

// ============= Wizard Types =============

/**
 * Source type for dataset wizard
 */
export type WizardSourceType = "folder" | "files" | "url" | "synthetic";

/**
 * Wizard step identifiers
 */
export type WizardStep = "source" | "files" | "parsing" | "targets" | "preview";

/**
 * Detected file info from backend
 */
export interface DetectedFile {
  path: string;
  filename: string;
  type: "X" | "Y" | "metadata" | "unknown";
  split: "train" | "test" | "unknown";
  source: number | null;
  format: "csv" | "xlsx" | "xls" | "mat" | "npy" | "npz" | "parquet";
  size_bytes: number;
  confidence: number;
  detected: boolean;
  /** Number of rows in the file (from backend detection) */
  num_rows?: number;
  /** Number of columns in the file (from backend detection) */
  num_columns?: number;
}

/**
 * File detection request
 */
export interface DetectFilesRequest {
  path: string;
  recursive?: boolean;
}

/**
 * File detection response
 */
export interface DetectFilesResponse {
  files: DetectedFile[];
  folder_name: string;
  total_size_bytes: number;
  has_standard_structure: boolean;
}

/**
 * Confidence scores for auto-detected parameters
 */
export interface DetectionConfidence {
  delimiter?: number;
  decimal_separator?: number;
  has_header?: number;
  header_unit?: number;
  signal_type?: number;
}

/**
 * Unified detection response using nirs4all
 */
export interface UnifiedDetectionResponse {
  files: DetectedFile[];
  folder_name: string;
  total_size_bytes: number;
  has_standard_structure: boolean;
  parsing_options: Partial<ParsingOptions>;
  confidence?: DetectionConfidence;
  has_fold_file: boolean;
  fold_file_path?: string;
  metadata_columns: string[];
  warnings: string[];
}

/**
 * Auto-detect request for single file
 */
export interface AutoDetectRequest {
  path: string;
  attempt_load?: boolean;
}

/**
 * Auto-detect response for single file
 */
export interface AutoDetectResponse {
  success: boolean;
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_unit: string;
  signal_type?: string;
  encoding: string;
  confidence: DetectionConfidence;
  num_rows?: number;
  num_columns?: number;
  warnings: string[];
}

/**
 * Format detection request
 */
export interface DetectFormatRequest {
  path: string;
  sample_rows?: number;
}

/**
 * Column type detection info from nirs4all
 */
export interface ColumnInfo {
  name: string;
  data_type: "numeric" | "text";
  task_type: string; // "regression" | "binary_classification" | "multiclass_classification"
  unique_values?: number;
  min?: number;
  max?: number;
  mean?: number;
}

/**
 * Format detection response
 */
export interface DetectFormatResponse {
  format: "csv" | "xlsx" | "xls" | "mat" | "npy" | "npz" | "parquet";
  detected_delimiter?: string;
  detected_decimal?: string;
  has_header?: boolean;
  num_rows?: number;
  num_columns?: number;
  sample_data?: string[][];
  column_names?: string[];
  sheet_names?: string[];
  column_info?: ColumnInfo[]; // Column type detection from nirs4all
}

/**
 * Preview data request
 */
export interface PreviewDataRequest {
  path: string;
  files: DatasetFile[];
  parsing: Partial<ParsingOptions>;
  max_samples?: number;
}

/**
 * Preview data response
 */
export interface PreviewDataResponse {
  success: boolean;
  error?: string;
  summary: {
    num_samples: number;
    num_features: number;
    n_sources: number;
    train_samples: number;
    test_samples: number;
    has_targets: boolean;
    has_metadata: boolean;
    target_columns?: string[];
    metadata_columns?: string[];
    signal_type?: SignalType;
    header_unit?: HeaderUnit;
  };
  spectra_preview?: {
    wavelengths: number[];
    mean_spectrum: number[];
    std_spectrum: number[];
    min_spectrum: number[];
    max_spectrum: number[];
    sample_spectra: number[][];
  };
  target_distribution?: {
    type: "regression" | "classification";
    values?: number[];
    min?: number;
    max?: number;
    mean?: number;
    std?: number;
    histogram?: { bin: number; count: number }[];
    classes?: string[];
    class_counts?: Record<string, number>;
  };
  /** Per-source spectra data for multi-source datasets */
  spectra_per_source?: Record<number, {
    wavelengths: number[];
    mean_spectrum: number[];
    std_spectrum: number[];
    min_spectrum: number[];
    max_spectrum: number[];
  }>;
  /** Per-target distribution data for multi-target datasets */
  target_distributions?: Record<string, {
    type: "regression" | "classification";
    min?: number;
    max?: number;
    mean?: number;
    std?: number;
    histogram?: { bin: number; count: number }[];
    classes?: string[];
    class_counts?: Record<string, number>;
  }>;
}

/**
 * Complete wizard state
 */
export interface WizardState {
  step: WizardStep;
  sourceType: WizardSourceType | null;
  basePath: string;
  datasetName: string;
  files: DetectedFile[];
  parsing: ParsingOptions;
  perFileOverrides: Record<string, Partial<ParsingOptions>>;
  targets: TargetConfig[];
  defaultTarget: string;
  taskType: TaskType;
  aggregation: AggregationConfig;
  preview: PreviewDataResponse | null;
  isLoading: boolean;
  errors: Record<string, string>;

  // Detection results from unified detection
  /** Whether a fold file was detected in the folder */
  hasFoldFile: boolean;
  /** Path to the detected fold file */
  foldFilePath: string | null;
  /** Detected metadata columns (for aggregation column dropdown) */
  metadataColumns: string[];
  /** Confidence scores for auto-detected parameters */
  confidence: DetectionConfidence;

  // Advanced configuration
  /** Multi-source configuration (auto-detected) */
  multiSource: MultiSourceConfig | null;
  /** Cross-validation fold configuration */
  folds: FoldConfig | null;

  // Web mode support - File objects for reading content when filesystem paths aren't available
  /** Map of relative path to File object for web mode */
  fileBlobs: Map<string, File>;

  // Validated shapes from actual file loading
  /** Validated shapes from loading files (path -> {num_rows, num_columns, error}) */
  validatedShapes: Record<string, { num_rows?: number; num_columns?: number; error?: string }>;
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Global validation error */
  validationError: string | null;
}

// ============= Phase 2: Versioning & Integrity Types =============

/**
 * Verify dataset response
 */
export interface VerifyDatasetResponse {
  success: boolean;
  dataset_id: string;
  version_status: DatasetVersionStatus;
  current_hash: string;
  stored_hash: string | null;
  is_modified: boolean;
  change_summary?: DatasetChangeSummary;
  verified_at: string;
}

/**
 * Refresh dataset request (to accept changes)
 */
export interface RefreshDatasetRequest {
  accept_changes: boolean;
}

/**
 * Refresh dataset response
 */
export interface RefreshDatasetResponse {
  success: boolean;
  dataset_id: string;
  old_hash: string | null;
  new_hash: string;
  version: number;
  change_summary: DatasetChangeSummary;
  refreshed_at: string;
}

/**
 * Relink dataset request
 */
export interface RelinkDatasetRequest {
  new_path: string;
  force: boolean;
}

/**
 * Relink dataset response
 */
export interface RelinkDatasetResponse {
  success: boolean;
  dataset_id: string;
  old_path: string;
  new_path: string;
  validation: {
    structure_matches: boolean;
    file_count_matches: boolean;
    warnings: string[];
  };
  new_hash: string;
  relinked_at: string;
}

