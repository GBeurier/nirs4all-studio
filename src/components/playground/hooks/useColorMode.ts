/**
 * useColorMode - Color configuration state for Playground charts
 *
 * Phase 1 Refactoring: Extract color mode logic from MainCanvas
 *
 * Features:
 * - Color mode state management
 * - Centralized color configuration
 * - Memoized color getters for performance
 */

import { useState, useCallback, useMemo } from 'react';
import type { ExtendedColorConfig, ExtendedColorMode } from '../visualizations/chartConfig';

// ============= Types =============

export interface UseColorModeOptions {
  /** Initial color mode */
  initialMode?: ExtendedColorMode;
  /** Whether folds are available */
  hasFolds?: boolean;
}

export interface UseColorModeResult {
  /** Current color configuration */
  colorConfig: ExtendedColorConfig;
  /** Update color configuration */
  setColorConfig: (config: ExtendedColorConfig) => void;
  /** Update just the color mode */
  setColorMode: (mode: ExtendedColorMode) => void;
  /** Available color modes based on data */
  availableModes: ExtendedColorMode[];
}

// ============= Constants =============

/** Default color configuration */
const DEFAULT_COLOR_CONFIG: ExtendedColorConfig = {
  mode: 'target',
};

// ============= Hook =============

export function useColorMode(options: UseColorModeOptions = {}): UseColorModeResult {
  const { initialMode = 'target', hasFolds = false } = options;

  const [colorConfig, setColorConfig] = useState<ExtendedColorConfig>({
    mode: initialMode,
  });

  // Update just the color mode
  const setColorMode = useCallback((mode: ExtendedColorMode) => {
    setColorConfig(prev => ({ ...prev, mode }));
  }, []);

  // Available modes based on current data
  const availableModes = useMemo<ExtendedColorMode[]>(() => {
    const modes: ExtendedColorMode[] = ['target', 'dataset'];
    if (hasFolds) {
      modes.splice(1, 0, 'fold');
    }
    return modes;
  }, [hasFolds]);

  return {
    colorConfig,
    setColorConfig,
    setColorMode,
    availableModes,
  };
}

export default useColorMode;
