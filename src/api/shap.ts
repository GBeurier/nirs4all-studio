/**
 * SHAP Analysis API client functions.
 */

import { api } from './client';
import type {
  ShapComputeRequest,
  ShapComputeResponse,
  ShapResultsResponse,
  SpectralImportanceData,
  BeeswarmDataResponse,
  SampleExplanationResponse,
  AvailableModelsResponse,
  ShapConfigResponse,
} from '@/types/shap';

/**
 * Get SHAP configuration options and availability.
 *
 * @returns Configuration including available explainer types and defaults
 */
export async function getShapConfig(): Promise<ShapConfigResponse> {
  return api.get<ShapConfigResponse>('/analysis/shap/config');
}

/**
 * Get available models for SHAP analysis.
 *
 * @returns Lists of models from completed runs and exported bundles
 */
export async function getAvailableModels(): Promise<AvailableModelsResponse> {
  return api.get<AvailableModelsResponse>('/analysis/shap/models');
}

/**
 * Compute SHAP explanations for a model.
 *
 * @param request - The SHAP computation request
 * @param signal - Optional AbortSignal for cancellation
 * @returns Job ID and status
 */
export async function computeShapExplanation(
  request: ShapComputeRequest,
  signal?: AbortSignal
): Promise<ShapComputeResponse> {
  return api.post<ShapComputeResponse>('/analysis/shap/compute', request, { signal });
}

/**
 * Get SHAP results for a completed job.
 *
 * @param jobId - The job ID from computeShapExplanation
 * @returns Full SHAP results including feature importance and binned data
 */
export async function getShapResults(jobId: string): Promise<ShapResultsResponse> {
  return api.get<ShapResultsResponse>(`/analysis/shap/results/${jobId}`);
}

/**
 * Get spectral importance data for visualization.
 *
 * @param jobId - The job ID
 * @returns Spectral data including wavelengths, spectrum, and importance
 */
export async function getSpectralImportance(jobId: string): Promise<SpectralImportanceData> {
  return api.get<SpectralImportanceData>(`/analysis/shap/results/${jobId}/spectral`);
}

/**
 * Get beeswarm plot data.
 *
 * @param jobId - The job ID
 * @param maxSamples - Maximum samples to include (default 200)
 * @returns Binned beeswarm data with SHAP values per sample
 */
export async function getBeeswarmData(
  jobId: string,
  maxSamples: number = 200
): Promise<BeeswarmDataResponse> {
  return api.get<BeeswarmDataResponse>(
    `/analysis/shap/results/${jobId}/beeswarm?max_samples=${maxSamples}`
  );
}

/**
 * Get single sample explanation for waterfall plot.
 *
 * @param jobId - The job ID
 * @param sampleIdx - Index of the sample to explain
 * @param topN - Number of top features to show (default 15)
 * @returns Sample explanation with feature contributions
 */
export async function getSampleExplanation(
  jobId: string,
  sampleIdx: number,
  topN: number = 15
): Promise<SampleExplanationResponse> {
  return api.get<SampleExplanationResponse>(
    `/analysis/shap/results/${jobId}/sample/${sampleIdx}?top_n=${topN}`
  );
}
