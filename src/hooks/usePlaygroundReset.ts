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
 * - User-marked outliers
 */

import { useCallback } from 'react';
import { useSelection } from '@/context/useSelection';
import { useFilterOptional } from '@/context/useFilter';
import { useOutliersOptional } from '@/context/useOutliers';
import { DEFAULT_GLOBAL_COLOR_CONFIG, type GlobalColorConfig } from '@/lib/playground/colorConfig';

export interface PlaygroundResetCallbacks {
  /** Reset color configuration to defaults */
  onResetColorConfig?: (config: GlobalColorConfig) => void;
  /** Reset brush/zoom domain */
  onResetZoom?: () => void;
  /** Custom callback after reset */
  onAfterReset?: () => void;
}

export interface UsePlaygroundResetResult {
  /** Reset all playground state */
  resetPlayground: () => void;
}

/**
 * Hook providing playground reset functionality
 */
export function usePlaygroundReset(
  callbacks: PlaygroundResetCallbacks = {}
): UsePlaygroundResetResult {
  const {
    onResetColorConfig,
    onResetZoom,
    onAfterReset,
  } = callbacks;

  // Selection context
  const {
    clear: clearSelection,
    clearPins,
  } = useSelection();

  // Filter context (optional - may not be in provider)
  const filterContext = useFilterOptional();

  // Outliers context (optional)
  const outliersContext = useOutliersOptional();

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
    onResetZoom,
    onAfterReset,
  ]);

  return {
    resetPlayground,
  };
}

export default usePlaygroundReset;
