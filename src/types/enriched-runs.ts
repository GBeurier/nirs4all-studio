/**
 * Enriched run types for the redesigned Runs page.
 * These types match the response from GET /workspaces/{id}/runs/enriched.
 */

export interface EnrichedRun {
  run_id: string;
  name: string;
  status: string;
  project_id: string | null;
  project_name?: string | null;
  created_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  artifact_size_bytes: number;
  datasets_count: number;
  pipeline_runs_count: number;
  final_models_count: number;
  total_models_trained: number;
  total_folds: number;
  datasets: EnrichedDatasetRun[];
  error?: string | null;
  config?: {
    cv_folds?: number;
    cv_strategy?: string;
    metric?: string;
    random_state?: number;
    splitter_class?: string;
    shuffle?: boolean;
    test_size?: number;
    group_by?: string;
    has_refit?: boolean;
    refit_pipeline_count?: number;
    n_pipelines?: number;
    n_datasets?: number;
  };
  model_classes?: Array<{ name: string; count: number }>;
}

export interface EnrichedDatasetRun {
  dataset_name: string;
  best_avg_val_score: number | null;
  best_avg_test_score: number | null;
  best_final_score: number | null;
  metric: string | null;
  task_type: string | null;
  gain_from_previous_best: number | null;
  pipeline_count: number;
  top_5: TopChainResult[];
  n_samples?: number | null;
  n_features?: number | null;
}

export interface TopChainResult {
  chain_id: string;
  run_id?: string;
  pipeline_id?: string;
  pipeline_name?: string | null;
  model_name: string;
  model_class: string;
  preprocessings: string;
  avg_val_score: number | null;
  avg_test_score: number | null;
  avg_train_score: number | null;
  fold_count: number;
  scores: {
    val: Record<string, number>;
    test: Record<string, number>;
  };
  cv_source_chain_id?: string | null;
  final_test_score: number | null;
  final_train_score: number | null;
  /** Can be flat `{rmse: 0.3}` or nested `{test: {rmse: 0.3}}` — use `extractScoreValue()` to read. */
  final_scores: Record<string, unknown>;
  final_agg_test_score?: number | null;
  final_agg_train_score?: number | null;
  final_agg_scores?: Record<string, unknown> | null;
  best_params?: Record<string, unknown> | null;
  variant_params?: Record<string, unknown> | null;
  is_refit_only?: boolean;
  synthetic_refit?: boolean;
}

export interface ScoreDistribution {
  dataset_name: string;
  metric: string | null;
  partitions: Record<string, {
    bins: number[];
    counts: number[];
    n_scores: number;
    min: number;
    max: number;
    mean: number;
  }>;
}

export interface EnrichedRunsResponse {
  runs: EnrichedRun[];
  total: number;
}

/** Response from GET /workspaces/{id}/runs/{run_id}/datasets/{name}/chains */
export interface AllChainsResponse {
  chains: AllChainEntry[];
  total: number;
  metric: string | null;
}

/** One chain entry in the all-chains response. */
export interface AllChainEntry {
  chain_id: string;
  run_id?: string;
  pipeline_id?: string;
  pipeline_name?: string | null;
  model_name: string;
  model_class: string;
  preprocessings: string;
  best_params: Record<string, unknown> | null;
  variant_params?: Record<string, unknown> | null;
  cv_val_score: number | null;
  cv_test_score: number | null;
  cv_train_score: number | null;
  cv_fold_count: number;
  cv_scores: Record<string, Record<string, number>> | null;
  cv_source_chain_id?: string | null;
  final_test_score: number | null;
  final_train_score: number | null;
  final_scores: Record<string, number> | null;
  final_agg_test_score?: number | null;
  final_agg_train_score?: number | null;
  final_agg_scores?: Record<string, unknown> | null;
  metric: string | null;
  task_type: string | null;
  is_refit_only?: boolean;
  synthetic_refit?: boolean;
}

export interface WorkspaceRunDatasetDetail {
  name: string;
  aggregate?: string | null;
  aggregate_method?: string | null;
  aggregate_exclude_outliers?: boolean;
  repetition?: string | null;
  linked_dataset_id?: string | null;
}

export interface WorkspaceRunPipelineDetail {
  pipeline_id: string;
  run_id: string;
  name: string;
  dataset_name: string | null;
  dataset_hash?: string | null;
  status: string | null;
  created_at: string;
  completed_at: string | null;
  best_val: number | null;
  best_test: number | null;
  metric: string | null;
  duration_ms: number | null;
  error?: string | null;
  expanded_config?: unknown;
  generator_choices?: unknown;
  is_refit_pipeline?: boolean;
  splitter_class?: string | null;
  log_count?: number;
  total_duration_ms?: number | null;
  warning_count?: number;
  error_count?: number;
}

export interface WorkspaceRunLogSummary {
  pipeline_id: string;
  pipeline_name: string | null;
  pipeline_status: string | null;
  log_count: number;
  total_duration_ms: number | null;
  warning_count: number;
  error_count: number;
}

export interface WorkspaceRunPipelineLogEntry {
  log_id: string;
  step_idx: number | null;
  operator_class: string | null;
  event: string | null;
  duration_ms: number | null;
  message: string | null;
  details?: Record<string, unknown> | string | null;
  level: string | null;
  created_at: string | null;
}

export interface WorkspaceRunDetail {
  run_id: string;
  name: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  config?: Record<string, unknown> | null;
  datasets: WorkspaceRunDatasetDetail[];
  pipelines: WorkspaceRunPipelineDetail[];
  summary?: Record<string, unknown> | null;
  error?: string | null;
  project_id?: string | null;
  log_summary?: WorkspaceRunLogSummary[];
  rerun_ready?: boolean;
  unresolved_dataset_names?: string[];
  results_count?: number;
}

export interface WorkspaceRunPipelineLogsResponse {
  pipeline_id: string;
  pipeline_name?: string | null;
  logs: WorkspaceRunPipelineLogEntry[];
}

export interface WorkspaceRunRerunResponse {
  success: boolean;
  source_run_id: string;
  run: import("./runs").Run;
  cloned_pipelines: Array<{
    id: string;
    name: string;
    source_pipeline_id?: string | null;
    source_pipeline_name?: string | null;
  }>;
}
