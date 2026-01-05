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

import { useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import type {
  UnifiedOperator,
  OperatorDefinition,
  PlaygroundResult,
  SamplingOptions,
} from '@/types/playground';
import type { SpectralData } from '@/types/spectral';
import { usePlaygroundQuery } from './usePlaygroundQuery';
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
    const stored = sessionStorage.getItem(PIPELINE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
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
    sessionStorage.setItem(PIPELINE_STORAGE_KEY, JSON.stringify(operators));
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
  /** Whether to enable backend execution */
  enableBackend?: boolean;
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
  addOperatorByName: (name: string, type: 'preprocessing' | 'splitting', params?: Record<string, unknown>) => void;
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
  const { sampling, enableBackend = true } = options;

  // Pipeline state - initialize from sessionStorage
  const [operators, setOperatorsRaw] = useState<UnifiedOperator[]>(() => loadPersistedState());
  const [history, setHistory] = useState<UnifiedOperator[][]>(() => [loadPersistedState()]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Wrapper to persist state on every change
  const setOperators = useCallback((newOperators: UnifiedOperator[]) => {
    setOperatorsRaw(newOperators);
    persistState(newOperators);
  }, []);

  // Step comparison mode state
  const [stepComparisonEnabled, setStepComparisonEnabled] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Count enabled operators for max steps
  const enabledOperators = useMemo(
    () => operators.filter(op => op.enabled),
    [operators]
  );
  const maxSteps = enabledOperators.length;

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
  });

  // Helper to save to history
  const saveToHistory = useCallback((newOperators: UnifiedOperator[]) => {
    setHistory(prev => {
      const newHistory = prev.slice(0, historyIndex + 1);
      newHistory.push([...newOperators]);
      if (newHistory.length > MAX_HISTORY) {
        newHistory.shift();
        return newHistory;
      }
      return newHistory;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
  }, [historyIndex]);

  // Count splitters
  const splitterCount = useMemo(() => countSplitters(operators), [operators]);
  const hasSplitter = splitterCount > 0;

  // Add operator from definition
  const addOperator = useCallback((definition: OperatorDefinition) => {
    // Check single splitter constraint
    if (definition.type === 'splitting' && splitterCount > 0) {
      // Replace existing splitter instead of adding
      toast.warning('Only one splitter allowed', {
        description: 'The existing splitter will be replaced.',
      });

      // Find and replace existing splitter
      const newOperators = operators.filter(op => !isSplitter(op));
      const newOperator = createOperatorFromDefinition(definition);
      newOperators.push(newOperator);
      setOperators(newOperators);
      saveToHistory(newOperators);
      return;
    }

    const newOperator = createOperatorFromDefinition(definition);
    const newOperators = [...operators, newOperator];
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, splitterCount, saveToHistory]);

  // Add operator by name (for presets and imports)
  const addOperatorByName = useCallback((
    name: string,
    type: 'preprocessing' | 'splitting',
    params: Record<string, unknown> = {}
  ) => {
    // Check single splitter constraint
    if (type === 'splitting' && splitterCount > 0) {
      toast.warning('Only one splitter allowed', {
        description: 'The existing splitter will be replaced.',
      });

      const newOperators = operators.filter(op => !isSplitter(op));
      const newOperator: UnifiedOperator = {
        id: `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        type,
        name,
        params,
        enabled: true,
      };
      newOperators.push(newOperator);
      setOperators(newOperators);
      saveToHistory(newOperators);
      return;
    }

    const newOperator: UnifiedOperator = {
      id: `${name}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      type,
      name,
      params,
      enabled: true,
    };
    const newOperators = [...operators, newOperator];
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, splitterCount, saveToHistory]);

  // Remove operator
  const removeOperator = useCallback((id: string) => {
    const newOperators = operators.filter(op => op.id !== id);
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  // Update operator (full update)
  const updateOperator = useCallback((id: string, updates: Partial<UnifiedOperator>) => {
    const newOperators = operators.map(op =>
      op.id === id ? { ...op, ...updates } : op
    );
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  // Update operator params only (common case, avoids saving full operator)
  const updateOperatorParams = useCallback((id: string, params: Record<string, unknown>) => {
    const newOperators = operators.map(op =>
      op.id === id ? { ...op, params: { ...op.params, ...params } } : op
    );
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  // Toggle operator enabled state
  const toggleOperator = useCallback((id: string) => {
    const newOperators = operators.map(op =>
      op.id === id ? { ...op, enabled: !op.enabled } : op
    );
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  // Reorder operators
  const reorderOperators = useCallback((fromIndex: number, toIndex: number) => {
    const newOperators = [...operators];
    const [moved] = newOperators.splice(fromIndex, 1);
    newOperators.splice(toIndex, 0, moved);
    setOperators(newOperators);
    saveToHistory(newOperators);
  }, [operators, saveToHistory]);

  // Clear pipeline
  const clearPipeline = useCallback(() => {
    setOperators([]);
    saveToHistory([]);
  }, [saveToHistory]);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setOperators([...history[newIndex]]);
    }
  }, [history, historyIndex]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setOperators([...history[newIndex]]);
    }
  }, [history, historyIndex]);

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
  };
}
