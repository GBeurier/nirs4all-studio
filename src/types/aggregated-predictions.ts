/**
 * Types for chain summaries from the SQLite store.
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
  /** Merged fixed operator params + tuned best_params (richer than best_params alone). */
  variant_params?: Record<string, unknown> | null;
  // CV scores (averaged across folds)
  cv_val_score: number | null;
  cv_test_score: number | null;
  cv_train_score: number | null;
  cv_fold_count: number;
  cv_scores: Record<string, Record<string, number>> | null;
  score_maps?: unknown | null;
  cv_source_chain_id?: string | null;
  // Final/refit scores
  final_test_score: number | null;
  final_train_score: number | null;
  final_scores: unknown | null;
  // Repetition-aggregated refit scores (when dataset has an aggregate column)
  final_agg_test_score?: number | null;
  final_agg_train_score?: number | null;
  final_agg_scores?: unknown | null;
  synthetic_refit?: boolean;
  is_refit_only?: boolean;
  // Pipeline status from JOIN
  pipeline_status: string | null;
  // Artifact info (enriched from chains table)
  fold_artifacts: Record<string, string> | null;
  artifact_refs?: unknown[];
  artifactRefs?: unknown[];
  calibrated_result?: unknown;
  calibratedResult?: unknown;
  conformal_result?: unknown;
  conformalResult?: unknown;
  tuning_result?: unknown;
  tuningResult?: unknown;
  robustness_summary?: unknown;
  robustnessSummary?: unknown;
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

export type PredictionVector = number[];
export type PredictionMatrix = number[][];
export type PredictionArrayPayload = PredictionVector | PredictionMatrix;

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
  scores?: Record<string, unknown> | null;
  best_params?: Record<string, unknown> | null;
  branch_path?: unknown | null;
  source_index?: number | null;
  source_name?: string | null;
  target_index?: number | null;
  target_name?: string | null;
  result_metadata?: Record<string, unknown> | null;
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
  y_true: PredictionArrayPayload | null;
  y_pred: PredictionArrayPayload | null;
  y_proba: number[] | number[][] | null;
  sample_indices: number[] | null;
  weights: number[] | null;
  sample_metadata?: Record<string, unknown[]> | null;
  n_samples: number;
  branch_path?: unknown | null;
  source_index?: number | null;
  source_name?: string | null;
  target_index?: number | null;
  target_name?: string | null;
  result_metadata?: Record<string, unknown> | null;
}

export interface PredictionRobustnessReportRequest {
  robustness: {
    mode: "clean_frozen";
    scenarios: Array<{
      kind: string;
      severity?: number;
      distribution?: "normal" | "uniform" | null;
    }>;
    slice_by?: string[];
  };
  seed?: number | null;
  name?: string;
  robustness_id?: string | null;
}

export interface PredictionRobustnessReportResponse {
  robustness_id: string;
  prediction_id: string;
  run_id?: string | null;
  pipeline_id?: string | null;
  chain_id?: string | null;
  summary_artifact: unknown;
  report_fingerprint: string;
}

export interface PredictionRobustnessEvidenceRequirement {
  id: string;
  label: string;
  present: boolean;
  source?: string | null;
  detail?: string | null;
}

export interface PredictionRobustnessEvidenceResponse {
  prediction_id: string;
  run_id?: string | null;
  pipeline_id?: string | null;
  chain_id?: string | null;
  stored_prediction_scenarios: string[];
  spectral_scenarios: string[];
  can_compute_stored_prediction_report: boolean;
  can_compute_spectral_report: boolean;
  status: string;
  requirements: PredictionRobustnessEvidenceRequirement[];
  blockers: string[];
}

export type RobustnessReportExportFormat = "json" | "markdown" | "html";

/** Filters for querying chain summaries. */
export interface AggregatedPredictionFilters {
  run_id?: string;
  pipeline_id?: string;
  chain_id?: string;
  dataset_name?: string;
  model_class?: string;
  metric?: string;
}
