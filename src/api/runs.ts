/**
 * Runs API client — run CRUD, quick run, preflight, logs, and the experiment
 * predictions list.
 */

import { api } from "./transport";
import {
  buildExecutionJobRecordsQueryParams,
  normalizeExecutionJobRecord,
  normalizeExecutionJobRecordsListPayload,
  type ExecutionJobRecord,
  type ExecutionJobRecordFilters,
  type ExecutionJobRecordsListPayload,
} from "@/lib/runs/executionJobRecords";
import type {
  Run,
  RunListResponse,
  RunStatsResponse,
  RunActionResponse,
  ExperimentConfig,
  SplitGroupByByDataset,
  RunExecutionBackendsResponse,
} from "@/types/runs";
import type { PipelineExecutionRobustnessLaunchPayload } from "@/lib/pipelineExecutionContract";
import type { NativeExperimentLaunchPayload } from "@/lib/experimentExecutionAdapter";

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

export async function getRunExecutionBackends(): Promise<RunExecutionBackendsResponse> {
  return api.get("/runs/execution-backends");
}

export async function listRunExecutionJobRecords(
  filters: ExecutionJobRecordFilters = {},
): Promise<ExecutionJobRecordsListPayload> {
  const params = buildExecutionJobRecordsQueryParams(filters).toString();
  const endpoint = params
    ? `/runs/execution-job-records?${params}`
    : "/runs/execution-job-records";
  const payload = await api.get<unknown>(endpoint);
  return normalizeExecutionJobRecordsListPayload(payload);
}

export async function getRunExecutionJobRecord(runId: string): Promise<ExecutionJobRecord> {
  const payload = await api.get<unknown>(`/runs/${runId}/execution-job-record`);
  const record = normalizeExecutionJobRecord(payload);
  if (record == null) {
    throw new Error(`Malformed execution job record for run ${runId}`);
  }
  return record;
}

export async function getWorkspaceExecutionJobRecord(jobId: string): Promise<ExecutionJobRecord> {
  const payload = await api.get<unknown>(`/runs/execution-job-records/${jobId}`);
  const record = normalizeExecutionJobRecord(payload);
  if (record == null) {
    throw new Error(`Malformed workspace execution job record for job ${jobId}`);
  }
  return record;
}

export interface ExecutionJobCommandResponse {
  action: "cancel";
  job_id: string;
  success: boolean;
  message: string;
  backend: string | null;
  run_id?: string | null;
  metadata: Record<string, unknown>;
}

export class ExecutionJobCommandError extends Error {
  readonly kind = "execution_job_command_error";
  readonly detail: string;
  readonly response: ExecutionJobCommandResponse;

  constructor(response: ExecutionJobCommandResponse, fallbackMessage: string) {
    const detail = response.message || fallbackMessage;
    super(detail);
    this.name = "ExecutionJobCommandError";
    this.detail = detail;
    this.response = response;
  }
}

export async function cancelExecutionJobRecord(jobId: string): Promise<ExecutionJobCommandResponse> {
  const response = await api.post<ExecutionJobCommandResponse>(`/runs/execution-job-records/${jobId}/cancel`);
  if (!response.success) {
    throw new ExecutionJobCommandError(
      response,
      `Execution job ${jobId} could not be cancelled`,
    );
  }
  return response;
}

export async function createRun(config: ExperimentConfig): Promise<Run> {
  return api.post("/runs", { config });
}

export async function createRunGroup(payload: NativeExperimentLaunchPayload): Promise<Run> {
  return api.post("/runs/run-groups", payload);
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
  engine?: string | null;
  allow_fallback?: boolean;
  split_group_by_by_dataset?: SplitGroupByByDataset;
  inline_pipeline?: InlinePipelinePayload;
  robustness?: PipelineExecutionRobustnessLaunchPayload;
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
