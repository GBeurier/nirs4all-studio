/**
 * Enriched runs API client — enriched run rollups, per-dataset score
 * distributions, and chain listings for a run or results dataset.
 */

import { api } from "./transport";
import type {
  EnrichedRunsResponse,
  ScoreDistribution,
  AllChainsResponse,
} from "@/types/enriched-runs";

export async function getEnrichedRuns(workspaceId: string, projectId?: string): Promise<EnrichedRunsResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId);
  const query = params.toString() ? `?${params.toString()}` : "";
  return api.get(`/workspaces/${workspaceId}/runs/enriched${query}`);
}

export async function getScoreDistribution(workspaceId: string, runId: string, datasetName: string): Promise<ScoreDistribution> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}/datasets/${encodeURIComponent(datasetName)}/scores`);
}

export async function getAllChainsForDataset(workspaceId: string, runId: string, datasetName: string): Promise<AllChainsResponse> {
  return api.get(`/workspaces/${workspaceId}/runs/${runId}/datasets/${encodeURIComponent(datasetName)}/chains`);
}

export async function getAllChainsForResultsDataset(workspaceId: string, datasetName: string): Promise<AllChainsResponse> {
  return api.get(`/workspaces/${workspaceId}/results/datasets/${encodeURIComponent(datasetName)}/chains`);
}
