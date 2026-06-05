/**
 * Aggregated predictions (workspace store) API client functions.
 */

import { api } from "./http";

// =============================================================================
// Aggregated Predictions (workspace store)
// =============================================================================

import type {
  AggregatedPredictionsResponse,
  TopAggregatedPredictionsResponse,
  ChainDetailResponse,
  ChainPartitionDetailResponse,
  PredictionArraysResponse,
  AggregatedPredictionFilters,
} from "@/types/aggregated-predictions";

/**
 * Query aggregated predictions from the workspace store.
 * Returns one row per (chain_id, metric, dataset_name).
 */
export async function getAggregatedPredictions(
  filters?: AggregatedPredictionFilters
): Promise<AggregatedPredictionsResponse> {
  const params = new URLSearchParams();
  if (filters?.run_id) params.set("run_id", filters.run_id);
  if (filters?.pipeline_id) params.set("pipeline_id", filters.pipeline_id);
  if (filters?.chain_id) params.set("chain_id", filters.chain_id);
  if (filters?.dataset_name) params.set("dataset_name", filters.dataset_name);
  if (filters?.model_class) params.set("model_class", filters.model_class);
  if (filters?.metric) params.set("metric", filters.metric);
  const query = params.toString();
  return api.get(`/aggregated-predictions${query ? `?${query}` : ""}`);
}

/**
 * Get top-N aggregated predictions ranked by metric score.
 * Sort direction is auto-detected from the metric name.
 */
export async function getTopAggregatedPredictions(
  metric: string,
  options?: {
    n?: number;
    score_column?: string;
    run_id?: string;
    pipeline_id?: string;
    dataset_name?: string;
    model_class?: string;
  }
): Promise<TopAggregatedPredictionsResponse> {
  const params = new URLSearchParams({ metric });
  if (options?.n) params.set("n", String(options.n));
  if (options?.score_column) params.set("score_column", options.score_column);
  if (options?.run_id) params.set("run_id", options.run_id);
  if (options?.pipeline_id) params.set("pipeline_id", options.pipeline_id);
  if (options?.dataset_name) params.set("dataset_name", options.dataset_name);
  if (options?.model_class) params.set("model_class", options.model_class);
  return api.get(`/aggregated-predictions/top?${params.toString()}`);
}

/**
 * Get chain detail — aggregated summary + individual prediction rows.
 */
export async function getChainDetail(
  chainId: string,
  options?: { metric?: string; dataset_name?: string }
): Promise<ChainDetailResponse> {
  const params = new URLSearchParams();
  if (options?.metric) params.set("metric", options.metric);
  if (options?.dataset_name) params.set("dataset_name", options.dataset_name);
  const query = params.toString();
  return api.get(
    `/aggregated-predictions/chain/${chainId}${query ? `?${query}` : ""}`
  );
}

/**
 * Get partition-level prediction rows for a chain.
 */
export async function getChainPartitionDetail(
  chainId: string,
  options?: { partition?: string; fold_id?: string }
): Promise<ChainPartitionDetailResponse> {
  const params = new URLSearchParams();
  if (options?.partition) params.set("partition", options.partition);
  if (options?.fold_id) params.set("fold_id", options.fold_id);
  const query = params.toString();
  return api.get(
    `/aggregated-predictions/chain/${chainId}/detail${query ? `?${query}` : ""}`
  );
}

/**
 * Get prediction arrays (y_true, y_pred, etc.) for a single prediction.
 */
export async function getPredictionArrays(
  predictionId: string
): Promise<PredictionArraysResponse> {
  return api.get(`/aggregated-predictions/${predictionId}/arrays`);
}
