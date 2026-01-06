/**
 * usePlaygroundQuery - React Query hook for playground API
 *
 * Provides debounced, cached execution of playground pipelines
 * with support for request cancellation and optimistic updates.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useMemo, useCallback } from 'react';
import { executePlayground, buildExecuteRequest } from '@/api/playground';
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
  const queryKey = useMemo(() => {
    if (!data) return ['playground', 'execute', null] as const;

    return createPlaygroundQueryKey(
      data.spectra,
      data.y,
      stableOperatorsRef.current,
      sampling,
      executeOptions
    );
  }, [data, debouncedPipelineHash, sampling, executeOptions]);

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

    const request = buildExecuteRequest({
      spectra: data.spectra,
      wavelengths: data.wavelengths,
      y: data.y,
      sampleIds: data.sampleIds,
      steps,
      samplingMethod: sampling.method,
      maxSamples: sampling.n_samples,
      computePca: executeOptions?.compute_pca ?? true,
      computeUmap: executeOptions?.compute_umap ?? false,
      umapParams: executeOptions?.umap_params,
      computeStatistics: executeOptions?.compute_statistics ?? true,
      maxWavelengths: executeOptions?.max_wavelengths_returned,
      splitIndex: executeOptions?.split_index,
      useCache: executeOptions?.use_cache ?? true,
    });

    try {
      const response = await executePlayground(request, controller.signal);

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
  }, [data, debouncedPipelineHash, sampling, executeOptions]);

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

  // Handle success callback
  useEffect(() => {
    if (query.isSuccess && query.data && onSuccess) {
      onSuccess(query.data);
    }
  }, [query.isSuccess, query.data, onSuccess]);

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
    result: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
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
