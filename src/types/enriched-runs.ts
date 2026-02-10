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
}

export interface EnrichedDatasetRun {
  dataset_name: string;
  best_avg_val_score: number | null;
  best_avg_test_score: number | null;
  metric: string | null;
  task_type: string | null;
  gain_from_previous_best: number | null;
  pipeline_count: number;
  top_5: TopChainResult[];
}

export interface TopChainResult {
  chain_id: string;
  model_name: string;
  model_class: string;
  preprocessings: string;
  avg_val_score: number | null;
  avg_test_score: number | null;
  fold_count: number;
  scores: {
    val: Record<string, number>;
    test: Record<string, number>;
  };
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
