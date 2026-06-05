/**
 * Runs API client functions.
 */

import { api } from "./http";

// Runs API
import type {
  Run,
  RunListResponse,
  RunStatsResponse,
  RunActionResponse,
  ExperimentConfig,
} from "@/types/runs";

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

// Quick Run (Run A) - Single pipeline execution
export interface QuickRunRequest {
  pipeline_id: string;
  dataset_id: string;
  name?: string;
  export_model?: boolean;
  cv_folds?: number;
  random_state?: number;
}

export async function quickRun(request: QuickRunRequest): Promise<Run> {
  return api.post("/runs/quick", request);
}

export async function stopRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/stop`);
}

export async function pauseRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/pause`);
}

export async function resumeRun(runId: string): Promise<RunActionResponse> {
  return api.post(`/runs/${runId}/resume`);
}

export async function retryRun(runId: string): Promise<Run> {
  return api.post(`/runs/${runId}/retry`);
}

export async function deleteRun(runId: string): Promise<RunActionResponse> {
  return api.delete(`/runs/${runId}`);
}

export async function getPipelineLogs(
  runId: string,
  pipelineId: string
): Promise<{ pipeline_id: string; logs: string[] }> {
  return api.get(`/runs/${runId}/logs/${pipelineId}`);
}
