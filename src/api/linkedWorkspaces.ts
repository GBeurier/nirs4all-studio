/**
 * Linked nirs4all workspaces API client — managing linked workspaces and the
 * runs, results, datasets, predictions, exports, and templates discovered
 * inside them.
 */

import { api } from "./transport";
import type {
  WorkspaceRunDetail,
  WorkspaceRunPipelineLogsResponse,
  WorkspaceRunRerunResponse,
} from "@/types/enriched-runs";
import type {
  LinkedWorkspace,
  LinkedWorkspaceCreateRequest,
  LinkedWorkspaceListResponse,
  LinkedWorkspaceScanResult,
  LinkedWorkspaceDiscoveredRuns,
  LinkedWorkspaceDiscoveredPredictions,
  LinkedWorkspaceDiscoveredExports,
  LinkedWorkspaceDiscoveredTemplates,
  PredictionDataResponse,
  PredictionSummaryResponse,
} from "@/types/linked-workspaces";

/**
 * Get list of linked nirs4all workspaces
 */
export async function getLinkedWorkspaces(): Promise<LinkedWorkspaceListResponse> {
  return api.get("/workspaces");
}

/**
 * Link a nirs4all workspace
 */
export async function linkN4AWorkspace(
  request: LinkedWorkspaceCreateRequest
): Promise<{ success: boolean; workspace: LinkedWorkspace; message: string }> {
  return api.post("/workspaces/link", request);
}

/**
 * Unlink a nirs4all workspace (does not delete files)
 */
export async function unlinkN4AWorkspace(
  workspaceId: string
): Promise<{ success: boolean; message: string }> {
  return api.delete(`/workspaces/${workspaceId}`);
}

/**
 * Set a workspace as the active workspace
 */
export async function activateN4AWorkspace(
  workspaceId: string
): Promise<{ success: boolean; workspace: LinkedWorkspace; message: string }> {
  return api.post(`/workspaces/${workspaceId}/activate`);
}

/**
 * Trigger a scan of a linked workspace
 */
export async function scanN4AWorkspace(
  workspaceId: string
): Promise<LinkedWorkspaceScanResult> {
  return api.post(`/workspaces/${workspaceId}/scan`);
}

/**
 * Get discovered runs for a workspace
 */
export async function getN4AWorkspaceRuns(
  workspaceId: string,
  options?: {
    source?: "unified" | "manifests" | "parquet";
  }
): Promise<LinkedWorkspaceDiscoveredRuns> {
  const params = new URLSearchParams();
  if (options?.source) params.set("source", options.source);
  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/runs${query ? `?${query}` : ""}`);
}

/**
 * Get detailed information about a specific run.
 * Returns full run info including templates, datasets, config, and results.
 */
export async function getN4AWorkspaceRunDetail(
  workspaceId: string,
  runId: string
): Promise<WorkspaceRunDetail> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}`);
}

export async function getWorkspaceRunPipelineLogs(
  workspaceId: string,
  runId: string,
  pipelineId: string
): Promise<WorkspaceRunPipelineLogsResponse> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}/pipelines/${pipelineId}/logs`);
}

export async function rerunWorkspaceRun(
  workspaceId: string,
  runId: string
): Promise<WorkspaceRunRerunResponse> {
  return api.post(`/workspaces/${workspaceId}/runs/${runId}/rerun`);
}

export async function deleteN4AWorkspaceRun(
  workspaceId: string,
  runId: string
): Promise<{ success: boolean; deleted_rows: number; run_id: string }> {
  return api.delete(`/workspaces/${workspaceId}/runs/${runId}`);
}

export interface WorkspaceResultRow {
  id: string;
  run_id?: string;
  template_id?: string;
  dataset: string;
  pipeline_config: string;
  pipeline_config_id: string;
  created_at?: string;
  best_score?: number | null;
  best_model?: string;
  metric?: string;
  predictions_count?: number;
  artifact_count?: number;
  manifest_path?: string;
  val_score?: number | null;
  test_score?: number | null;
  has_refit?: boolean;
  refit_model_id?: string;
}

export interface WorkspaceResultsResponse {
  workspace_id: string;
  results: WorkspaceResultRow[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/**
 * Get individual results (pipeline config × dataset combinations).
 * Results represent the granular level below runs.
 */
export async function getN4AWorkspaceResults(
  workspaceId: string,
  options?: {
    run_id?: string;
    dataset?: string;
    template_id?: string;
    limit?: number;
    offset?: number;
  }
): Promise<WorkspaceResultsResponse> {
  const params = new URLSearchParams();
  if (options?.run_id) params.set("run_id", options.run_id);
  if (options?.dataset) params.set("dataset", options.dataset);
  if (options?.template_id) params.set("template_id", options.template_id);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/results${query ? `?${query}` : ""}`);
}

/**
 * Get results summary: top 5 models per dataset across all runs,
 * with final (refit) scores.
 */
export async function getWorkspaceResultsSummary(
  workspaceId: string,
): Promise<import("@/types/runs").ResultsSummaryResponse> {
  return api.get(`/workspaces/${workspaceId}/results/summary`);
}

export interface WorkspaceDiscoveredDataset {
  name: string;
  path: string;
  hash?: string;
  task_type?: string;
  n_samples?: number;
  n_features?: number;
  runs_count: number;
  versions_seen: string[];
  hashes_seen: string[];
  status: "valid" | "missing" | "hash_mismatch" | "relocated" | "unknown";
}

export interface WorkspaceDiscoveredDatasetsResponse {
  workspace_id: string;
  datasets: WorkspaceDiscoveredDataset[];
  total: number;
}

/**
 * Get datasets discovered from run manifests.
 * Includes full metadata like n_samples, y_stats, and path status.
 */
export async function getN4AWorkspaceDiscoveredDatasets(
  workspaceId: string
): Promise<WorkspaceDiscoveredDatasetsResponse> {
  return api.get(`/workspaces/${workspaceId}/datasets/discovered`);
}

/**
 * Get discovered predictions for a workspace
 */
export async function getN4AWorkspacePredictions(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredPredictions> {
  return api.get(`/workspaces/${workspaceId}/predictions`);
}

/**
 * Get prediction records data from parquet files.
 * Reads the actual prediction metadata (without heavy arrays).
 */
export async function getN4AWorkspacePredictionsData(
  workspaceId: string,
  options?: {
    limit?: number;
    offset?: number;
    dataset?: string;
  }
): Promise<PredictionDataResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.dataset) params.set("dataset", options.dataset);

  const query = params.toString();
  return api.get(`/workspaces/${workspaceId}/predictions/data${query ? `?${query}` : ""}`);
}

export async function deleteWorkspacePrediction(
  workspaceId: string,
  predictionId: string
): Promise<import("@/types/storage").PredictionDeletionReport> {
  return api.delete(`/workspaces/${workspaceId}/predictions/${encodeURIComponent(predictionId)}`);
}

export async function deleteWorkspacePredictionGroup(
  workspaceId: string,
  chainId: string,
  foldId: string
): Promise<import("@/types/storage").PredictionDeletionReport> {
  return api.delete(
    `/workspaces/${workspaceId}/predictions/chains/${encodeURIComponent(chainId)}/folds/${encodeURIComponent(foldId)}`
  );
}

export async function deleteWorkspaceChainPredictions(
  workspaceId: string,
  chainId: string
): Promise<import("@/types/storage").PredictionDeletionReport> {
  return api.delete(`/workspaces/${workspaceId}/predictions/chains/${encodeURIComponent(chainId)}`);
}

export async function deleteWorkspaceDatasetPredictions(
  workspaceId: string,
  datasetName: string
): Promise<import("@/types/storage").PredictionDeletionReport> {
  return api.delete(
    `/workspaces/${workspaceId}/predictions/datasets/${encodeURIComponent(datasetName)}`
  );
}

/**
 * Get aggregated prediction summary from parquet metadata.
 *
 * This endpoint reads ONLY file footers, not row data.
 * Response time: ~10-50ms for any workspace size.
 *
 * Returns instant summary with:
 * - Total predictions across all datasets
 * - Score statistics (min/max/mean)
 * - Model breakdown with average scores
 * - Top predictions by validation score
 */
export async function getN4AWorkspacePredictionsSummary(
  workspaceId: string
): Promise<PredictionSummaryResponse> {
  return api.get(`/workspaces/${workspaceId}/predictions/summary`);
}

/**
 * Scatter data response for prediction quick view.
 */
export interface PredictionScatterResponse {
  prediction_id: string;
  y_true: number[];
  y_pred: number[];
  n_samples: number;
  partition: string;
  model_name: string;
  dataset_name: string;
  /** Exact stored sample identities; absence must remain a refusal for conformal attachment. */
  sample_ids?: string[] | null;
  sample_metadata?: Record<string, unknown[]> | null;
}

/**
 * Get scatter plot data (y_true vs y_pred) for a specific prediction.
 * Used for the prediction quick view charts.
 */
export async function getN4AWorkspacePredictionScatter(
  workspaceId: string,
  predictionId: string
): Promise<PredictionScatterResponse> {
  return api.get(`/workspaces/${workspaceId}/predictions/${predictionId}/scatter`);
}

/**
 * Get discovered exports for a workspace
 */
export async function getN4AWorkspaceExports(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredExports> {
  return api.get(`/workspaces/${workspaceId}/exports`);
}

/**
 * Get discovered templates for a workspace
 */
export async function getN4AWorkspaceTemplates(
  workspaceId: string
): Promise<LinkedWorkspaceDiscoveredTemplates> {
  return api.get(`/workspaces/${workspaceId}/templates`);
}
