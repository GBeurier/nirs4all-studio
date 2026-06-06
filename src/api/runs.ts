/**
 * Runs API client — run CRUD, quick run, preflight, logs, and the experiment
 * predictions list.
 */

import { api } from "./transport";
import type {
  Run,
  RunListResponse,
  RunStatsResponse,
  RunActionResponse,
  ExperimentConfig,
  SplitGroupByByDataset,
} from "@/types/runs";

export interface PredictionRecord {
  id: string;
  dataset_name: string;
  pipeline_name: string;
  model_name: string;
  run_id: string;
  metrics: Record<string, number>;
  created_at: string;
}

export async function listPredictions(): Promise<{
  predictions: PredictionRecord[];
}> {
  return api.get("/predictions");
}

export async function listRuns(): Promise<RunListResponse> {
  return api.get("/runs");
}

export async function getRun(runId: string): Promise<Run> {
  return api.get(`/runs/${runId}`);
}

export async function getActiveRuns(): Promise<RunListResponse> {
  return api.get("/runs?status=running,queued");
}

export async function getRunStats(): Promise<RunStatsResponse> {
  return api.get("/runs/stats");
}

export async function createRun(config: ExperimentConfig): Promise<Run> {
  return api.post("/runs", { config });
}

export interface InlinePipelinePayload {
  name: string;
  steps: unknown[];
}

// Quick Run (Run A) - Single pipeline execution
export interface QuickRunRequest {
  pipeline_id: string;
  dataset_id: string;
  name?: string;
  export_model?: boolean;
  cv_folds?: number;
  random_state?: number;
  split_group_by_by_dataset?: SplitGroupByByDataset;
  inline_pipeline?: InlinePipelinePayload;
}

export async function quickRun(request: QuickRunRequest): Promise<Run> {
  return api.post("/runs/quick", request);
}

export async function stopRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/stop`);
}

export async function retryRun(runId: string): Promise<Run> {
  return api.post(`/runs/${runId}/retry`);
}

export async function deleteRun(runId: string): Promise<RunActionResponse> {
  return api.delete(`/runs/${runId}`);
}

// Run preflight check
export interface PreflightIssue {
  type: string;
  message: string;
  details?: Record<string, string | null | undefined>;
}

export interface PreflightResult {
  ready: boolean;
  issues: PreflightIssue[];
}

export async function runPreflight(
  pipelineIds: string[],
  inlinePipeline?: InlinePipelinePayload,
  inlinePipelines?: InlinePipelinePayload[],
): Promise<PreflightResult> {
  return api.post("/runs/preflight", {
    pipeline_ids: pipelineIds,
    inline_pipeline: inlinePipeline ?? null,
    inline_pipelines: inlinePipelines ?? [],
  });
}

export async function getPipelineLogs(
  runId: string,
  pipelineId: string
): Promise<{ pipeline_id: string; logs: string[] }> {
  return api.get(`/runs/${runId}/logs/${pipelineId}`);
}
