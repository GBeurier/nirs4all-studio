/**
 * Types for the Playground feature
 * Aligned with backend API contracts from api/playground.py
 */

// ============= Unified Operator Format =============

/**
 * Unified operator type supporting preprocessing, augmentation, splitting, and filtering
 * This format is shared with the Pipeline Editor for consistency
 */
export type UnifiedOperatorType = 'preprocessing' | 'augmentation' | 'splitting' | 'filter';

/**
 * Unified operator format for playground pipeline steps
 * Aligned with Pipeline Editor format for import/export compatibility
 */
export interface UnifiedOperator {
  id: string;
  type: UnifiedOperatorType;
  name: string;  // Class name e.g., "StandardNormalVariate", "KFold", "GaussianAdditiveNoise"
  params: Record<string, unknown>;
  enabled: boolean;
}

// ============= Change Detection Types =============

/**
 * Categories of changes that affect different charts
 * Used for granular loading state management
 */
export type ChangeCategory =
  | 'data_transform'  // preprocessing, augmentation operators -> spectra, PCA, histogram
  | 'splitting'       // splitting operators -> folds chart only
  | 'embedding'       // UMAP toggle -> PCA chart only
  | 'filter'          // filter operators -> all charts (affects sample count)
  | 'all';            // multiple categories changed at once

/**
 * Per-chart loading state for granular loading indicators
 * Named "PerChartLoadingState" to avoid collision with ChartLoadingState in chartConfig.ts
 */
export interface PerChartLoadingState {
  spectra: boolean;
  histogram: boolean;
  pca: boolean;
  folds: boolean;
  repetitions: boolean;
}

// ============= API Request/Response Types =============

/**
 * Sampling options for large datasets
 */
export interface SamplingOptions {
  method: 'random' | 'stratified' | 'kmeans' | 'all';
  n_samples: number;
  seed: number;
}

/**
 * Input data for playground execution
 */
export interface PlaygroundData {
  x: number[][];
  y?: number[];
  wavelengths?: number[];
  sample_ids?: string[];
  metadata?: Record<string, unknown[]>;
}

/**
 * A single pipeline step for the backend
 */
export interface PlaygroundStep {
  id: string;
  type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter';
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Execution options
 */
export interface ExecuteOptions {
  compute_pca?: boolean;
  compute_umap?: boolean;
  umap_params?: {
    n_neighbors?: number;
    min_dist?: number;
    n_components?: number;
  };
  compute_statistics?: boolean;
  max_wavelengths_returned?: number;
  max_folds_returned?: number;
  split_index?: number;
  use_cache?: boolean;
  bio_sample_column?: string;
}

/**
 * Request model for executing playground pipeline
 */
export interface ExecuteRequest {
  data: PlaygroundData;
  steps: PlaygroundStep[];
  sampling?: SamplingOptions;
  options?: ExecuteOptions;
}

// ============= Response Types =============

/**
 * Execution trace for a single step
 */
export interface StepTrace {
  step_id: string;
  name: string;
  duration_ms: number;
  success: boolean;
  error?: string;
  output_shape?: number[];
}

/**
 * Per-wavelength statistics
 */
export interface SpectrumStats {
  mean: number[];
  std: number[];
  min: number[];
  max: number[];
  p5: number[];
  p95: number[];
  median?: number[];
  q1?: number[];
  q3?: number[];
  global: {
    mean: number;
    std: number;
    min: number;
    max: number;
    n_samples: number;
    n_features: number;
  };
}

/**
 * Y-value statistics for a fold
 */
export interface YStats {
  mean: number;
  std: number;
  min: number;
  max: number;
}

/**
 * Information about a single fold
 */
export interface FoldData {
  fold_index: number;
  train_count: number;
  test_count: number;
  train_indices: number[];
  test_indices: number[];
  y_train_stats?: YStats;
  y_test_stats?: YStats;
}

/**
 * Fold information when a splitter is present
 */
export interface FoldsInfo {
  splitter_name: string;
  n_folds: number;
  folds: FoldData[];
  fold_labels?: number[];
  split_index?: number;
}

/**
 * PCA projection results
 */
export interface PCAResult {
  coordinates: number[][];
  explained_variance_ratio: number[];
  explained_variance: number[];
  n_components: number;
  y?: number[];
  fold_labels?: number[];
  error?: string;
}

/**
 * Original or processed data section
 */
export interface DataSection {
  spectra: number[][];
  wavelengths: number[];
  sample_indices?: number[];
  shape: number[];
  statistics?: SpectrumStats;
}

/**
 * Step error information
 */
export interface StepError {
  step: string;
  name: string;
  error: string;
}

/**
 * Filter result information for a single filter operator
 */
export interface FilterResult {
  name: string;
  removed_count: number;
  reason?: string;
}

/**
 * Filter information when filter operators are applied
 */
export interface FilterInfo {
  filters_applied: FilterResult[];
  total_removed: number;
  final_mask: boolean[];
}

/**
 * UMAP projection results
 */
export interface UMAPResult {
  /** UMAP coordinates [n_samples, n_components] */
  coordinates: number[][];
  /** Number of UMAP components computed */
  n_components: number;
  /** UMAP parameters used */
  params?: {
    n_neighbors: number;
    min_dist: number;
  };
  /** Y values for coloring */
  y?: number[];
  /** Fold labels for coloring */
  fold_labels?: number[];
  /** Error message if computation failed */
  error?: string;
  /** Whether UMAP is available on the backend */
  available?: boolean;
}

/**
 * Single repetition data point
 */
export interface RepetitionDataPoint {
  /** Biological sample identifier */
  bio_sample: string;
  /** Index of this repetition within the bio sample (0, 1, 2...) */
  rep_index: number;
  /** Index in the overall sample array */
  sample_index: number;
  /** Original sample ID string */
  sample_id: string;
  /** Distance from reference (mean or first rep) */
  distance: number;
  /** Y value for this sample */
  y?: number;
  /** Mean Y value for all reps of this bio sample */
  y_mean?: number;
}

/**
 * Repetition analysis statistics
 */
export interface RepetitionStatistics {
  mean_distance: number;
  max_distance: number;
  std_distance: number;
  p95_distance: number;
}

/**
 * Repetition analysis results
 */
export interface RepetitionResult {
  /** Whether repetitions were detected */
  has_repetitions: boolean;
  /** Total number of biological samples (with and without reps) */
  n_bio_samples: number;
  /** Number of bio samples with 2+ repetitions */
  n_with_reps: number;
  /** Number of bio samples with only 1 measurement */
  n_singletons?: number;
  /** Total number of measurements from samples with reps */
  total_repetitions?: number;
  /** Distance metric used */
  distance_metric?: 'pca' | 'umap' | 'euclidean' | 'mahalanobis';
  /** Pattern used for detection (if any) */
  detected_pattern?: string | null;
  /** Message (e.g., when no reps found) */
  message?: string;
  /** Error message if computation failed */
  error?: string;
  /** Repetition data points for visualization */
  data?: RepetitionDataPoint[];
  /** Summary statistics */
  statistics?: RepetitionStatistics;
  /** High variability samples (top outliers) */
  high_variability_samples?: RepetitionDataPoint[];
  /** Bio sample groups (bio_id -> sample indices) - limited to 50 */
  bio_sample_groups?: Record<string, number[]>;
}

// ============= Phase 5: Spectral Metrics Types =============

/**
 * Statistics for a single metric
 */
export interface MetricStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/**
 * Information about a single metric
 */
export interface MetricInfo {
  name: string;
  display_name: string;
  description: string;
  category: string;
  requires_pca?: boolean;
}

/**
 * Metrics computation result
 */
export interface MetricsResult {
  /** Per-metric values (metric_name -> sample values array) */
  values: Record<string, number[]>;
  /** Per-metric statistics */
  statistics: Record<string, MetricStats>;
  /** List of successfully computed metrics */
  computed_metrics: string[];
  /** List of all available metric categories */
  available_metrics: string[];
  /** Number of samples */
  n_samples: number;
  /** Error message if computation failed */
  error?: string;
}

/**
 * Outlier detection result
 */
export interface OutlierResult {
  success: boolean;
  /** Boolean mask where true = inlier */
  inlier_mask: boolean[];
  /** Indices of outlier samples */
  outlier_indices: number[];
  /** Number of detected outliers */
  n_outliers: number;
  /** Number of inliers */
  n_inliers: number;
  /** Detection method used */
  method: string;
  /** Threshold value used */
  threshold: number;
  /** Raw metric values used for detection */
  values?: number[];
  /** Error message if detection failed */
  error?: string;
}

/**
 * Similarity search result
 */
export interface SimilarityResult {
  success: boolean;
  /** Reference sample index */
  reference_idx: number;
  /** Distance metric used */
  metric: string;
  /** Indices of similar samples */
  similar_indices: number[];
  /** Distances to similar samples */
  distances: number[];
  /** Number of similar samples found */
  n_similar: number;
  /** Error message if search failed */
  error?: string;
}

/**
 * Metric filter configuration for UI
 */
export interface MetricFilter {
  /** Metric name */
  metric: string;
  /** Minimum value threshold */
  min?: number;
  /** Maximum value threshold */
  max?: number;
  /** If true, select values outside range (outliers) */
  invert: boolean;
}

/**
 * Response from playground execution
 */
export interface ExecuteResponse {
  success: boolean;
  execution_time_ms: number;
  original: DataSection;
  processed: DataSection;
  pca?: PCAResult;
  umap?: UMAPResult;
  folds?: FoldsInfo;
  filter_info?: FilterInfo;
  repetitions?: RepetitionResult;
  metrics?: MetricsResult;
  execution_trace: StepTrace[];
  step_errors: StepError[];
  is_raw_data?: boolean;
}

// ============= Operator Registry Types =============

/**
 * Parameter info from the backend
 */
export interface OperatorParamInfo {
  required: boolean;
  default?: unknown;
  type?: string;
  default_is_callable?: boolean;
}

/**
 * Operator definition from the backend registry
 */
export interface OperatorDefinition {
  name: string;
  display_name: string;
  description: string;
  category: string;
  params: Record<string, OperatorParamInfo>;
  type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter';
  source?: string;
}

/**
 * Response from GET /api/playground/operators
 */
export interface OperatorsResponse {
  preprocessing: OperatorDefinition[];
  preprocessing_by_category: Record<string, OperatorDefinition[]>;
  augmentation: OperatorDefinition[];
  augmentation_by_category: Record<string, OperatorDefinition[]>;
  splitting: OperatorDefinition[];
  splitting_by_category: Record<string, OperatorDefinition[]>;
  filter: OperatorDefinition[];
  filter_by_category: Record<string, OperatorDefinition[]>;
  total: number;
}

// ============= Preset Types =============

/**
 * A preset pipeline configuration step
 */
export interface PresetStep {
  type: 'preprocessing' | 'augmentation' | 'splitting';
  name: string;
  params: Record<string, unknown>;
}

/**
 * A preset configuration
 */
export interface Preset {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: PresetStep[];
}

/**
 * Response from GET /api/playground/presets
 */
export interface PresetsResponse {
  presets: Preset[];
  total: number;
}

// ============= Validation Types =============

/**
 * Validation result for a single step
 */
export interface StepValidationResult {
  step_id: string;
  name: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validation response
 */
export interface ValidationResponse {
  valid: boolean;
  steps: StepValidationResult[];
  errors: string[];
  warnings: string[];
}

// ============= Playground State Types =============

/**
 * Current state of the playground
 */
export interface PlaygroundState {
  operators: UnifiedOperator[];
  selectedSample: number | null;
  isProcessing: boolean;
  error: string | null;
}

/**
 * Playground execution result for use in components
 */
export interface PlaygroundResult {
  original: DataSection;
  processed: DataSection;
  pca?: PCAResult;
  umap?: UMAPResult;
  folds?: FoldsInfo;
  filterInfo?: FilterInfo;
  repetitions?: RepetitionResult;
  metrics?: MetricsResult;
  executionTimeMs: number;
  trace: StepTrace[];
  errors: StepError[];
  isRawData?: boolean;
}
