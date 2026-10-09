/**
 * usePlaygroundQuery - React Query hook for playground API
 *
 * Provides debounced, cached execution of playground pipelines
 * with support for request cancellation and optimistic updates.
 */

import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRef, useEffect, useMemo, useCallback } from 'react';
import {
  executePlayground,
  executeDatasetPlayground,
  buildExecuteRequest,
  getLoadedWorkspaceDatasetResult,
  getLoadedWorkspaceDatasetDisplayLimit,
} from '@/api/playground';
import {
  useDebouncedValue,
  DEBOUNCE_DELAYS,
} from '@/lib/playground/debounce';
import {
  createPlaygroundQueryKey,
  hashPipeline,
  getSpectralDataIdentity,
  isPlaygroundPipelineCacheable,
} from '@/lib/playground/hashing';
import { projectPlaygroundMetricObservations } from '@/lib/playground/metricObservations';
import { unifiedToPlaygroundSteps } from '@/lib/playground/operatorFormat';
import {
  getColumnarMetadata,
  getSpectralRepetitionColumn,
} from '@/lib/playground/repetition';
import type {
  UnifiedOperator,
  ExecuteResponse,
  SamplingOptions,
  ExecuteOptions,
  PlaygroundResult,
} from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { PartitionKey } from '@/types/datasets';

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
  /** Selected source dataset partition when using datasetId. */
  datasetPartition?: PartitionKey;
  /** Selected source index when using a multi-source workspace dataset. */
  datasetSourceIndex?: number | null;
  /** Selected target index when using a multi-target workspace dataset. */
  datasetTargetIndex?: number | null;
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
    source_partitions: response.source_partitions,
    filterInfo: response.filter_info,
    repetitions: response.repetitions,
    subsetInfo: response.subset_info,
    metrics: response.metrics,
    metricObservations: projectPlaygroundMetricObservations(
      response.metrics,
      response.metric_observations ?? response.metricObservations,
    ),
    executionTimeMs: response.execution_time_ms,
    trace: response.execution_trace,
    errors: response.step_errors,
    warnings: response.warnings ?? [],
    isRawData: response.is_raw_data,
  };
}

/** Keep a few recent results for undo; slider edits must not retain unbounded matrices. */
export function prunePlaygroundResults(queryClient: QueryClient, dataIdentity: string | null): void {
  const queries = queryClient.getQueryCache().findAll({ predicate: query =>
    (query.queryKey[0] === 'playground' && query.queryKey[1] === 'execute') || query.queryKey[0] === 'reference-playground' });
  const identity = (key: readonly unknown[]) => key[key[0] === 'reference-playground' ? 1 : 2];
  const activeSnapshots = new Set<unknown>([dataIdentity, ...queries.filter(query => query.getObserversCount() > 0).map(query => identity(query.queryKey))]);
  const retained = new Map<unknown, number>();
  for (const query of queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)) {
    const snapshot = identity(query.queryKey);
    const count = (retained.get(snapshot) ?? 0) + 1;
    retained.set(snapshot, count);
    if (query.getObserversCount() === 0 && query.state.fetchStatus !== 'fetching'
      && (!activeSnapshots.has(snapshot) || count > 3)) queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
  }
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
    datasetPartition,
    datasetSourceIndex,
    datasetTargetIndex,
    onSuccess,
    onError,
  } = options;
  const queryClient = useQueryClient();
  const dataIdentity = data ? getSpectralDataIdentity(data) : null;

  // Debounce the actual operators, so a request's key and payload describe the
  // same snapshot even while another parameter change is being entered.
  const currentPipelineHash = hashPipeline(operators.filter(operator => operator.enabled));
  // Active operators are unchanged when only a disabled operator is edited.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const activeOperators = useMemo(() => operators.filter(operator => operator.enabled), [currentPipelineHash]);
  const debouncedOperators = useDebouncedValue(activeOperators, debounceMs);
  const debouncedPipelineHash = hashPipeline(debouncedOperators);
  const isDebouncing = currentPipelineHash !== debouncedPipelineHash;
  const sampling: SamplingOptions = useMemo(() => ({
    method: samplingOpts?.method ?? 'random',
    n_samples: samplingOpts?.n_samples ?? 100,
    seed: samplingOpts?.seed ?? 42,
  }), [samplingOpts?.method, samplingOpts?.n_samples, samplingOpts?.seed]);
  const repetitionColumn = useMemo(() => getSpectralRepetitionColumn(data), [data]);
  const loadedResponse = data ? getLoadedWorkspaceDatasetResult(data) : undefined;
  const loadedDisplayLimit = data ? getLoadedWorkspaceDatasetDisplayLimit(data) : undefined;

  // Keep a chart's already requested result when it is hidden. Hiding a chart
  // is a display change; the next pipeline/data change uses current visibility.
  const computationIdentity = `${dataIdentity}:${debouncedPipelineHash}`;
  const chartRequirements = useRef({ identity: '', pca: false, umap: false, repetitions: false });
  if (chartRequirements.current.identity !== computationIdentity) {
    chartRequirements.current = { identity: computationIdentity, pca: false, umap: false, repetitions: false };
  }
  chartRequirements.current.pca ||= (executeOptions?.compute_pca ?? true)
    || (debouncedOperators.length === 0 && loadedResponse !== undefined);
  chartRequirements.current.umap ||= executeOptions?.compute_umap ?? false;
  chartRequirements.current.repetitions ||= executeOptions?.compute_repetitions ?? true;
  const { pca, umap, repetitions } = chartRequirements.current;
  const cacheable = executeOptions?.use_cache !== false && isPlaygroundPipelineCacheable(debouncedOperators, umap);
  const effectiveOptions: ExecuteOptions = useMemo(() => ({
    ...executeOptions,
    compute_pca: pca,
    compute_umap: umap,
    compute_repetitions: repetitions,
    compute_statistics: executeOptions?.compute_statistics ?? true,
    use_cache: cacheable,
    bio_sample_column: repetitionColumn,
    dataset_repetition: repetitionColumn,
    subset_mode: executeOptions?.subset_mode ?? 'all',
    max_wavelengths_returned: executeOptions?.max_wavelengths_returned ?? loadedDisplayLimit,
  }), [executeOptions, pca, umap, repetitions, cacheable, repetitionColumn, loadedDisplayLimit]);
  const queryKey = useMemo(() => {
    const baseKey = createPlaygroundQueryKey(data?.spectra ?? null, data?.y, debouncedOperators,
      sampling, effectiveOptions, dataIdentity);
    return datasetId
      ? [...baseKey, 'dataset', datasetId, datasetPartition ?? 'all', datasetSourceIndex ?? 0, datasetTargetIndex ?? 0]
      : baseKey;
  }, [data, debouncedOperators, sampling, effectiveOptions, dataIdentity, datasetId, datasetPartition, datasetSourceIndex, datasetTargetIndex]);

  const initialResponse = data && datasetId && debouncedOperators.length === 0
    && sampling.method === 'all' && effectiveOptions.subset_mode === 'all'
    && !effectiveOptions.compute_umap && !effectiveOptions.compute_repetitions
    && effectiveOptions.max_wavelengths_returned === loadedDisplayLimit
    && effectiveOptions.split_index === undefined
    ? loadedResponse : undefined;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<PlaygroundResult> => {
      if (!data) throw new Error('No data provided');
      const steps = unifiedToPlaygroundSteps(debouncedOperators);
      let response: ExecuteResponse;
      if (datasetId) {
        response = await executeDatasetPlayground({
          dataset_id: datasetId,
          partition: datasetPartition,
          source_index: datasetSourceIndex ?? undefined,
          target_index: datasetTargetIndex ?? undefined,
          steps,
          sampling: sampling.method === 'all' ? undefined : sampling,
          options: effectiveOptions as Record<string, unknown>,
        }, signal);
      } else {
        response = await executePlayground(buildExecuteRequest({
          spectra: data.spectra,
          wavelengths: data.wavelengths,
          wavelengthUnit: data.wavelengthUnit,
          y: data.y.length > 0 ? data.y : undefined,
          sampleIds: data.sampleIds,
          metadata: getColumnarMetadata(data.metadata),
          steps,
          samplingMethod: sampling.method,
          maxSamples: sampling.n_samples,
          samplingSeed: sampling.seed,
          computePca: effectiveOptions.compute_pca,
          computeUmap: effectiveOptions.compute_umap,
          umapParams: effectiveOptions.umap_params,
          computeStatistics: effectiveOptions.compute_statistics,
          computeRepetitions: effectiveOptions.compute_repetitions,
          maxWavelengths: effectiveOptions.max_wavelengths_returned,
          splitIndex: effectiveOptions.split_index,
          useCache: effectiveOptions.use_cache,
          bioSampleColumn: repetitionColumn,
          datasetRepetition: repetitionColumn,
          subsetMode: effectiveOptions.subset_mode,
          maxSamplesDisplayed: effectiveOptions.max_samples_displayed,
          sourcePartitions: data.sourcePartitions,
        }), signal);
      }
      return transformResponse(response);
    },
    enabled: enabled && !!data?.spectra.length && !isDebouncing,
    initialData: initialResponse ? () => transformResponse(initialResponse) : undefined,
    staleTime: cacheable ? 60 * 1000 : 0,
    gcTime: cacheable ? 5 * 60 * 1000 : 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    // Preserve charts while editing this dataset, never carry a different
    // dataset's spectra/targets into the new selection's display.
    placeholderData: (previousData, previousQuery) => previousQuery?.queryKey[2] === dataIdentity ? previousData : undefined,
  });

  useEffect(() => { prunePlaygroundResults(queryClient, dataIdentity); }, [queryClient, dataIdentity, query.data]);

  useEffect(() => {
    if (query.isSuccess && !query.isPlaceholderData && !isDebouncing && query.data) onSuccess?.(query.data);
  }, [query.isSuccess, query.isPlaceholderData, isDebouncing, query.data, onSuccess]);
  useEffect(() => {
    if (query.isError && query.error) onError?.(query.error as Error);
  }, [query.isError, query.error, onError]);
  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey, exact: true });
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
