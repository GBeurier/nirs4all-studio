/**
 * API client for nirs4all backend communication
 */

const API_BASE_URL = "/api";

interface ApiError {
  detail: string;
  status: number;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const { body, ...restOptions } = options;

    const config: RequestInit = {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...restOptions,
      body: body ? JSON.stringify(body) : undefined,
    };

    try {
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error: ApiError = {
          detail: errorData.detail || `HTTP error ${response.status}`,
          status: response.status,
        };
        throw error;
      }

      return await response.json();
    } catch (error) {
      if ((error as ApiError).status) {
        throw error;
      }
      throw {
        detail: error instanceof Error ? error.message : "Network error",
        status: 0,
      } as ApiError;
    }
  }

  // GET request
  async get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", ...options });
  }

  // POST request
  async post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "POST",
      body: data,
      ...options,
    });
  }

  // PUT request
  async put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, {
      method: "PUT",
      body: data,
      ...options,
    });
  }

  // DELETE request
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { method: "DELETE", ...options });
  }
}

export const api = new ApiClient();

// Axios-like wrapper for backward compatibility with hooks expecting response.data pattern
class AxiosLikeClient {
  async get<T>(endpoint: string, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.get<T>(endpoint, options);
    return { data };
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.post<T>(endpoint, body, options);
    return { data };
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.put<T>(endpoint, body, options);
    return { data };
  }

  async delete<T>(endpoint: string, options?: RequestOptions): Promise<{ data: T }> {
    const data = await api.delete<T>(endpoint, options);
    return { data };
  }
}

export const apiClient = new AxiosLikeClient();

// Health check
export async function checkHealth(): Promise<{ status: string }> {
  return api.get("/health");
}

// Workspace API
export interface WorkspaceResponse {
  workspace: {
    path: string;
    name: string;
    created_at: string;
  } | null;
  datasets: DatasetInfo[];
}

export interface DatasetInfo {
  id: string;
  name: string;
  path: string;
  samples?: number;
  features?: number;
  targets?: number;
  config?: Record<string, unknown>;
  group_id?: string;
  created_at: string;
}

export interface GroupInfo {
  id: string;
  name: string;
  color?: string;
  created_at: string;
}

export async function getWorkspace(): Promise<WorkspaceResponse> {
  return api.get("/workspace");
}

export async function selectWorkspace(
  path: string,
  persistGlobal: boolean = true
): Promise<{ success: boolean; workspace: WorkspaceResponse["workspace"] }> {
  return api.post("/workspace/select", { path, persist_global: persistGlobal });
}

export async function linkDataset(
  path: string,
  config?: Record<string, unknown>
): Promise<{ success: boolean; dataset: DatasetInfo }> {
  return api.post("/datasets/link", { path, config });
}

export async function unlinkDataset(
  datasetId: string
): Promise<{ success: boolean }> {
  return api.delete(`/datasets/${datasetId}`);
}

export async function refreshDataset(
  datasetId: string
): Promise<{ success: boolean; dataset: DatasetInfo }> {
  return api.post(`/datasets/${datasetId}/refresh`);
}

export async function getGroups(): Promise<{ groups: GroupInfo[] }> {
  return api.get("/workspace/groups");
}

export async function createGroup(
  name: string
): Promise<{ success: boolean; group: GroupInfo }> {
  return api.post("/workspace/groups", { name });
}

export async function deleteGroup(
  groupId: string
): Promise<{ success: boolean }> {
  return api.delete(`/workspace/groups/${groupId}`);
}

export async function renameGroup(
  groupId: string,
  newName: string
): Promise<{ success: boolean }> {
  return api.put(`/workspace/groups/${groupId}`, { name: newName });
}

export async function addDatasetToGroup(
  groupId: string,
  datasetId: string
): Promise<{ success: boolean }> {
  return api.post(`/workspace/groups/${groupId}/datasets`, {
    dataset_id: datasetId,
  });
}

export async function removeDatasetFromGroup(
  groupId: string,
  datasetId: string
): Promise<{ success: boolean }> {
  return api.delete(`/workspace/groups/${groupId}/datasets/${datasetId}`);
}

// Dataset API - Extended
import type {
  Dataset,
  DatasetGroup,
  DatasetConfig,
  DatasetStats,
  DatasetListResponse,
  ExportConfig,
} from "@/types/datasets";

export async function listDatasets(): Promise<DatasetListResponse> {
  return api.get("/datasets");
}

export async function getDataset(datasetId: string): Promise<{ dataset: Dataset }> {
  return api.get(`/datasets/${datasetId}`);
}

export async function updateDatasetConfig(
  datasetId: string,
  config: Partial<DatasetConfig>
): Promise<{ success: boolean; dataset: Dataset }> {
  return api.put(`/datasets/${datasetId}`, { config });
}

export async function getDatasetStats(
  datasetId: string,
  partition: string = "train"
): Promise<DatasetStats> {
  return api.get(`/datasets/${datasetId}/stats?partition=${partition}`);
}

export async function exportDataset(
  datasetId: string,
  config: ExportConfig
): Promise<{ success: boolean; export_path: string }> {
  return api.post(`/datasets/${datasetId}/export`, config);
}

export async function listGroups(): Promise<{ groups: DatasetGroup[] }> {
  return api.get("/workspace/groups");
}

// Pipeline API
export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
}

export interface PipelineStep {
  id: string;
  type: "preprocessing" | "splitting" | "model" | "metrics";
  name: string;
  params: Record<string, unknown>;
}

export async function listPipelines(): Promise<{ pipelines: PipelineInfo[] }> {
  return api.get("/pipelines");
}

export async function getPipeline(id: string): Promise<PipelineInfo> {
  return api.get(`/pipelines/${id}`);
}

export async function savePipeline(
  pipeline: Partial<PipelineInfo>
): Promise<{ success: boolean; pipeline: PipelineInfo }> {
  if (pipeline.id) {
    return api.put(`/pipelines/${pipeline.id}`, pipeline);
  }
  return api.post("/pipelines", pipeline);
}

export async function deletePipeline(
  id: string
): Promise<{ success: boolean }> {
  return api.delete(`/pipelines/${id}`);
}

// Predictions API
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

export async function getRunStats(): Promise<RunStatsResponse> {
  return api.get("/runs/stats");
}

export async function createRun(config: ExperimentConfig): Promise<Run> {
  return api.post("/runs", { config });
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
