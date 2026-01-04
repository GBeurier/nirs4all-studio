/**
 * Pipeline types for nirs4all webapp
 * Phase 6: Pipelines Library
 */

export type PipelineCategory = "user" | "preset" | "shared";
export type PipelineRunStatus = "success" | "failed" | "running" | "pending";

/**
 * Pipeline step types matching nirs4all operator categories.
 * Extended to support all operators from the library.
 */
export type PipelineStepType =
  // Preprocessing categories
  | "preprocessing"
  | "scatter_correction"
  | "baseline"
  | "derivatives"
  | "smoothing"
  | "normalization"
  | "wavelets"
  | "signal_conversion"
  // Data handling
  | "splitting"
  | "augmentation"
  | "feature_selection"
  // Models
  | "model"
  | "model_pls"
  | "model_ensemble"
  | "model_dl"
  // Target processing
  | "y_processing"
  // Visualization
  | "charts"
  // Control flow
  | "branch"
  | "choice"
  | "merge";

/**
 * Generator configuration for creating multiple pipeline variants.
 * These map directly to nirs4all generator keywords.
 */
export interface GeneratorConfig {
  /** Choose one of multiple alternatives */
  _or_?: unknown[];
  /** Linear numeric range: [start, end, step?] */
  _range_?: [number, number, number?];
  /** Logarithmic range: [start, end, num_steps?] */
  _log_range_?: [number, number, number?];
  /** Grid search over multiple parameters */
  _grid_?: Record<string, unknown[]>;
  /** Parallel zip of multiple parameters */
  _zip_?: Record<string, unknown[]>;
  /** Parameter name that the generator applies to */
  param?: string;
  /** Number of items to select (combinations) */
  pick?: number;
  /** Number of items to select (permutations) */
  arrange?: number;
  /** Limit total number of variants */
  count?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

export interface PipelineStep {
  id: string;
  type: PipelineStepType;
  name: string;
  displayName?: string;
  params: Record<string, unknown>;
  enabled?: boolean;
  /** Generator configuration for creating variants */
  generator?: GeneratorConfig;
  /** Child steps for branch/choice nodes */
  children?: PipelineStep[];
  /** Parent step ID for nested steps */
  parentId?: string;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  category: PipelineCategory;
  steps: PipelineStep[];
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  runCount?: number;
  lastRunStatus?: PipelineRunStatus;
  lastRunDate?: string;
  taskType?: "regression" | "classification";
}

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  category: string;
  taskType: "regression" | "classification";
  steps: Omit<PipelineStep, "id">[];
  icon?: string;
  recommended?: boolean;
}

export interface PipelineOperator {
  name: string;
  displayName: string;
  description: string;
  params: Record<string, OperatorParam>;
  category?: string;
  source?: "nirs4all" | "sklearn";
}

export interface OperatorParam {
  type: "int" | "float" | "str" | "bool" | "array" | "object";
  default?: unknown;
  min?: number;
  max?: number;
  options?: string[];
  required?: boolean;
}

export interface PipelineOperators {
  preprocessing: PipelineOperator[];
  splitting: PipelineOperator[];
  models: PipelineOperator[];
  metrics: PipelineOperator[];
  augmentation: PipelineOperator[];
  feature_selection: PipelineOperator[];
  charts?: PipelineOperator[];
}

/** Raw API response format from the backend */
export interface PipelineApiResponse {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps?: PipelineStep[];
  is_favorite?: boolean;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  run_count?: number;
  last_run_status?: string;
  last_run_date?: string;
  task_type?: string;
}

export interface PipelineListResponse {
  pipelines: PipelineApiResponse[];
}

export interface PipelinePresetsResponse {
  presets: PipelinePreset[];
  total: number;
}

export interface PipelineValidationResult {
  valid: boolean;
  steps: Array<{
    index: number;
    name: string;
    type: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
  errors: string[];
  warnings: string[];
}

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "lastModified" | "runCount" | "steps";
export type FilterTab = "all" | "favorites" | "user" | "preset" | "shared" | "history";
