/**
 * ReferenceDatasetContext - Context for managing reference dataset comparison
 *
 * Phase 6: Dataset Reference Mode
 *
 * Provides:
 * - Reference mode state (step vs dataset comparison)
 * - Reference dataset loading and processing
 * - Compatibility checking
 * - Sample alignment
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import type { SpectralData } from '@/types/spectral';
import type { PlaygroundResult, UnifiedOperator } from '@/types/playground';
import { loadWorkspaceDataset } from '@/api/playground';
import { useReferenceDatasetQuery } from '@/hooks/useReferenceDatasetQuery';
import {
  type ReferenceMode,
  type ReferenceDatasetInfo,
  type ReferenceDatasetState,
  type AlignmentMode,
  type DatasetCompatibility,
  type AlignmentResult,
  DEFAULT_REFERENCE_STATE,
  checkDatasetCompatibility,
  alignDatasets,
} from '@/lib/playground/referenceDataset';

// ============= Context Types =============

interface ReferenceDatasetContextValue extends ReferenceDatasetState {
  /** Set reference mode (step or dataset) */
  setReferenceMode: (mode: ReferenceMode) => void;
  /** Load a reference dataset from workspace */
  loadReferenceDataset: (datasetId: string, datasetName: string) => Promise<void>;
  /** Clear the reference dataset */
  clearReferenceDataset: () => void;
  /** Set alignment mode */
  setAlignmentMode: (mode: AlignmentMode) => void;
  /** Check compatibility with primary dataset */
  checkCompatibility: (primary: SpectralData) => DatasetCompatibility | null;
  /** Compute alignment with primary dataset */
  computeAlignment: (primary: SpectralData) => AlignmentResult | null;
  /** Whether reference mode is active (mode='dataset' and data loaded) */
  isReferenceActive: boolean;
  /** Whether reference dataset is being processed */
  isProcessing: boolean;
}

// ============= Context =============

const ReferenceDatasetContext = createContext<ReferenceDatasetContextValue | null>(null);

// ============= Provider =============

interface ReferenceDatasetProviderProps {
  children: ReactNode;
  /** Primary dataset for compatibility checking */
  primaryData?: SpectralData | null;
  /** Pipeline operators for reference processing */
  operators?: UnifiedOperator[];
}

export function ReferenceDatasetProvider({
  children,
  primaryData,
  operators = [],
}: ReferenceDatasetProviderProps) {
  const [state, setState] = useState<ReferenceDatasetState>(DEFAULT_REFERENCE_STATE);

  // Process reference dataset through pipeline
  const {
    result: queryResult,
    isLoading: isProcessing,
    error: queryError,
  } = useReferenceDatasetQuery(state.referenceData, operators, {
    enabled: state.mode === 'dataset' && state.referenceData !== null && state.compatibility?.compatible === true,
  });

  // Update referenceResult when query completes
  useEffect(() => {
    if (queryResult) {
      setState(prev => ({ ...prev, referenceResult: queryResult }));
    }
  }, [queryResult]);

  // Update error from query (also clear error when query succeeds or is not active)
  useEffect(() => {
    if (queryError) {
      setState(prev => ({
        ...prev,
        error: queryError.message || 'Failed to process reference dataset',
      }));
    } else if (queryResult) {
      // Clear error if query succeeded
      setState(prev => prev.error && prev.error.includes('process') ? { ...prev, error: null } : prev);
    }
  }, [queryError, queryResult]);

  // Recompute compatibility when primaryData becomes available or changes
  useEffect(() => {
    if (primaryData && state.referenceData && !state.compatibility) {
      const compatibility = checkDatasetCompatibility(primaryData, state.referenceData);
      let alignment: AlignmentResult | null = null;
      if (compatibility.compatible) {
        alignment = alignDatasets(primaryData, state.referenceData, state.alignmentMode);
      }
      setState(prev => ({ ...prev, compatibility, alignment }));
    }
  }, [primaryData, state.referenceData, state.compatibility, state.alignmentMode]);

  // Set reference mode
  const setReferenceMode = useCallback((mode: ReferenceMode) => {
    setState(prev => ({
      ...prev,
      mode,
      // Clear reference data when switching to step mode
      ...(mode === 'step' ? {
        referenceInfo: null,
        referenceData: null,
        referenceResult: null,
        compatibility: null,
        alignment: null,
        error: null,
      } : {}),
    }));
  }, []);

  // Load reference dataset
  const loadReferenceDataset = useCallback(async (datasetId: string, datasetName: string) => {
    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      referenceInfo: { datasetId, datasetName },
    }));

    try {
      const data = await loadWorkspaceDataset(datasetId, datasetName);

      // Check compatibility with primary if available
      let compatibility: DatasetCompatibility | null = null;
      let alignment: AlignmentResult | null = null;

      if (primaryData) {
        compatibility = checkDatasetCompatibility(primaryData, data);

        // Only compute alignment if compatible
        if (compatibility.compatible) {
          alignment = alignDatasets(primaryData, data, state.alignmentMode);
        }
      }

      setState(prev => ({
        ...prev,
        referenceData: data,
        isLoading: false,
        error: null,
        compatibility,
        alignment,
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load reference dataset',
        referenceData: null,
        referenceResult: null,
        compatibility: null,
        alignment: null,
      }));
    }
  }, [primaryData, state.alignmentMode]);

  // Clear reference dataset
  const clearReferenceDataset = useCallback(() => {
    setState(prev => ({
      ...prev,
      referenceInfo: null,
      referenceData: null,
      referenceResult: null,
      compatibility: null,
      alignment: null,
      error: null,
    }));
  }, []);

  // Set alignment mode
  const setAlignmentMode = useCallback((mode: AlignmentMode) => {
    setState(prev => {
      // Recompute alignment if we have both datasets
      let alignment: AlignmentResult | null = null;
      if (primaryData && prev.referenceData && prev.compatibility?.compatible) {
        alignment = alignDatasets(primaryData, prev.referenceData, mode);
      }
      return { ...prev, alignmentMode: mode, alignment };
    });
  }, [primaryData]);

  // Check compatibility with primary dataset
  const checkCompatibility = useCallback((primary: SpectralData): DatasetCompatibility | null => {
    if (!state.referenceData) return null;
    const compatibility = checkDatasetCompatibility(primary, state.referenceData);
    setState(prev => ({ ...prev, compatibility }));
    return compatibility;
  }, [state.referenceData]);

  // Compute alignment
  const computeAlignment = useCallback((primary: SpectralData): AlignmentResult | null => {
    if (!state.referenceData || !state.compatibility?.compatible) return null;
    const alignment = alignDatasets(primary, state.referenceData, state.alignmentMode);
    setState(prev => ({ ...prev, alignment }));
    return alignment;
  }, [state.referenceData, state.compatibility, state.alignmentMode]);

  // Whether reference mode is active
  const isReferenceActive = useMemo(() => {
    return state.mode === 'dataset' && state.referenceData !== null;
  }, [state.mode, state.referenceData]);

  // Context value
  const value = useMemo<ReferenceDatasetContextValue>(() => ({
    ...state,
    setReferenceMode,
    loadReferenceDataset,
    clearReferenceDataset,
    setAlignmentMode,
    checkCompatibility,
    computeAlignment,
    isReferenceActive,
    isProcessing,
  }), [
    state,
    setReferenceMode,
    loadReferenceDataset,
    clearReferenceDataset,
    setAlignmentMode,
    checkCompatibility,
    computeAlignment,
    isReferenceActive,
    isProcessing,
  ]);

  return (
    <ReferenceDatasetContext.Provider value={value}>
      {children}
    </ReferenceDatasetContext.Provider>
  );
}

// ============= Hook =============

/**
 * Hook to access reference dataset context
 * @throws Error if used outside of ReferenceDatasetProvider
 */
export function useReferenceDataset(): ReferenceDatasetContextValue {
  const context = useContext(ReferenceDatasetContext);
  if (!context) {
    throw new Error('useReferenceDataset must be used within a ReferenceDatasetProvider');
  }
  return context;
}

/**
 * Hook to optionally access reference dataset context
 * Returns null if not within ReferenceDatasetProvider
 */
export function useReferenceDatasetOptional(): ReferenceDatasetContextValue | null {
  return useContext(ReferenceDatasetContext);
}

// ============= Re-exports =============

export type {
  ReferenceMode,
  ReferenceDatasetInfo,
  ReferenceDatasetState,
  AlignmentMode,
  DatasetCompatibility,
  AlignmentResult,
};
