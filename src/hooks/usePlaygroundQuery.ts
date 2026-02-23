/**
 * usePlaygroundQuery - React Query hook for playground API
 *
 * Provides debounced, cached execution of playground pipelines
 * with support for request cancellation and optimistic updates.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useMemo, useCallback } from 'react';
import {
  executePlayground,
  executeDatasetPlayground,
  buildExecuteRequest,
  computePcaChart,
  computeRepetitionsChart,
} from '@/api/playground';
import {
  useDebouncedValue,
  DEBOUNCE_DELAYS,
} from '@/lib/playground/debounce';
import {
  createPlaygroundQueryKey,
  hashPipeline,
} from '@/lib/playground/hashing';
import { unifiedToPlaygroundSteps } from '@/lib/playground/operatorFormat';
import type {
  UnifiedOperator,
  ExecuteResponse,
  SamplingOptions,
  ExecuteOptions,
  PlaygroundResult,
} from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

/**
 * Options for usePlaygroundQuery
 */
export interface UsePlaygroundQueryOptions {
  /** Whether to run the query (default: true when data is present) */
  enabled?: boolean;
  /** Sampling configuration for large datasets */
  sampling?: Partial<SamplingOptions>;
  /** Execution options */
  executeOptions?: ExecuteOptions;
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
  /** Workspace dataset ID — when set, uses server-side dataset loading to avoid data round-trip */
  datasetId?: string | null;
  /** Callback when execution completes */
  onSuccess?: (result: PlaygroundResult) => void;
  /** Callback when execution fails */
  onError?: (error: Error) => void;
}

/**
 * Return type for usePlaygroundQuery
 */
export interface UsePlaygroundQueryResult {
  /** Current result data */
  result: PlaygroundResult | null;
  /** Whether a query is currently loading */
  isLoading: boolean;
  /** Whether we're fetching new data (includes background refetch) */
  isFetching: boolean;
  /** Whether there's an error */
  isError: boolean;
  /** Error message if any */
  error: Error | null;
  /** Whether we're in a debounce window */
  isDebouncing: boolean;
  /** Manually refetch the data */
  refetch: () => void;
  /** Current pipeline hash for tracking changes */
  pipelineHash: string;
}

/**
 * Transform ExecuteResponse to PlaygroundResult
 */
function transformResponse(response: ExecuteResponse): PlaygroundResult {
  return {
    original: response.original,
    processed: response.processed,
    pca: response.pca,
    umap: response.umap,
    folds: response.folds,
    filterInfo: response.filter_info,
    repetitions: response.repetitions,
    subsetInfo: response.subset_info,
    executionTimeMs: response.execution_time_ms,
    trace: response.execution_trace,
    errors: response.step_errors,
    isRawData: response.is_raw_data,
  };
}

/**
 * Hook for executing playground pipelines with React Query
 *
 * Features:
 * - Automatic debouncing of pipeline changes
 * - Request cancellation via AbortController
 * - Caching with stable query keys
 * - Keep previous data while loading
 *
 * @param data - Spectral data to process
 * @param operators - Pipeline operators
 * @param options - Query options
 * @returns Query result with processed data
 */
export function usePlaygroundQuery(
  data: SpectralData | null,
  operators: UnifiedOperator[],
  options: UsePlaygroundQueryOptions = {}
): UsePlaygroundQueryResult {
  const {
    enabled = true,
    sampling: samplingOpts,
    executeOptions,
    debounceMs = DEBOUNCE_DELAYS.STRUCTURE_CHANGE,
    datasetId,
    onSuccess,
    onError,
  } = options;

  const queryClient = useQueryClient();
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Track mounted state for cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Compute pipeline hash for tracking changes
  const currentPipelineHash = useMemo(() => hashPipeline(operators), [operators]);

  // Debounce the pipeline hash to prevent rapid API calls
  const debouncedPipelineHash = useDebouncedValue(currentPipelineHash, debounceMs);

  // Track if we're in a debounce window
  const isDebouncing = currentPipelineHash !== debouncedPipelineHash;

  // Build sampling options with defaults
  const sampling: SamplingOptions = useMemo(() => ({
    method: samplingOpts?.method || 'random',
    n_samples: samplingOpts?.n_samples || 100,
    seed: samplingOpts?.seed || 42,
  }), [samplingOpts?.method, samplingOpts?.n_samples, samplingOpts?.seed]);

  // Memoize operators for stable reference when hash matches
  const stableOperatorsRef = useRef(operators);
  if (hashPipeline(stableOperatorsRef.current) !== debouncedPipelineHash) {
    stableOperatorsRef.current = operators;
  }

  // Build query key from debounced values
  // Include datasetId so TanStack Query properly caches per-dataset
  const queryKey = useMemo(() => {
    if (!data) return ['playground', 'execute', null] as const;

    const baseKey = createPlaygroundQueryKey(
      data.spectra,
      data.y,
      stableOperatorsRef.current,
      sampling,
      executeOptions
    );

    // Add datasetId to distinguish dataset-ref vs raw-data queries
    if (datasetId) {
      return [...baseKey, 'dataset', datasetId] as const;
    }

    return baseKey;
  }, [data, debouncedPipelineHash, sampling, executeOptions, datasetId]);

  // Query function with abort support
  const queryFn = useCallback(async (): Promise<PlaygroundResult> => {
    if (!data) {
      throw new Error('No data provided');
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Create new abort controller
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const steps = unifiedToPlaygroundSteps(stableOperatorsRef.current);

    try {
      let response: ExecuteResponse;

      // Use dataset-ref endpoint when a workspace datasetId is available.
      // This avoids uploading the full spectra matrix back to the server.
      if (datasetId) {
        // In dataset-ref mode, parallel chart queries handle PCA/repetitions
        // independently, so the main query skips them for faster core response.
        const skipForParallel = true;
        response = await executeDatasetPlayground(
          {
            dataset_id: datasetId,
            steps,
            sampling: sampling.method !== 'all'
              ? { method: sampling.method, n_samples: sampling.n_samples, seed: sampling.seed }
              : undefined,
            options: {
              compute_pca: skipForParallel ? false : (executeOptions?.compute_pca ?? true),
              compute_umap: executeOptions?.compute_umap ?? false,
              umap_params: executeOptions?.umap_params,
              compute_statistics: executeOptions?.compute_statistics ?? true,
              compute_repetitions: skipForParallel ? false : (executeOptions?.compute_repetitions ?? true),
              max_wavelengths_returned: executeOptions?.max_wavelengths_returned,
              split_index: executeOptions?.split_index,
              use_cache: executeOptions?.use_cache ?? true,
              subset_mode: executeOptions?.subset_mode ?? 'all',
              max_samples_displayed: executeOptions?.max_samples_displayed,
            },
          },
          controller.signal
        );
      } else {
        // Fallback: send full data (for uploads, demos, non-workspace data)
        let metadata: Record<string, unknown[]> | undefined;
        if (data.metadata && data.metadata.length > 0) {
          metadata = {};
          const keys = Object.keys(data.metadata[0]);
          for (const key of keys) {
            metadata[key] = data.metadata.map(m => m[key]);
          }
        }

        const hasBioSample = metadata && 'bio_sample' in metadata;

        const request = buildExecuteRequest({
          spectra: data.spectra,
          wavelengths: data.wavelengths,
          y: data.y,
          sampleIds: data.sampleIds,
          metadata,
          steps,
          samplingMethod: sampling.method,
          maxSamples: sampling.n_samples,
          computePca: executeOptions?.compute_pca ?? true,
          computeUmap: executeOptions?.compute_umap ?? false,
          umapParams: executeOptions?.umap_params,
          computeStatistics: executeOptions?.compute_statistics ?? true,
          computeRepetitions: executeOptions?.compute_repetitions ?? true,
          maxWavelengths: executeOptions?.max_wavelengths_returned,
          splitIndex: executeOptions?.split_index,
          useCache: executeOptions?.use_cache ?? true,
          bioSampleColumn: hasBioSample ? 'bio_sample' : undefined,
          subsetMode: executeOptions?.subset_mode ?? 'all',
          maxSamplesDisplayed: executeOptions?.max_samples_displayed,
        });

        response = await executePlayground(request, controller.signal);
      }

      // Check if still mounted before processing
      if (!isMountedRef.current) {
        throw new Error('Request cancelled');
      }

      return transformResponse(response);
    } catch (error) {
      // Don't throw if request was aborted
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request cancelled');
      }
      throw error;
    } finally {
      // Clean up if this was the current controller
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [data, datasetId, debouncedPipelineHash, sampling, executeOptions]);

  // Determine if parallel chart queries are available.
  // Parallel endpoints (/playground/pca, /playground/repetitions) require dataset_id
  // for step cache lookup. Raw data mode uses the monolithic query for everything.
  const useParallelCharts = Boolean(datasetId);
  const wantPca = executeOptions?.compute_pca ?? true;
  const wantRepetitions = executeOptions?.compute_repetitions ?? true;

  // Main query
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && data !== null && data.spectra.length > 0,
    staleTime: 60 * 1000, // 1 minute
    gcTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      // Don't retry cancelled requests
      if (error instanceof Error && error.message === 'Request cancelled') {
        return false;
      }
      return failureCount < 2;
    },
    placeholderData: (previousData) => previousData, // Keep previous data while loading
  });

  // Parallel PCA query — fires after the main query populates the step cache.
  // Only used when datasetId is available (step cache requires it for lookup).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- debouncedPipelineHash triggers recompute when ref updates
  const steps = useMemo(() => unifiedToPlaygroundSteps(stableOperatorsRef.current), [debouncedPipelineHash]);
  const chartRequest = useMemo(() => ({
    dataset_id: datasetId || undefined,
    steps,
    sampling: sampling.method !== 'all'
      ? { method: sampling.method, n_samples: sampling.n_samples, seed: sampling.seed }
      : undefined,
    options: {},
  }), [datasetId, steps, sampling]);

  const pcaQuery = useQuery({
    queryKey: [...queryKey, 'pca-parallel'],
    queryFn: async () => {
      const result = await computePcaChart(chartRequest);
      if (result.success && result.pca) {
        return result.pca;
      }
      return null;
    },
    enabled: useParallelCharts && wantPca && query.isSuccess && !query.isFetching,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const repetitionsQuery = useQuery({
    queryKey: [...queryKey, 'repetitions-parallel'],
    queryFn: async () => {
      const result = await computeRepetitionsChart(chartRequest);
      if (result.success && result.repetitions) {
        return result.repetitions;
      }
      return null;
    },
    enabled: useParallelCharts && wantRepetitions && query.isSuccess && !query.isFetching,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  // Merge results: main query + parallel chart results
  const mergedResult = useMemo(() => {
    if (!query.data) return null;

    // If not using parallel charts, main query already has everything
    if (!useParallelCharts) return query.data;

    return {
      ...query.data,
      pca: (pcaQuery.data as PlaygroundResult['pca']) ?? query.data.pca,
      repetitions: (repetitionsQuery.data as PlaygroundResult['repetitions']) ?? query.data.repetitions,
    };
  }, [query.data, useParallelCharts, pcaQuery.data, repetitionsQuery.data]);

  // Handle success callback
  useEffect(() => {
    if (query.isSuccess && mergedResult && onSuccess) {
      onSuccess(mergedResult);
    }
  }, [query.isSuccess, mergedResult, onSuccess]);

  // Handle error callback
  useEffect(() => {
    if (query.isError && query.error && onError) {
      onError(query.error as Error);
    }
  }, [query.isError, query.error, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Refetch function that also cancels pending requests
  const refetch = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    result: mergedResult,
    isLoading: query.isLoading,
    isFetching: query.isFetching || (useParallelCharts && (pcaQuery.isFetching || repetitionsQuery.isFetching)),
    isError: query.isError,
    error: query.error as Error | null,
    isDebouncing,
    refetch,
    pipelineHash: currentPipelineHash,
  };
}

/**
 * Hook to prefetch operators from the backend
 */
export function usePrefetchOperators() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Prefetch operators on mount
    queryClient.prefetchQuery({
      queryKey: ['playground', 'operators'],
      queryFn: async () => {
        const { getPlaygroundOperators } = await import('@/api/playground');
        return getPlaygroundOperators();
      },
      staleTime: 10 * 60 * 1000, // 10 minutes
    });
  }, [queryClient]);
}
