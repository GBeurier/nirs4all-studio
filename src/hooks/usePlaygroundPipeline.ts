/**
 * usePlaygroundPipeline - Manages playground pipeline state
 *
 * This is the updated version of usePipeline that:
 * - Uses unified operator format (preprocessing + splitting)
 * - Integrates with backend via usePlaygroundQuery
 * - Supports single splitter constraint
 * - Manages undo/redo history
 * - Supports step-by-step comparison mode
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type {
  UnifiedOperator,
  OperatorDefinition,
  PlaygroundResult,
  SamplingOptions,
  ExecuteOptions,
  PerChartLoadingState,
} from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import type { PartitionKey } from '@/types/datasets';
import { usePlaygroundQuery } from './usePlaygroundQuery';
import { useChangeDetection } from './useChangeDetection';
import {
  createOperatorFromDefinition,
  isSplitter,
  countSplitters,
} from '@/lib/playground/operatorFormat';

const MAX_HISTORY = 50;
const PIPELINE_STORAGE_KEY = 'playground-pipeline-state';

/**
 * Load persisted pipeline state from sessionStorage
 */
function loadPersistedState(): UnifiedOperator[] {
  try {
    // Playground operators should never reappear implicitly across launches.
    sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to load persisted pipeline state:', e);
  }
  return [];
}

/**
 * Persist pipeline state to sessionStorage
 */
function persistState(operators: UnifiedOperator[]): void {
  try {
    if (operators.length === 0) {
      sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
      return;
    }
    // Do not persist operators across refreshes/restarts.
    sessionStorage.removeItem(PIPELINE_STORAGE_KEY);
  } catch (e) {
    // sessionStorage might be full or disabled
    console.warn('Failed to persist pipeline state:', e);
  }
}

/**
 * Options for usePlaygroundPipeline
 */
export interface UsePlaygroundPipelineOptions {
  /** Sampling options for backend execution */
  sampling?: Partial<SamplingOptions>;
  /** Execution options (compute_pca, compute_umap, etc.) */
  executeOptions?: ExecuteOptions;
  /** Whether to enable backend execution */
  enableBackend?: boolean;
  /** Workspace dataset ID — when set, uses server-side dataset loading to avoid data round-trip */
  datasetId?: string | null;
  /** Selected source dataset partition for workspace-backed runs. */
  datasetPartition?: PartitionKey;
}

/**
 * Return type for usePlaygroundPipeline
 */
export interface UsePlaygroundPipelineResult {
  // Pipeline state
  operators: UnifiedOperator[];

  // Backend execution results
  result: PlaygroundResult | null;
  isProcessing: boolean;
  isFetching: boolean;
  isDebouncing: boolean;
  executionError: Error | null;

  // Pipeline operations
  addOperator: (definition: OperatorDefinition) => void;
  addOperatorByName: (name: string, type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter', params?: Record<string, unknown>) => void;
  removeOperator: (id: string) => void;
  updateOperator: (id: string, updates: Partial<UnifiedOperator>) => void;
  updateOperatorParams: (id: string, params: Record<string, unknown>) => void;
  toggleOperator: (id: string) => void;
  reorderOperators: (fromIndex: number, toIndex: number) => void;
  clearPipeline: () => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Utilities
  hasSplitter: boolean;
  splitterCount: number;
  refetch: () => void;

  // Step comparison mode
  stepComparisonEnabled: boolean;
  setStepComparisonEnabled: (enabled: boolean) => void;
  activeStep: number;
  setActiveStep: (step: number) => void;
  maxSteps: number;

  // UMAP computation
  computeUmap: boolean;
  setComputeUmap: (enabled: boolean) => void;
  isUmapLoading: boolean;

  // Subset mode (OPT-3: process only a subset of samples for faster rendering)
  subsetMode: 'all' | 'visible';
  setSubsetMode: (mode: 'all' | 'visible') => void;

  // Granular chart loading states
  chartLoadingStates: PerChartLoadingState;
}

/**
 * Hook for managing playground pipeline with backend integration
 *
 * @param rawData - Spectral data to process
 * @param options - Pipeline options
 * @returns Pipeline state and operations
 */
export function usePlaygroundPipeline(
  rawData: SpectralData | null,
  options: UsePlaygroundPipelineOptions = {}
): UsePlaygroundPipelineResult {
  const {
    sampling,
    executeOptions: externalExecuteOptions,
    enableBackend = true,
    datasetId,
    datasetPartition,
  } = options;

  const initialOperators = useMemo(() => loadPersistedState(), []);

  // Pipeline state - initialize from sessionStorage
  const [operators, setOperatorsRaw] = useState<UnifiedOperator[]>(() => [...initialOperators]);
  const [history, setHistory] = useState<UnifiedOperator[][]>(() => [[...initialOperators]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const operatorsRef = useRef<UnifiedOperator[]>([...initialOperators]);
  const historyRef = useRef<UnifiedOperator[][]>([[...initialOperators]]);
  const historyIndexRef = useRef(0);

  // UMAP computation state
  const [computeUmap, setComputeUmap] = useState(externalExecuteOptions?.compute_umap ?? false);

  // Subset mode — OPT-3: process only a visible subset of samples for faster rendering
  const [subsetMode, setSubsetMode] = useState<'all' | 'visible'>('all');

  // Wrapper to persist state on every change
  const setOperators = useCallback((newOperators: UnifiedOperator[]) => {
    operatorsRef.current = newOperators;
    setOperatorsRaw(newOperators);
    persistState(newOperators);
  }, []);

  // Step comparison mode state
  const [stepComparisonEnabled, setStepComparisonEnabledRaw] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Count enabled operators for max steps
  const enabledOperators = useMemo(
    () => operators.filter(op => op.enabled),
    [operators]
  );
  const maxSteps = enabledOperators.length;

  // Disable step comparison mode when no operators exist (raw data mode)
  const setStepComparisonEnabled = useCallback((enabled: boolean) => {
    // Only allow enabling if there are operators
    if (enabled && maxSteps === 0) {
      return;
    }
    setStepComparisonEnabledRaw(enabled);
  }, [maxSteps]);

  // Auto-disable step comparison if all operators are removed
  useEffect(() => {
    if (maxSteps === 0 && stepComparisonEnabled) {
      setStepComparisonEnabledRaw(false);
    }
  }, [maxSteps, stepComparisonEnabled]);

  // Compute effective operators based on step comparison mode
  const effectiveOperators = useMemo(() => {
    if (!stepComparisonEnabled || activeStep >= maxSteps) {
      return operators;
    }
    // Slice to include only operators up to activeStep
    const enabledSlice = enabledOperators.slice(0, activeStep);
    const enabledIds = new Set(enabledSlice.map(op => op.id));

    // Return operators with non-included ones disabled
    return operators.map(op => ({
      ...op,
      enabled: op.enabled && enabledIds.has(op.id),
    }));
  }, [operators, stepComparisonEnabled, activeStep, maxSteps, enabledOperators]);

  // Build execute options with UMAP flag
  const executeOptions: ExecuteOptions = useMemo(() => ({
    ...externalExecuteOptions,
    compute_umap: computeUmap,
    // OPT-3: subset mode for faster processing on large datasets
    subset_mode: subsetMode,
  }), [externalExecuteOptions, computeUmap, subsetMode]);

  // Backend execution (uses effective operators for step comparison)
  const {
    result,
    isLoading,
    isFetching,
    isDebouncing,
    error: executionError,
    refetch,
  } = usePlaygroundQuery(rawData, effectiveOperators, {
    enabled: enableBackend && rawData !== null,
    sampling,
    executeOptions,
    datasetId,
    datasetPartition,
  });

  // Change detection for granular chart loading states
  const {
    chartLoadingStates,
    markStable,
  } = useChangeDetection({
    operators: effectiveOperators,
    computeUmap,
    isFetching,
    hasResult: result !== null,
  });

  // Mark state as stable when result arrives (not fetching anymore)
  useEffect(() => {
    if (!isFetching && result !== null) {
      markStable();
    }
  }, [isFetching, result, markStable]);

  // Determine if UMAP is currently loading
  // UMAP is loading if we requested it and the query is still fetching
  const isUmapLoading = computeUmap && isFetching;

  // Helper to persist operators and push a matching history entry atomically.
  const commitOperators = useCallback((newOperators: UnifiedOperator[]) => {
    setOperators(newOperators);

    const nextHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    nextHistory.push([...newOperators]);
    if (nextHistory.length > MAX_HISTORY) {
      nextHistory.shift();
    }

    historyRef.current = nextHistory;
    setHistory(nextHistory);

    const nextHistoryIndex = nextHistory.length - 1;
    historyIndexRef.current = nextHistoryIndex;
    setHistoryIndex(nextHistoryIndex);
  }, [setOperators]);

  // Count splitters
  const splitterCount = useMemo(() => countSplitters(operators), [operators]);
  const hasSplitter = splitterCount > 0;

  // Add operator from definition
  const addOperator = useCallback((definition: OperatorDefinition) => {
    const currentOperators = operatorsRef.current;
    const currentSplitterCount = countSplitters(currentOperators);

    // Check single splitter constraint
    if (definition.type === 'splitting' && currentSplitterCount > 0) {
      // Replace existing splitter instead of adding
      toast.warning('Only one splitter allowed', {
        description: 'The existing splitter will be replaced.',
      });

      // Find and replace existing splitter
      const newOperators = currentOperators.filter(op => !isSplitter(op));
      const newOperator = createOperatorFromDefinition(definition);
      newOperators.push(newOperator);
      commitOperators(newOperators);
      return;
    }

    const newOperator = createOperatorFromDefinition(definition);
    const newOperators = [...currentOperators, newOperator];
    commitOperators(newOperators);
  }, [commitOperators]);

  // Add operator by name (for presets and imports)
  const addOperatorByName = useCallback((
    name: string,
    type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter',
    params: Record<string, unknown> = {}
  ) => {
    const currentOperators = operatorsRef.current;
    const currentSplitterCount = countSplitters(currentOperators);

    // Check single splitter constraint
    if (type === 'splitting' && currentSplitterCount > 0) {
      toast.warning('Only one splitter allowed', {
        description: 'The existing splitter will be replaced.',
      });

      const newOperators = currentOperators.filter(op => !isSplitter(op));
      const newOperator: UnifiedOperator = {
        id: `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        type,
        name,
        params,
        enabled: true,
      };
      newOperators.push(newOperator);
      commitOperators(newOperators);
      return;
    }

    const newOperator: UnifiedOperator = {
      id: `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      name,
      params,
      enabled: true,
    };
    const newOperators = [...currentOperators, newOperator];
    commitOperators(newOperators);
  }, [commitOperators]);

  // Remove operator
  const removeOperator = useCallback((id: string) => {
    const newOperators = operatorsRef.current.filter(op => op.id !== id);
    commitOperators(newOperators);
  }, [commitOperators]);

  // Update operator (full update)
  const updateOperator = useCallback((id: string, updates: Partial<UnifiedOperator>) => {
    const newOperators = operatorsRef.current.map(op =>
      op.id === id ? { ...op, ...updates } : op
    );
    commitOperators(newOperators);
  }, [commitOperators]);

  // Update operator params only (common case, avoids saving full operator)
  const updateOperatorParams = useCallback((id: string, params: Record<string, unknown>) => {
    const newOperators = operatorsRef.current.map(op =>
      op.id === id ? { ...op, params: { ...op.params, ...params } } : op
    );
    commitOperators(newOperators);
  }, [commitOperators]);

  // Toggle operator enabled state
  const toggleOperator = useCallback((id: string) => {
    const newOperators = operatorsRef.current.map(op =>
      op.id === id ? { ...op, enabled: !op.enabled } : op
    );
    commitOperators(newOperators);
  }, [commitOperators]);

  // Reorder operators
  const reorderOperators = useCallback((fromIndex: number, toIndex: number) => {
    const newOperators = [...operatorsRef.current];
    const [moved] = newOperators.splice(fromIndex, 1);
    newOperators.splice(toIndex, 0, moved);
    commitOperators(newOperators);
  }, [commitOperators]);

  // Clear pipeline
  const clearPipeline = useCallback(() => {
    commitOperators([]);
  }, [commitOperators]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIndex = historyIndexRef.current - 1;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      setOperators([...historyRef.current[newIndex]]);
    }
  }, [setOperators]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const newIndex = historyIndexRef.current + 1;
      historyIndexRef.current = newIndex;
      setHistoryIndex(newIndex);
      setOperators([...historyRef.current[newIndex]]);
    }
  }, [setOperators]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  return {
    operators,
    result,
    isProcessing: isLoading,
    isFetching,
    isDebouncing,
    executionError,
    addOperator,
    addOperatorByName,
    removeOperator,
    updateOperator,
    updateOperatorParams,
    toggleOperator,
    reorderOperators,
    clearPipeline,
    undo,
    redo,
    canUndo,
    canRedo,
    hasSplitter,
    splitterCount,
    refetch,
    // Step comparison mode
    stepComparisonEnabled,
    setStepComparisonEnabled,
    activeStep,
    setActiveStep,
    maxSteps,
    // UMAP computation
    computeUmap,
    setComputeUmap,
    isUmapLoading,
    // Full resolution mode

    // Subset mode
    subsetMode,
    setSubsetMode,
    // Granular chart loading states
    chartLoadingStates,
  };
}
