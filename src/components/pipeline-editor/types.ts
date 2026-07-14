/**
 * Pipeline Editor Types
 * Tree-based pipeline structure with support for nested branches and generators
 *
 * Aligned with nirs4all library capabilities:
 * - 30+ preprocessing operators including NIRS-specific transforms
 * - Advanced PLS variants (OPLS, PLSDA, SparsePLS, etc.)
 * - Hyperparameter optimization via Optuna (finetuning)
 * - Parameter sweeps for exhaustive grid search
 * - Multi-source data support
 * - Target (y) processing
 */

/**
 * Consolidated step types (8 total, aligned with NodeType).
 */
export type StepType =
  | "preprocessing"
  | "y_processing"        // Target variable scaling/processing
  | "splitting"
  | "model"
  | "augmentation"        // Sample augmentation operators (training-time)
  | "filter"              // Sample filtering operators (outliers, conditions)
  | "flow"                // Pipeline flow control (branch, merge, containers, generators)
  | "utility";            // Non-executing / visualization (charts, comments)

/**
 * Sub-types for flow steps that preserve rendering distinctions.
 * These map to the legacy type values so the pipeline editor can still
 * distinguish branches from merges from containers, etc.
 */
export type FlowStepSubType =
  | "branch"
  | "merge"
  | "generator"
  | "sample_augmentation"
  | "feature_augmentation"
  | "sample_filter"
  | "concat_transform"
  | "sequential";

/**
 * Sub-types for utility steps.
 */
export type UtilityStepSubType =
  | "chart"
  | "comment";

/**
 * Combined sub-type union (for PipelineStep.subType).
 */
export type StepSubType = FlowStepSubType | UtilityStepSubType;
export type PipelineParams = Record<string, unknown>;
export type FilterOriginKeyword = "sample_filter" | "exclude" | "tag";
export type BranchMode = "duplication" | "separation";
export type SeparationKind = "by_tag" | "by_metadata" | "by_filter" | "by_source";

/**
 * Legacy step type values (for backwards compatibility with old pipelines).
 * This includes all 16 old type values that may appear in stored pipelines.
 */
export type LegacyStepType =
  | StepType
  | "branch"
  | "merge"
  | "generator"
  | "sample_augmentation"
  | "feature_augmentation"
  | "sample_filter"
  | "concat_transform"
  | "sequential"
  | "chart"
  | "comment";

// Generator types for step-level generators
export type GeneratorKind = "or" | "cartesian" | "grid" | "zip" | "chain" | "sample" | "range" | "log_range";

// Parameter sweep types for parameter-level generators
export type SweepType = "range" | "log_range" | "grid" | "or";

// Parameter sweep configuration
export interface ParameterSweep {
  type: SweepType;
  // For range/log_range
  from?: number;
  to?: number;
  step?: number;
  count?: number; // For log_range or limiting
  // For or (discrete choices)
  choices?: (string | number | boolean)[];
  // For grid (multiple params - used at step level)
  gridParams?: Record<string, (string | number | boolean)[]>;
}

// Finetuning parameter search space types
export type FinetuneParamType = "int" | "float" | "categorical" | "log_float";

// Individual parameter search space for Optuna
export interface FinetuneParamConfig {
  name: string;
  type: FinetuneParamType;
  low?: number;           // For int, float, log_float
  high?: number;          // For int, float, log_float
  step?: number;          // Optional step for int
  choices?: (string | number)[];  // For categorical
  rawValue?: unknown;     // Preserve original canonical search-space shape
}

// Refit configuration for model steps
export interface RefitConfig {
  enabled: boolean;                              // Whether to refit best model on full training data
  refit_params?: Record<string, unknown>;        // Override parameters for the refit model (e.g., epochs, patience)
}

// Optuna finetuning configuration
export interface FinetuneConfig {
  enabled: boolean;
  n_trials: number;
  timeout?: number;       // Max optimization time in seconds
  approach: "grouped" | "individual" | "single" | "cross";  // Shared across folds vs per-fold
  eval_mode: "best" | "mean";          // Score evaluation mode
  sample?: "grid" | "random" | "hyperband"; // Sampling strategy
  verbose?: number;       // Verbosity level
  storage?: string;        // Optuna storage URI for persistent optimizer state
  study_name?: string;     // Optuna study name for persistent optimizer state
  model_params: FinetuneParamConfig[];
  // Training params to be tuned (ranges): e.g., batch_size from 16 to 256
  train_params?: FinetuneParamConfig[];
  // Fixed training params for each trial (quick training): e.g., 50 epochs
  trial_train_params?: Record<string, number>;
}

// Step-level training parameters (defaults, not tunable)
export interface TrainParams {
  epochs?: number;
  batch_size?: number;
  learning_rate?: number;
  patience?: number;
  verbose?: number;
  optimizer?: string;
  [key: string]: unknown;  // Allow arbitrary params
}

// Step-level metadata that sits at the step level in nirs4all (not inside model/preprocessing)
export interface StepMetadata {
  customName?: string;           // Maps to "name" in nirs4all step
  trainParams?: TrainParams;     // Maps to "train_params" at step level
  action?: "extend" | "add" | "replace";  // For augmentation steps
}

// Step-level generator (e.g., _range_ on a model step)
export interface StepGenerator {
  type: "_range_" | "_log_range_" | "_grid_" | "_or_";
  values?: number[] | unknown[];  // For _range_: [start, end, step], for _or_: alternatives
  param?: string;                 // Which param the generator affects (for _range_/_log_range_)
  pick?: number | [number, number];
  arrange?: number | [number, number];
  count?: number;
}

// Training parameters for deep learning models (legacy - prefer stepMetadata.trainParams)
export interface TrainingConfig {
  epochs: number;
  batch_size: number;
  learning_rate?: number;
  patience?: number;      // Early stopping patience
  optimizer?: "adam" | "sgd" | "rmsprop" | "adamw";
  callbacks?: string[];   // Training callbacks
  verbose?: number;       // Verbosity level
}

// Container step types that have nested children.
// With consolidated types, all containers are "flow" type. Use subType to distinguish.
export const CONTAINER_STEP_TYPES: StepType[] = [
  "flow",
];

/**
 * Flow sub-types that use children (not branches).
 */
export const CONTAINER_CHILDREN_SUBTYPES: FlowStepSubType[] = [
  "sample_augmentation",
  "feature_augmentation",
  "sample_filter",
  "concat_transform",
  "sequential",
];

/**
 * Flow sub-types that use branches.
 */
export const CONTAINER_BRANCH_SUBTYPES: FlowStepSubType[] = [
  "branch",
  "generator",
];

// Concat transform configuration
export interface ConcatTransformConfig {
  branches: TransformerConfig[][];  // Each branch is a chain of transforms
}

// Transformer within augmentation/filter configs
export interface TransformerConfig {
  id: string;
  name: string;
  classPath?: string;     // Full class path for nirs4all
  params: PipelineParams;
  enabled?: boolean;
}

// Merge step configuration (complex merge with predictions selection)
export interface MergeConfig {
  mode?: string;          // Simple mode: "predictions", "features", "concatenate"
  predictions?: MergePredictionSource[];
  features?: number[];    // Branch indices to include features from
  sources?: unknown;      // Source merge payload: "concat" | "stack" | {...}
  output_as?: "features" | "predictions";
  on_missing?: "warn" | "error" | "drop";
}

// Merge prediction source configuration
export interface MergePredictionSource {
  branch: number;
  select: "best" | "all" | { top_k: number };
  metric?: "rmse" | "r2" | "mae";
}

// Chart step configuration
export interface ChartConfig {
  chartType: "chart_2d" | "chart_y";
  include_excluded?: boolean;
  highlight_excluded?: boolean;
  [key: string]: unknown;
}

export interface BranchMetadata {
  name?: string;
  value?: unknown;
  isCollapsed?: boolean;
}

export interface SeparationBranchConfig {
  kind: SeparationKind;
  key?: string;
  filter?: unknown;
  sharedSteps?: boolean;
}

export interface ScalarGeneratorEntry {
  id: string;
  key: string;
  values: unknown[];
}

export interface ScalarGeneratorConfig {
  entries?: ScalarGeneratorEntry[];
  sample?: Record<string, unknown>;
}

export interface PipelineStep {
  id: string;
  type: StepType;
  /** Sub-type for flow/utility steps (preserves legacy type for rendering) */
  subType?: StepSubType;
  name: string;
  params: PipelineParams;
  // Full class path (for export to nirs4all)
  classPath?: string;
  // Optional framework hint for function-based operators
  framework?: string;
  // Parameter sweeps: which params have generators attached
  paramSweeps?: Record<string, ParameterSweep>;
  // For branching steps: list of parallel pipelines (branch, generator)
  branches?: PipelineStep[][];
  // Named branches support (for dict-style branches like {"snv_path": [...], "msc_path": [...]})
  namedBranches?: Record<string, PipelineStep[]>;
  // Branch metadata (names, collapsed state)
  branchMetadata?: BranchMetadata[];
  // For container steps: nested children (sample_augmentation, feature_augmentation, etc.)
  children?: PipelineStep[];
  // For generator steps (OR, Cartesian): child steps/options
  generatorKind?: GeneratorKind;
  generatorOptions?: {
    pick?: number | [number, number]; // Combinations
    arrange?: number | [number, number]; // Permutations
    then_pick?: number | [number, number]; // Second-order combinations
    then_arrange?: number | [number, number]; // Second-order permutations
    count?: number; // Limit variants
  };
  // Step-level generator (e.g., _range_ on a model step)
  stepGenerator?: StepGenerator;
  // Step-level metadata (name, train_params, action)
  stepMetadata?: StepMetadata;
  // Finetuning configuration (for model steps)
  finetuneConfig?: FinetuneConfig;
  // Refit configuration (for model steps)
  refitConfig?: RefitConfig;
  // Training configuration (for deep learning models) - legacy, prefer stepMetadata.trainParams
  trainingConfig?: TrainingConfig;
  // Y-Processing configuration (for pipeline-level target scaling)
  yProcessingConfig?: {
    enabled: boolean;
    scaler: string;
    params: PipelineParams;
  };
  // Concat transform configuration
  concatTransformConfig?: ConcatTransformConfig;
  // Merge configuration (complex merge with predictions)
  mergeConfig?: MergeConfig;
  // Chart configuration
  chartConfig?: ChartConfig;
  // Stacking/MetaModel configuration (for merge steps) - legacy
  stackingConfig?: {
    enabled: boolean;
    metaModel: string;
    metaModelParams: PipelineParams;
    sourceModels: string[];
    coverageStrategy: "drop" | "fill" | "model";
    fillValue?: number;
    useOriginalFeatures: boolean;
    passthrough: boolean;
  };
  // Preserve the canonical filter wrapper keyword on import/export.
  filterOrigin?: FilterOriginKeyword;
  // Distinguish editable duplication branches from passthrough separation branches.
  branchMode?: BranchMode;
  // Editable metadata for separation branch routing.
  separationConfig?: SeparationBranchConfig;
  // Dedicated UI model for scalar/root-level generators (_grid_, _zip_, _sample_).
  scalarGeneratorConfig?: ScalarGeneratorConfig;
  // UI-only explicit no-op generator alternative that exports back to null.
  isNoOp?: boolean;
  // For function-based operators (e.g., nicon)
  functionPath?: string;
  // Step enabled/disabled state
  enabled?: boolean;
  // Custom step name for reference in MetaModel (legacy, prefer stepMetadata.customName)
  customName?: string;
  // Tags for categorization
  tags?: string[];
  // Raw nirs4all step for unsupported complex structures
  rawNirs4all?: unknown;
  // Params injected for editor hydration so missing defaults remain visible.
  hydratedDefaultParams?: string[];
  // Index signature for API compatibility
  [key: string]: unknown;
}

export interface StepOption {
  name: string;
  description: string;
  defaultParams: PipelineParams;
  defaultBranches?: PipelineStep[][];
  generatorKind?: GeneratorKind;
  classPath?: string;
  functionPath?: string;
  framework?: string;
  category?: string;        // Subcategory for palette organization
  isDeepLearning?: boolean; // Flag for DL models (show training config)
  isAdvanced?: boolean;     // Flag for advanced/expert options
  tags?: string[];          // Searchable tags
  tier?: "core" | "standard" | "advanced"; // Visibility tier for filtering
}

export interface StepCategory {
  type: StepType;
  label: string;
  options: StepOption[];
}

export interface SavedPipeline {
  id: string;
  name: string;
  description?: string;
  steps: PipelineStep[];
  category: "user" | "preset" | "shared";
  isFavorite: boolean;
  tags: string[];
  created_at: string;
  last_modified: string;
  run_count?: number;
  last_run_status?: "success" | "failed" | "running";
}

// DnD Types
export type DragItemType = "palette-item" | "pipeline-step";

export interface DragData {
  type: DragItemType;
  stepType?: StepType;
  option?: StepOption;
  stepId?: string;
  step?: PipelineStep;
  sourcePath?: string[]; // Path to the step in the tree (for nested branches)
}

export interface DropIndicator {
  path: string[]; // Path to the parent container
  index: number; // Insert position
  position: "before" | "after" | "inside"; // Where relative to the target
}

export {
  calculateCartesianStageVariants,
  calculateGeneratorExpansionCount,
  calculatePipelineVariants,
  calculateStepVariants,
  calculateSweepVariants,
} from "./variantCounting";
export { stepOptions } from "./stepOptions";
export {
  getStepColor,
  stepColors,
  stepSubTypeColors,
  stepSubTypeLabels,
  stepTypeLabels,
} from "./stepPresentation";

export {
  cloneStep,
  createStepFromOption,
  formatSweepDisplay,
  generateStepId,
  inferGeneratorKind,
  migrateStep,
} from "./stepFactory";
