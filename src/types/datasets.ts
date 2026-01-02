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
}

/**
 * CSV parsing configuration
 */
export interface DatasetConfig {
  delimiter: string;
  decimal_separator: string;
  has_header: boolean;
  header_type?: "nm" | "cm-1" | "text" | "none";
  files?: DatasetFile[];
  train_x?: string;
  train_y?: string;
  test_x?: string;
  test_y?: string;
  train_group?: string;
  test_group?: string;
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
