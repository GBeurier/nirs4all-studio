/**
 * useReferenceDatasetQuery - Hook for processing reference dataset
 *
 * Phase 6: Dataset Reference Mode
 *
 * Processes a reference dataset through the same pipeline as the primary dataset,
 * enabling side-by-side comparison visualization.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useEffect } from 'react';
import { executePlayground, buildExecuteRequest } from '@/api/playground';
import { useDebouncedValue, DEBOUNCE_DELAYS } from '@/lib/playground/debounce';
import { hashPipeline } from '@/lib/playground/hashing';
import { unifiedToPlaygroundSteps } from '@/lib/playground/operatorFormat';
import type { UnifiedOperator, PlaygroundResult, ExecuteResponse } from '@/types/playground';
import type { SpectralData } from '@/types/spectral';

interface UseReferenceDatasetQueryOptions {
  /** Whether the reference mode is active */
  enabled?: boolean;
  /** Debounce delay in ms */
  debounceMs?: number;
}

interface UseReferenceDatasetQueryResult {
  /** Processed reference data */
  result: PlaygroundResult | null;
  /** Whether loading */
  isLoading: boolean;
  /** Whether fetching (includes background) */
  isFetching: boolean;
  /** Error if any */
  error: Error | null;
  /** Whether in debounce window */
  isDebouncing: boolean;
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
 * Hook for processing reference dataset through the pipeline
 *
 * @param referenceData - Reference spectral data
 * @param operators - Pipeline operators (same as primary)
 * @param options - Query options
 */
export function useReferenceDatasetQuery(
  referenceData: SpectralData | null,
  operators: UnifiedOperator[],
  options: UseReferenceDatasetQueryOptions = {}
): UseReferenceDatasetQueryResult {
  const {
    enabled = true,
    debounceMs = DEBOUNCE_DELAYS.STRUCTURE_CHANGE,
  } = options;

  const abortControllerRef = useRef<AbortController | null>(null);

  // Compute pipeline hash
  const currentPipelineHash = useMemo(() => hashPipeline(operators), [operators]);

  // Debounce the pipeline hash
  const debouncedPipelineHash = useDebouncedValue(currentPipelineHash, debounceMs);

  // Track debouncing state
  const isDebouncing = currentPipelineHash !== debouncedPipelineHash;

  // Memoize operators for stable reference
  const stableOperatorsRef = useRef(operators);
  if (hashPipeline(stableOperatorsRef.current) !== debouncedPipelineHash) {
    stableOperatorsRef.current = operators;
  }

  // Only enabled operators affect output
  const effectiveOperators = useMemo(() => {
    return stableOperatorsRef.current.filter(op => op.enabled);
  }, [debouncedPipelineHash]);

  // Build query key
  const queryKey = useMemo(() => {
    if (!referenceData) return ['reference-playground', 'no-data'];
    return [
      'reference-playground',
      referenceData.spectra.length,
      referenceData.wavelengths.length,
      debouncedPipelineHash,
    ];
  }, [referenceData, debouncedPipelineHash]);

  // Query function
  const queryFn = async ({ signal }: { signal?: AbortSignal }): Promise<PlaygroundResult> => {
    if (!referenceData) {
      throw new Error('No reference data');
    }

    // Cancel previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const steps = unifiedToPlaygroundSteps(effectiveOperators);

    const request = buildExecuteRequest({
      spectra: referenceData.spectra,
      wavelengths: referenceData.wavelengths,
      y: referenceData.y,
      sampleIds: referenceData.sampleIds,
      steps,
      samplingMethod: 'all', // Process all reference samples
      computePca: true,
      computeUmap: false, // Skip UMAP for reference to save time
      computeStatistics: true,
    });

    const response = await executePlayground(
      request,
      signal || abortControllerRef.current.signal
    );

    return transformResponse(response);
  };

  // Use React Query
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!referenceData && effectiveOperators.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    result: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    isDebouncing,
  };
}
