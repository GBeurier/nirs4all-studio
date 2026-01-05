/**
 * Types for the Playground feature
 * Aligned with backend API contracts from api/playground.py
 */

// ============= Unified Operator Format =============

/**
 * Unified operator type supporting preprocessing, augmentation, and splitting
 * This format is shared with the Pipeline Editor for consistency
 */
export type UnifiedOperatorType = 'preprocessing' | 'augmentation' | 'splitting';

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
  type: 'preprocessing' | 'augmentation' | 'splitting';
  name: string;
  params: Record<string, unknown>;
  enabled: boolean;
}

/**
 * Execution options
 */
export interface ExecuteOptions {
  compute_pca?: boolean;
  compute_statistics?: boolean;
  max_wavelengths_returned?: number;
  max_folds_returned?: number;
  split_index?: number;
  use_cache?: boolean;
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
  fold_labels: number[];
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
 * Response from playground execution
 */
export interface ExecuteResponse {
  success: boolean;
  execution_time_ms: number;
  original: DataSection;
  processed: DataSection;
  pca?: PCAResult;
  folds?: FoldsInfo;
  execution_trace: StepTrace[];
  step_errors: StepError[];
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
  type: 'preprocessing' | 'augmentation' | 'splitting';
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
  folds?: FoldsInfo;
  executionTimeMs: number;
  trace: StepTrace[];
  errors: StepError[];
}
