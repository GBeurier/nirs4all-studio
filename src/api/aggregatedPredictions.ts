/**
 * Aggregated predictions API client — queries against the SQLite aggregated
 * predictions store, chain/run reload payloads, prediction arrays, parquet
 * export, and read-only SQL.
 */

import { api, requestBinary } from "./transport";
import type {
  AggregatedPredictionsResponse,
  TopAggregatedPredictionsResponse,
  ChainDetailResponse,
  ChainPartitionDetailResponse,
  PredictionArraysResponse,
  PredictionRobustnessEvidenceResponse,
  PredictionRobustnessReportRequest,
  PredictionRobustnessReportResponse,
  RobustnessReportExportFormat,
  AggregatedPredictionFilters,
} from "@/types/aggregated-predictions";

/**
 * Query aggregated predictions from the SQLite store.
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
 * Metadata describing how a chain snapshot was reconstructed for reload.
 */
export interface ChainPipelineReloadMetadata {
  source: "chain_snapshot";
  selection_scope: "preprocessing_chain_plus_selected_model";
  is_editable_template: boolean;
}

/**
 * Response for reloading a stored chain snapshot into the editor.
 */
export interface ChainPipelineStepsResponse {
  chain_id: string;
  name: string;
  pipeline: unknown[];
  reload: ChainPipelineReloadMetadata;
}

/**
 * Get nirs4all-canonical steps for a chain snapshot (preprocessing + selected model).
 */
export async function getChainPipelineSteps(
  chainId: string
): Promise<ChainPipelineStepsResponse> {
  return api.get(`/aggregated-predictions/chain/${chainId}/pipeline-steps`);
}

/**
 * Metadata describing how a run pipeline was reconstructed for reload.
 */
export interface RunPipelineReloadMetadata {
  source: "authoring_template" | "expanded_snapshot";
  is_editable_template: boolean;
  is_legacy_fallback: boolean;
}

/**
 * Response for reloading a stored run pipeline into the editor.
 */
export interface RunPipelineStepsResponse {
  pipeline_id: string;
  name: string;
  pipeline: unknown[];
  reload: RunPipelineReloadMetadata;
}

/**
 * Get the stored run reload payload for a pipeline.
 */
export async function getRunPipelineSteps(
  pipelineId: string
): Promise<RunPipelineStepsResponse> {
  return api.get(`/aggregated-predictions/pipeline/${pipelineId}/pipeline-steps`);
}

/**
 * Get prediction arrays (y_true, y_pred, etc.) for a single prediction.
 */
export async function getPredictionArrays(
  predictionId: string
): Promise<PredictionArraysResponse> {
  return api.get(`/aggregated-predictions/${predictionId}/arrays`);
}

/**
 * Compute and persist a native audit-only robustness report for one stored prediction.
 */
export async function computePredictionRobustnessReport(
  predictionId: string,
  request: PredictionRobustnessReportRequest,
): Promise<PredictionRobustnessReportResponse> {
  return api.post(`/aggregated-predictions/${predictionId}/robustness-report`, request);
}

/**
 * Inspect fail-closed evidence for robustness paths available from one stored prediction.
 */
export async function getPredictionRobustnessEvidence(
  predictionId: string,
): Promise<PredictionRobustnessEvidenceResponse> {
  return api.get(`/aggregated-predictions/${predictionId}/robustness-evidence`);
}

/**
 * Export a persisted native robustness report without recomputing it.
 */
export async function exportWorkspaceRobustnessReport(
  robustnessId: string,
  format: RobustnessReportExportFormat = "json",
): Promise<Blob> {
  const params = new URLSearchParams({ format });
  return requestBinary(
    `/aggregated-predictions/robustness-reports/${encodeURIComponent(robustnessId)}/export?${params.toString()}`,
    "GET",
  );
}

/**
 * Download portable parquet for one dataset.
 */
export async function downloadAggregatedDatasetParquet(
  datasetName: string,
  options?: { partition?: string; model_name?: string }
): Promise<Blob> {
  const params = new URLSearchParams();
  if (options?.partition) params.set("partition", options.partition);
  if (options?.model_name) params.set("model_name", options.model_name);
  const query = params.toString();
  return requestBinary(
    `/aggregated-predictions/export/${encodeURIComponent(datasetName)}.parquet${query ? `?${query}` : ""}`,
    "GET"
  );
}

/**
 * Bulk export dataset parquet files as zip (or single parquet).
 */
export async function exportAggregatedPredictions(options: {
  dataset_names?: string[];
  format: "parquet" | "zip";
}): Promise<Blob> {
  return requestBinary("/aggregated-predictions/export", "POST", options);
}

export interface AggregatedSQLQueryResponse {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

/**
 * Run read-only SQL query against aggregated predictions metadata.
 */
export async function runAggregatedPredictionsQuery(
  sql: string
): Promise<AggregatedSQLQueryResponse> {
  return api.post("/aggregated-predictions/query", { sql });
}
