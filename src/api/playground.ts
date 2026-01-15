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
 * Response from the /api/playground/capabilities endpoint
 */
export interface PlaygroundCapabilities {
  umap_available: boolean;
  nirs4all_available: boolean;
  features: {
    pca: boolean;
    umap: boolean;
    filters: boolean;
    preprocessing: boolean;
    splitting: boolean;
    augmentation: boolean;
  };
}

/**
 * Get playground capabilities (available features)
 *
 * @returns Capabilities including UMAP availability
 */
export async function getPlaygroundCapabilities(): Promise<PlaygroundCapabilities> {
  return api.get<PlaygroundCapabilities>('/playground/capabilities');
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
  metadata?: Record<string, unknown[]>;
  steps: PlaygroundStep[];
  samplingMethod?: 'random' | 'stratified' | 'kmeans' | 'all';
  maxSamples?: number;
  computePca?: boolean;
  computeUmap?: boolean;
  umapParams?: {
    n_neighbors?: number;
    min_dist?: number;
    n_components?: number;
  };
  computeStatistics?: boolean;
  maxWavelengths?: number;
  splitIndex?: number;
  useCache?: boolean;
  bioSampleColumn?: string;
}): ExecuteRequest {
  return {
    data: {
      x: params.spectra,
      wavelengths: params.wavelengths,
      y: params.y,
      sample_ids: params.sampleIds,
      metadata: params.metadata,
    },
    steps: params.steps,
    sampling: params.samplingMethod !== 'all' ? {
      method: params.samplingMethod || 'random',
      n_samples: params.maxSamples || 100,
      seed: 42,
    } : undefined,
    options: {
      compute_pca: params.computePca ?? true,
      compute_umap: params.computeUmap ?? false,
      umap_params: params.umapParams,
      compute_statistics: params.computeStatistics ?? true,
      max_wavelengths_returned: params.maxWavelengths,
      split_index: params.splitIndex,
      use_cache: params.useCache ?? true,
      bio_sample_column: params.bioSampleColumn,
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

  // Convert wavelengths to numbers with robust handling
  // Backend may return numbers, strings, or edge cases like empty/null
  let wavelengths: number[];
  let rawWavelengths = response.wavelengths;

  // Handle nested array case (e.g., [[w1, w2, ...]] instead of [w1, w2, ...])
  if (rawWavelengths?.length === 1 && Array.isArray(rawWavelengths[0])) {
    rawWavelengths = rawWavelengths[0] as (number | string)[];
  }

  if (!rawWavelengths || rawWavelengths.length === 0) {
    // Fallback to indices if no wavelengths
    wavelengths = Array.from({ length: response.num_features }, (_, i) => i);
  } else {
    wavelengths = rawWavelengths.map((w, i) => {
      if (typeof w === 'number' && Number.isFinite(w)) {
        return w;
      }
      const parsed = typeof w === 'string' ? parseFloat(w) : NaN;
      // Fall back to index if parsing fails
      return Number.isFinite(parsed) ? parsed : i;
    });
  }

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

// ============= Difference Computation Types & Functions =============

/**
 * Available distance metrics for difference computation
 */
export type DiffDistanceMetric =
  | 'euclidean'
  | 'manhattan'
  | 'cosine'
  | 'spectral_angle'
  | 'correlation'
  | 'mahalanobis'
  | 'pca_distance';

/**
 * Request for computing differences between reference and final datasets
 */
export interface DiffComputeRequest {
  X_ref: number[][];
  X_final: number[][];
  metric: DiffDistanceMetric;
  scale: 'linear' | 'log';
}

/**
 * Response from diff computation
 */
export interface DiffComputeResponse {
  success: boolean;
  metric: string;
  scale: string;
  distances: number[];
  statistics: {
    mean: number;
    std: number;
    min: number;
    max: number;
    quantiles: {
      50: number;
      75: number;
      90: number;
      95: number;
    };
  };
}

/**
 * Request for computing repetition variance
 */
export interface RepetitionVarianceRequest {
  X: number[][];
  group_ids: string[];
  reference: 'group_mean' | 'leave_one_out' | 'first' | 'selected';
  metric?: DiffDistanceMetric;
}

/**
 * Response from repetition variance computation
 */
export interface RepetitionVarianceResponse {
  success: boolean;
  reference: string;
  metric: string;
  distances: number[];
  sample_indices: number[];
  group_ids: string[];
  quantiles: {
    50: number;
    75: number;
    90: number;
    95: number;
  };
  per_group: Record<string, {
    mean: number;
    std: number;
    max: number;
    count: number;
  }>;
  n_groups: number;
}

/**
 * Compute per-sample differences between reference and final spectra
 *
 * @param request - Request with reference and final spectra arrays
 * @param signal - Optional AbortSignal for cancellation
 * @returns Distance values and statistics for each sample
 */
export async function computeDiff(
  request: DiffComputeRequest,
  signal?: AbortSignal
): Promise<DiffComputeResponse> {
  const response = await fetch('/api/playground/diff/compute', {
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
 * Compute variance within repetition groups
 *
 * @param request - Request with spectra data and group identifiers
 * @param signal - Optional AbortSignal for cancellation
 * @returns Per-sample distances and per-group statistics
 */
export async function computeRepetitionVariance(
  request: RepetitionVarianceRequest,
  signal?: AbortSignal
): Promise<RepetitionVarianceResponse> {
  const response = await fetch('/api/playground/diff/repetition-variance', {
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
