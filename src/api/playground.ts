/**
 * Playground API client functions
 *
 * Provides typed functions for interacting with the playground backend API.
 * Uses fetch with AbortController for request cancellation.
 */

import { api } from './client';
import type {
  ExecuteRequest,
  ExecuteResponse,
  OperatorsResponse,
  PresetsResponse,
  ValidationResponse,
  PlaygroundStep,
} from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

/**
 * Response from the /api/spectra/{dataset_id} endpoint
 */
export interface SpectraResponse {
  dataset_id: string;
  partition: string;
  source: number;
  start: number;
  end: number;
  total_samples: number;
  num_features: number;
  spectra: number[][];
  wavelengths: (number | string)[];
  wavelength_unit: string;
  y?: number[] | null;
}

/**
 * Response from the /api/spectra/{dataset_id}/stats endpoint
 */
export interface SpectraStatsResponse {
  dataset_id: string;
  partition: string;
  source: number;
  wavelengths: (number | string)[];
  statistics: {
    mean: number[];
    std: number[];
    min: number[];
    max: number[];
    median: number[];
    q1: number[];
    q3: number[];
  };
  global: {
    global_mean: number;
    global_std: number;
    global_min: number;
    global_max: number;
    num_samples: number;
    num_features: number;
  };
}

/**
 * Execute a playground pipeline
 *
 * @param request - Execution request with data, steps, and options
 * @param signal - Optional AbortSignal for cancellation
 * @returns Execution response with processed data and metadata
 */
export async function executePlayground(
  request: ExecuteRequest,
  signal?: AbortSignal
): Promise<ExecuteResponse> {
  const url = '/api/playground/execute';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || `HTTP error ${response.status}`);
  }

  return response.json();
}

/**
 * Get available operators from the backend
 *
 * @returns All preprocessing and splitting operators with metadata
 */
export async function getPlaygroundOperators(): Promise<OperatorsResponse> {
  return api.get<OperatorsResponse>('/playground/operators');
}

/**
 * Get preset pipeline configurations
 *
 * @returns Common preprocessing and splitting presets
 */
export async function getPlaygroundPresets(): Promise<PresetsResponse> {
  return api.get<PresetsResponse>('/playground/presets');
}

/**
 * Validate a playground pipeline configuration
 *
 * @param steps - Pipeline steps to validate
 * @returns Validation results with errors and warnings per step
 */
export async function validatePlaygroundPipeline(
  steps: PlaygroundStep[]
): Promise<ValidationResponse> {
  return api.post<ValidationResponse>('/playground/validate', steps);
}

/**
 * Build an ExecuteRequest from components
 *
 * Helper function to construct a properly typed request.
 */
export function buildExecuteRequest(params: {
  spectra: number[][];
  wavelengths?: number[];
  y?: number[];
  sampleIds?: string[];
  steps: PlaygroundStep[];
  samplingMethod?: 'random' | 'stratified' | 'kmeans' | 'all';
  maxSamples?: number;
  computePca?: boolean;
  computeStatistics?: boolean;
  maxWavelengths?: number;
  splitIndex?: number;
  useCache?: boolean;
}): ExecuteRequest {
  return {
    data: {
      x: params.spectra,
      wavelengths: params.wavelengths,
      y: params.y,
      sample_ids: params.sampleIds,
    },
    steps: params.steps,
    sampling: params.samplingMethod !== 'all' ? {
      method: params.samplingMethod || 'random',
      n_samples: params.maxSamples || 100,
      seed: 42,
    } : undefined,
    options: {
      compute_pca: params.computePca ?? true,
      compute_statistics: params.computeStatistics ?? true,
      max_wavelengths_returned: params.maxWavelengths,
      split_index: params.splitIndex,
      use_cache: params.useCache ?? true,
    },
  };
}

/**
 * Get spectra from a workspace dataset
 *
 * @param datasetId - Dataset ID from workspace
 * @param options - Pagination, partition, and include_y options
 * @returns Spectra data with wavelengths and metadata
 */
export async function getDatasetSpectra(
  datasetId: string,
  options?: {
    start?: number;
    end?: number;
    partition?: string;
    source?: number;
    includeY?: boolean;
  }
): Promise<SpectraResponse> {
  const params = new URLSearchParams();
  if (options?.start !== undefined) params.set('start', options.start.toString());
  if (options?.end !== undefined) params.set('end', options.end.toString());
  if (options?.partition) params.set('partition', options.partition);
  if (options?.source !== undefined) params.set('source', options.source.toString());
  if (options?.includeY) params.set('include_y', 'true');

  const query = params.toString() ? `?${params.toString()}` : '';
  return api.get<SpectraResponse>(`/spectra/${datasetId}${query}`);
}

/**
 * Get statistics for a workspace dataset's spectra
 *
 * @param datasetId - Dataset ID from workspace
 * @param partition - Data partition (train, test, etc.)
 * @param source - Source index for multi-source datasets
 * @returns Statistics for the spectral data
 */
export async function getDatasetSpectraStats(
  datasetId: string,
  partition: string = 'train',
  source: number = 0
): Promise<SpectraStatsResponse> {
  return api.get<SpectraStatsResponse>(
    `/spectra/${datasetId}/stats?partition=${partition}&source=${source}`
  );
}

/**
 * Load a workspace dataset as SpectralData for playground use
 *
 * Fetches spectra from a workspace dataset and converts to SpectralData format.
 * Now includes actual Y values from the dataset when available.
 *
 * @param datasetId - Dataset ID from workspace
 * @param datasetName - Optional dataset name for sample IDs
 * @returns SpectralData compatible with playground hooks
 */
export async function loadWorkspaceDataset(
  datasetId: string,
  datasetName?: string
): Promise<SpectralData> {
  // Request Y values along with spectra
  const response = await getDatasetSpectra(datasetId, { includeY: true });

  // Convert wavelengths to numbers
  const wavelengths = response.wavelengths.map(w =>
    typeof w === 'number' ? w : parseFloat(w)
  );

  // Generate sample IDs if not provided
  const sampleIds = response.spectra.map((_, i) =>
    `${datasetName || response.dataset_id}_${i + 1}`
  );

  // Use actual Y values from dataset if available, otherwise use indices as fallback
  const y = response.y && response.y.length > 0
    ? response.y
    : response.spectra.map((_, i) => i);

  return {
    wavelengths,
    spectra: response.spectra,
    y,
    sampleIds,
  };
}
