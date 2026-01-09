/**
 * usePlaygroundReset - Reset all playground state to defaults
 *
 * Phase 8: Global Actions & Export Enhancements
 *
 * Resets:
 * - Selection (clear all selected samples)
 * - Pins (clear all pinned samples)
 * - Display filters (outlier, selection, metadata)
 * - Color configuration
 * - Step comparison state
 * - User-marked outliers
 */

import { useCallback } from 'react';
import { useSelection } from '@/context/SelectionContext';
import { useFilterOptional } from '@/context/FilterContext';
import { useOutliersOptional } from '@/context/OutliersContext';
import { DEFAULT_GLOBAL_COLOR_CONFIG, type GlobalColorConfig } from '@/lib/playground/colorConfig';

export interface PlaygroundResetCallbacks {
  /** Reset color configuration to defaults */
  onResetColorConfig?: (config: GlobalColorConfig) => void;
  /** Reset step comparison */
  onResetStepComparison?: () => void;
  /** Reset brush/zoom domain */
  onResetZoom?: () => void;
  /** Custom callback after reset */
  onAfterReset?: () => void;
}

export interface UsePlaygroundResetResult {
  /** Reset all playground state */
  resetPlayground: () => void;
  /** Check if there's anything to reset */
  hasStateToReset: boolean;
}

/**
 * Hook providing playground reset functionality
 */
export function usePlaygroundReset(
  callbacks: PlaygroundResetCallbacks = {}
): UsePlaygroundResetResult {
  const {
    onResetColorConfig,
    onResetStepComparison,
    onResetZoom,
    onAfterReset,
  } = callbacks;

  // Selection context
  const {
    clear: clearSelection,
    clearPins,
    selectedCount,
    pinnedCount,
  } = useSelection();

  // Filter context (optional - may not be in provider)
  const filterContext = useFilterOptional();

  // Outliers context (optional)
  const outliersContext = useOutliersOptional();

  // Check if there's anything to reset
  const hasStateToReset =
    selectedCount > 0 ||
    pinnedCount > 0 ||
    (filterContext?.hasActiveFilters ?? false) ||
    (outliersContext?.hasManualOutliers ?? false);

  // Reset all state
  const resetPlayground = useCallback(() => {
    // Clear selection
    clearSelection();

    // Clear pins
    clearPins();

    // Clear display filters
    filterContext?.clearAllFilters();

    // Clear user-marked outliers
    outliersContext?.clearManualOutliers();

    // Reset color config to defaults
    onResetColorConfig?.(DEFAULT_GLOBAL_COLOR_CONFIG);

    // Reset step comparison
    onResetStepComparison?.();

    // Reset zoom/brush
    onResetZoom?.();

    // Fire after-reset callback
    onAfterReset?.();
  }, [
    clearSelection,
    clearPins,
    filterContext,
    outliersContext,
    onResetColorConfig,
    onResetStepComparison,
    onResetZoom,
    onAfterReset,
  ]);

  return {
    resetPlayground,
    hasStateToReset,
  };
}

export default usePlaygroundReset;
