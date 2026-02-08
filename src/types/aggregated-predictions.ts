/**
 * Types for aggregated predictions from DuckDB store.
 *
 * These types correspond to the backend endpoints in
 * /api/aggregated-predictions/ which read from the
 * v_aggregated_predictions VIEW.
 */

/** One row from the aggregated predictions VIEW. */
export interface AggregatedPrediction {
  run_id: string;
  pipeline_id: string;
  chain_id: string;
  model_name: string;
  model_class: string;
  preprocessings: string | null;
  branch_path: string | null;
  source_index: number | null;
  model_step_idx: number;
  metric: string;
  dataset_name: string;
  fold_count: number;
  partition_count: number;
  partitions: string[];
  min_val_score: number | null;
  max_val_score: number | null;
  avg_val_score: number | null;
  min_test_score: number | null;
  max_test_score: number | null;
  avg_test_score: number | null;
  min_train_score: number | null;
  max_train_score: number | null;
  avg_train_score: number | null;
  prediction_ids: string[];
  fold_ids: string[];
}

/** Response from GET /api/aggregated-predictions */
export interface AggregatedPredictionsResponse {
  predictions: AggregatedPrediction[];
  total: number;
  generated_at: string;
}

/** Response from GET /api/aggregated-predictions/top */
export interface TopAggregatedPredictionsResponse {
  predictions: AggregatedPrediction[];
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
  aggregated: AggregatedPrediction | null;
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

/** Filters for querying aggregated predictions. */
export interface AggregatedPredictionFilters {
  run_id?: string;
  pipeline_id?: string;
  chain_id?: string;
  dataset_name?: string;
  model_class?: string;
  metric?: string;
}
