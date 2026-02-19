/**
 * SHAP Analysis API client functions.
 */

import { api } from './client';
import type {
  ShapComputeRequest,
  ShapComputeResponse,
  ShapResultsResponse,
  SpectralImportanceData,
  SpectralDetailData,
  ScatterData,
  BeeswarmDataResponse,
  SampleExplanationResponse,
  AvailableModelsResponse,
  ShapConfigResponse,
  RebinRequest,
  BinnedImportanceData,
} from '@/types/shap';

export async function getShapConfig(): Promise<ShapConfigResponse> {
  return api.get<ShapConfigResponse>('/analysis/shap/config');
}

export async function getAvailableModels(): Promise<AvailableModelsResponse> {
  return api.get<AvailableModelsResponse>('/analysis/shap/models');
}

export async function computeShapExplanation(
  request: ShapComputeRequest,
  signal?: AbortSignal
): Promise<ShapComputeResponse> {
  return api.post<ShapComputeResponse>('/analysis/shap/compute', request, { signal });
}

export async function getShapStatus(jobId: string): Promise<Record<string, unknown>> {
  return api.get(`/analysis/shap/status/${jobId}`);
}

export async function getShapResults(jobId: string): Promise<ShapResultsResponse> {
  return api.get<ShapResultsResponse>(`/analysis/shap/results/${jobId}`);
}

export async function getSpectralImportance(jobId: string): Promise<SpectralImportanceData> {
  return api.get<SpectralImportanceData>(`/analysis/shap/results/${jobId}/spectral`);
}

export async function getSpectralDetail(
  jobId: string,
  sampleIndices?: number[]
): Promise<SpectralDetailData> {
  const params = sampleIndices?.length ? `?sample_indices=${sampleIndices.join(',')}` : '';
  return api.get<SpectralDetailData>(`/analysis/shap/results/${jobId}/spectral-detail${params}`);
}

export async function getScatterData(jobId: string): Promise<ScatterData> {
  return api.get<ScatterData>(`/analysis/shap/results/${jobId}/scatter`);
}

export async function rebinShapResults(
  jobId: string,
  params: RebinRequest
): Promise<{ binned_importance: BinnedImportanceData }> {
  return api.post(`/analysis/shap/results/${jobId}/rebin`, params);
}

export async function getBeeswarmData(
  jobId: string,
  maxSamples: number = 200
): Promise<BeeswarmDataResponse> {
  return api.get<BeeswarmDataResponse>(
    `/analysis/shap/results/${jobId}/beeswarm?max_samples=${maxSamples}`
  );
}

export async function getSampleExplanation(
  jobId: string,
  sampleIdx: number,
  topN: number = 15
): Promise<SampleExplanationResponse> {
  return api.get<SampleExplanationResponse>(
    `/analysis/shap/results/${jobId}/sample/${sampleIdx}?top_n=${topN}`
  );
}
