/**
 * Run types for nirs4all webapp
 * Phase 8: Runs Management
 * Phase 2-5: Enhanced with templates, results, and robustness features
 */

export type RunStatus = "queued" | "running" | "completed" | "failed" | "paused" | "partial";

export type RunFormat = "v1" | "v2" | "parquet_derived";

export interface RunMetrics {
  r2: number;
  rmse: number;
  mae?: number;
  rpd?: number;
  nrmse?: number;
}

/**
 * Pipeline template information (v2 format).
 * Templates define the experiment recipe before expansion.
 */
export interface PipelineTemplate {
  id: string;
  name: string;
  file?: string;
  expansion_count: number;
  description?: string;
}

/**
 * Dataset metadata stored with runs (v2 format).
 * Contains full information for auto-discovery.
 */
export interface RunDatasetInfo {
  name: string;
  path?: string;
  hash?: string;
  task_type?: string;
  n_samples?: number;
  n_features?: number;
  y_columns?: string[];
  y_stats?: Record<string, { min: number; max: number; mean: number; std: number }>;
  wavelength_range?: [number, number];
  wavelength_unit?: string;
  version?: string;
  status?: "valid" | "missing" | "hash_mismatch" | "relocated" | "unknown";
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  model: string;
  preprocessing: string;
  split_strategy: string;
  status: RunStatus;
  progress: number;
  metrics?: RunMetrics;
  val_score?: number | null;
  test_score?: number | null;
  score?: number | null;
  score_metric?: string | null;
  has_refit?: boolean;             // Whether a refit (final) model exists
  is_final_model?: boolean;        // Whether this is the deployment-ready model
  refit_model_id?: string;         // ID of the refit model artifact
  config?: Record<string, unknown>;
  logs?: string[];
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  template_id?: string; // Which template this came from (v2)
  // Variant tracking (sweeps, branches, finetuning)
  estimated_variants?: number; // Number of pipeline variants to test
  tested_variants?: number; // Actual variants tested after completion
  has_generators?: boolean; // True if pipeline has sweeps/finetuning
  // Model count breakdown (folds × branches × variants)
  fold_count?: number; // Number of CV folds
  branch_count?: number; // Number of pipeline branches
  total_model_count?: number; // Total models: folds × branches × variants
  model_count_breakdown?: string; // Human-readable: "5 folds × 3 branches = 15 models"
  // Granular progress tracking
  current_fold?: number; // Current fold being trained (1-based)
  current_branch?: string; // Current branch name
  current_variant?: number; // Current variant index (1-based)
  fold_metrics?: Record<number, RunMetrics>; // Per-fold metrics
}

export interface DatasetRun {
  dataset_id: string;
  dataset_name: string;
  pipelines: PipelineRun[];
}

/**
 * Run configuration (v2 format).
 */
export interface RunConfig {
  cv_folds?: number;
  cv_strategy?: string;
  random_state?: number;
  test_size?: number;
}

/**
 * Run summary statistics (v2 format).
 */
export interface RunSummary {
  total_results?: number;
  completed_results?: number;
  failed_results?: number;
  best_result?: {
    dataset?: string;
    template?: string;
    pipeline_config?: string;
    score?: number;
    metric?: string;
  };
}

/**
 * Checkpoint for error recovery (Phase 5).
 */
export interface RunCheckpoint {
  result_id: string;
  completed_at: string;
}

/**
 * Run entity - represents a complete experiment session.
 * Supports both legacy (v1) and new (v2) formats.
 */
export interface Run {
  id: string;
  name: string;
  description?: string;
  status: RunStatus;
  format?: RunFormat;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration?: string;
  created_by?: string;

  // Legacy fields (v1)
  datasets: DatasetRun[];
  cv_folds?: number;
  total_pipelines?: number;
  completed_pipelines?: number;

  // New fields (v2)
  templates?: PipelineTemplate[];
  total_pipeline_configs?: number;
  datasets_info?: RunDatasetInfo[];
  config?: RunConfig;
  summary?: RunSummary;

  // Robustness fields (Phase 5)
  checkpoints?: RunCheckpoint[];
  resume_from?: string;

  // Discovery metadata
  manifest_path?: string;
  run_dir?: string;
  results_count?: number;
}

export interface RunProgress {
  run_id: string;
  overall_progress: number;
  current_dataset?: string;
  current_pipeline?: string;
  pipeline_progress?: number;
  estimated_remaining?: string;
}

export const runStatusConfig = {
  queued: {
    label: "Queued",
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    iconClass: "",
  },
  running: {
    label: "Running",
    color: "text-chart-2",
    bg: "bg-chart-2/10",
    iconClass: "animate-spin",
  },
  completed: {
    label: "Completed",
    color: "text-chart-1",
    bg: "bg-chart-1/10",
    iconClass: "",
  },
  failed: {
    label: "Failed",
    color: "text-destructive",
    bg: "bg-destructive/10",
    iconClass: "",
  },
  paused: {
    label: "Paused",
    color: "text-warning",
    bg: "bg-warning/10",
    iconClass: "",
  },
  partial: {
    label: "Partial",
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    iconClass: "",
  },
} as const;

// Experiment configuration for creating new runs
export interface ExperimentConfig {
  name: string;
  description?: string;
  dataset_ids: string[];
  pipeline_ids: string[];
  /** Inline pipeline from editor (for unsaved pipelines) */
  inline_pipeline?: {
    name: string;
    steps: unknown[];
  };
}

// API responses
export interface RunListResponse {
  runs: Run[];
  total: number;
}

export interface CreateRunRequest {
  config: ExperimentConfig;
}

export interface RunActionResponse {
  success: boolean;
  message: string;
  run_id?: string;
}

export interface RunStatsResponse {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  total_pipelines: number;
}

// ============================================================================
// Result Types (Phase 2-5)
// ============================================================================

/**
 * Result entity - represents one pipeline config × one dataset.
 * This is the granular level below runs.
 */
export interface Result {
  id: string;
  run_id?: string;
  template_id?: string;
  dataset: string;
  pipeline_config: string;
  pipeline_config_id: string;
  created_at?: string;
  schema_version?: string;
  generator_choices?: Array<Record<string, unknown>>;
  best_score?: number | null;
  best_model?: string;
  metric?: string;
  task_type?: string;
  n_samples?: number;
  n_features?: number;
  predictions_count?: number;
  artifact_count?: number;
  manifest_path?: string;
  // Refit scoring fields
  val_score?: number | null;       // CV validation score (best fold average)
  test_score?: number | null;      // Final score from refit model on test data
  has_refit?: boolean;             // Whether a refit model was produced
  refit_model_id?: string;         // ID of the refit (final) model artifact
}

export interface ResultListResponse {
  workspace_id: string;
  results: Result[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

// ============================================================================
// Discovered Dataset Types (Phase 2.2)
// ============================================================================

/**
 * Dataset discovered from run manifests with full metadata.
 */
export interface DiscoveredDatasetInfo {
  name: string;
  path: string;
  hash?: string;
  task_type?: string;
  n_samples?: number;
  n_features?: number;
  y_columns?: string[];
  y_stats?: Record<string, { min: number; max: number; mean: number; std: number }>;
  wavelength_range?: number[];
  wavelength_unit?: string;
  runs_count: number;
  versions_seen: string[];
  hashes_seen: string[];
  status: "valid" | "missing" | "hash_mismatch" | "relocated" | "unknown";
}

export interface DiscoveredDatasetsResponse {
  workspace_id: string;
  datasets: DiscoveredDatasetInfo[];
  total: number;
}

// ============================================================================
// State Machine Types (Phase 5.3)
// ============================================================================

/**
 * Valid state transitions for runs.
 */
export const VALID_RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "failed"],
  running: ["completed", "failed", "paused", "partial"],
  paused: ["running", "failed"],
  failed: ["queued"], // retry
  completed: [], // terminal
  partial: ["running", "failed"], // resume or fail
};

/**
 * Check if a state transition is valid.
 */
export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  return VALID_RUN_TRANSITIONS[from]?.includes(to) ?? false;
}
