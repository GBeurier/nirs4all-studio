/**
 * useReferenceDatasetQuery - Hook for processing reference dataset
 *
 * Phase 6: Dataset Reference Mode
 *
 * Processes a reference dataset through the same pipeline as the primary dataset,
 * enabling side-by-side comparison visualization.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useEffect } from 'react';
import { prunePlaygroundResults } from './usePlaygroundQuery';
import { executePlayground, buildExecuteRequest } from '@/api/playground';
import { useDebouncedValue, DEBOUNCE_DELAYS } from '@/lib/playground/debounce';
import { hashPipeline, getSpectralDataIdentity, isPlaygroundPipelineCacheable } from '@/lib/playground/hashing';
import { unifiedToPlaygroundSteps } from '@/lib/playground/operatorFormat';
import {
  getColumnarMetadata,
  getSpectralRepetitionColumn,
} from '@/lib/playground/repetition';
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
  const queryClient = useQueryClient();

  const currentPipelineHash = hashPipeline(operators.filter(operator => operator.enabled));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeOperators = useMemo(() => operators.filter(operator => operator.enabled), [currentPipelineHash]);
  const effectiveOperators = useDebouncedValue(activeOperators, debounceMs);
  const debouncedPipelineHash = hashPipeline(effectiveOperators);
  const isDebouncing = currentPipelineHash !== debouncedPipelineHash;
  const repetitionColumn = useMemo(() => getSpectralRepetitionColumn(referenceData), [referenceData]);
  const dataIdentity = referenceData ? getSpectralDataIdentity(referenceData) : null;
  const cacheable = isPlaygroundPipelineCacheable(effectiveOperators);
  const queryKey = ['reference-playground', dataIdentity, debouncedPipelineHash];

  // Query function
  const queryFn = async ({ signal }: { signal?: AbortSignal }): Promise<PlaygroundResult> => {
    if (!referenceData) {
      throw new Error('No reference data');
    }

    const steps = unifiedToPlaygroundSteps(effectiveOperators);
    const request = buildExecuteRequest({
      spectra: referenceData.spectra,
      wavelengths: referenceData.wavelengths,
      wavelengthUnit: referenceData.wavelengthUnit,
      y: referenceData.y.length > 0 ? referenceData.y : undefined,
      sampleIds: referenceData.sampleIds,
      metadata: getColumnarMetadata(referenceData.metadata),
      steps,
      samplingMethod: 'all', // Process all reference samples
      computePca: true,
      computeUmap: false, // Skip UMAP for reference to save time
      computeStatistics: true,
      computeRepetitions: true,
      useCache: cacheable,
      sourcePartitions: referenceData.sourcePartitions,
      bioSampleColumn: repetitionColumn,
      datasetRepetition: repetitionColumn,
    });

    const response = await executePlayground(
      request,
      signal
    );

    return transformResponse(response);
  };

  // Use React Query
  const query = useQuery({
    queryKey,
    queryFn,
    enabled: enabled && !!referenceData && effectiveOperators.length > 0 && !isDebouncing,
    staleTime: cacheable ? 5 * 60 * 1000 : 0,
    gcTime: cacheable ? 10 * 60 * 1000 : 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });

  useEffect(() => { prunePlaygroundResults(queryClient, dataIdentity); }, [queryClient, dataIdentity, query.data]);

  return {
    result: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    isDebouncing,
  };
}
