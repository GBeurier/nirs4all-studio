/**
 * Types for chain summaries from DuckDB store.
 *
 * These types correspond to the backend endpoints in
 * /api/aggregated-predictions/ which read from the
 * v_chain_summary VIEW.
 */

/** One row from the v_chain_summary VIEW. */
export interface ChainSummary {
  run_id: string;
  pipeline_id: string;
  chain_id: string;
  model_name: string | null;
  model_class: string;
  preprocessings: string | null;
  branch_path: unknown | null;
  source_index: number | null;
  model_step_idx: number;
  metric: string | null;
  task_type: string | null;
  dataset_name: string | null;
  best_params: unknown | null;
  // CV scores (averaged across folds)
  cv_val_score: number | null;
  cv_test_score: number | null;
  cv_train_score: number | null;
  cv_fold_count: number;
  cv_scores: Record<string, Record<string, number>> | null;
  // Final/refit scores
  final_test_score: number | null;
  final_train_score: number | null;
  final_scores: unknown | null;
  // Pipeline status from JOIN
  pipeline_status: string | null;
}

/** @deprecated Use ChainSummary instead. */
export type AggregatedPrediction = ChainSummary;

/** Response from GET /api/aggregated-predictions */
export interface AggregatedPredictionsResponse {
  predictions: ChainSummary[];
  total: number;
  generated_at: string;
}

/** Response from GET /api/aggregated-predictions/top */
export interface TopAggregatedPredictionsResponse {
  predictions: ChainSummary[];
  total: number;
  metric: string;
  score_column: string;
  generated_at: string;
}

/** Individual prediction row for chain drill-down. */
export interface PartitionPrediction {
  prediction_id: string;
  pipeline_id: string;
  chain_id: string | null;
  dataset_name: string;
  model_name: string;
  model_class: string;
  fold_id: string;
  partition: string;
  val_score: number | null;
  test_score: number | null;
  train_score: number | null;
  metric: string;
  task_type: string;
  n_samples: number | null;
  n_features: number | null;
  preprocessings: string | null;
}

/** Pipeline metadata included in chain detail. */
export interface ChainPipelineInfo {
  pipeline_id: string;
  name: string | null;
  dataset_name: string | null;
  generator_choices: string | null;
  status: string | null;
  metric: string | null;
  best_val: number | null;
  best_test: number | null;
}

/** Response from GET /api/aggregated-predictions/chain/{chain_id} */
export interface ChainDetailResponse {
  chain_id: string;
  summary: ChainSummary | null;
  predictions: PartitionPrediction[];
  pipeline: ChainPipelineInfo | null;
}

/** Response from GET /api/aggregated-predictions/chain/{chain_id}/detail */
export interface ChainPartitionDetailResponse {
  chain_id: string;
  predictions: PartitionPrediction[];
  total: number;
  partition: string | null;
  fold_id: string | null;
}

/** Response from GET /api/aggregated-predictions/{prediction_id}/arrays */
export interface PredictionArraysResponse {
  prediction_id: string;
  y_true: number[] | null;
  y_pred: number[] | null;
  y_proba: number[] | null;
  sample_indices: number[] | null;
  weights: number[] | null;
  n_samples: number;
}

/** Filters for querying chain summaries. */
export interface AggregatedPredictionFilters {
  run_id?: string;
  pipeline_id?: string;
  chain_id?: string;
  dataset_name?: string;
  model_class?: string;
  metric?: string;
}
