/**
 * useChangeDetection - Hook for granular chart loading state management
 *
 * Tracks what changed in the playground pipeline (preprocessing, splitting, UMAP)
 * and provides per-chart loading states so only affected charts show spinners.
 */

import { useRef, useMemo, useCallback } from 'react';
import { computeCategoryHashes, type CategoryHashes } from '@/lib/playground/hashing';
import type { UnifiedOperator, ChangeCategory, PerChartLoadingState } from '@/types/playground';

/**
 * Options for useChangeDetection
 */
export interface UseChangeDetectionOptions {
  /** Current pipeline operators */
  operators: UnifiedOperator[];
  /** Whether UMAP computation is enabled */
  computeUmap: boolean;
  /** Whether currently fetching data */
  isFetching: boolean;
  /** Whether there's an existing result (not initial load) */
  hasResult: boolean;
}

/**
 * Result from useChangeDetection
 */
export interface UseChangeDetectionResult {
  /** Categories that changed since last stable state */
  changedCategories: Set<ChangeCategory>;
  /** Per-chart loading states */
  chartLoadingStates: PerChartLoadingState;
  /** Mark current state as stable (call when data arrives) */
  markStable: () => void;
  /** Whether any chart is loading */
  isAnyLoading: boolean;
}

/**
 * Previous state for change detection
 */
interface PreviousState {
  dataTransform: string;
  splitting: string;
  filter: string;
  embedding: boolean;
  initialized: boolean;
}

/**
 * Chart loading state with all charts not loading
 */
const NO_LOADING: PerChartLoadingState = {
  spectra: false,
  histogram: false,
  pca: false,
  folds: false,
  repetitions: false,
};

/**
 * Chart loading state with all charts loading
 */
const ALL_LOADING: PerChartLoadingState = {
  spectra: true,
  histogram: true,
  pca: true,
  folds: true,
  repetitions: true,
};

/**
 * Hook to detect what changed in the pipeline and provide per-chart loading states
 *
 * @param options - Configuration options
 * @returns Change detection result with per-chart loading states
 */
export function useChangeDetection({
  operators,
  computeUmap,
  isFetching,
  hasResult,
}: UseChangeDetectionOptions): UseChangeDetectionResult {
  // Track previous state using ref to persist across renders
  const prevStateRef = useRef<PreviousState>({
    dataTransform: '',
    splitting: '',
    filter: '',
    embedding: false,
    initialized: false,
  });

  // Compute current category hashes
  const currentHashes = useMemo<CategoryHashes>(
    () => computeCategoryHashes(operators),
    [operators]
  );

  // Detect what changed
  const changedCategories = useMemo(() => {
    const prev = prevStateRef.current;
    const changes = new Set<ChangeCategory>();

    // Initial state - no changes detected yet
    if (!prev.initialized) {
      return changes;
    }

    // Check each category for changes
    if (prev.dataTransform !== currentHashes.dataTransform) {
      changes.add('data_transform');
    }
    if (prev.splitting !== currentHashes.splitting) {
      changes.add('splitting');
    }
    if (prev.filter !== currentHashes.filter) {
      changes.add('filter');
    }
    if (prev.embedding !== computeUmap) {
      changes.add('embedding');
    }

    // If filter changed, treat as 'all' since it affects sample count
    if (changes.has('filter')) {
      return new Set<ChangeCategory>(['all']);
    }

    // If multiple categories changed, use 'all'
    if (changes.size > 1) {
      return new Set<ChangeCategory>(['all']);
    }

    return changes;
  }, [currentHashes, computeUmap]);

  // Map change categories to affected charts
  const chartLoadingStates = useMemo<PerChartLoadingState>(() => {
    // Not fetching - nothing is loading
    if (!isFetching) {
      return NO_LOADING;
    }

    // Initial load (no result yet) - all charts loading
    if (!hasResult) {
      return ALL_LOADING;
    }

    // No detected changes but still fetching - don't show loading
    // This happens when markStable() updates the ref but isFetching hasn't settled yet
    if (changedCategories.size === 0) {
      return NO_LOADING;
    }

    // 'all' category - all charts loading
    if (changedCategories.has('all')) {
      return ALL_LOADING;
    }

    // Map specific categories to affected charts
    return {
      spectra: changedCategories.has('data_transform'),
      histogram: changedCategories.has('data_transform'),
      pca: changedCategories.has('data_transform') || changedCategories.has('embedding'),
      folds: changedCategories.has('splitting'),
      repetitions: changedCategories.has('data_transform'),
    };
  }, [isFetching, hasResult, changedCategories]);

  // Mark current state as stable (called when data arrives)
  const markStable = useCallback(() => {
    prevStateRef.current = {
      dataTransform: currentHashes.dataTransform,
      splitting: currentHashes.splitting,
      filter: currentHashes.filter,
      embedding: computeUmap,
      initialized: true,
    };
  }, [currentHashes, computeUmap]);

  // Check if any chart is loading
  const isAnyLoading = useMemo(
    () => Object.values(chartLoadingStates).some(Boolean),
    [chartLoadingStates]
  );

  return {
    changedCategories,
    chartLoadingStates,
    markStable,
    isAnyLoading,
  };
}
