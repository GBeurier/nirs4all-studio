/**
 * React hook for managing global color configuration state
 *
 * Features:
 * - Type-safe state management for GlobalColorConfig
 * - Session storage persistence (survives page refresh within session)
 * - Memoized update functions for each property
 * - Automatic metadata type detection
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  GlobalColorConfig,
  GlobalColorMode,
  ContinuousPalette,
  CategoricalPalette,
  DEFAULT_GLOBAL_COLOR_CONFIG,
  detectMetadataType,
} from './colorConfig';

const STORAGE_KEY = 'nirs4all_global_color_config';

/**
 * Load config from session storage
 */
function loadFromStorage(): GlobalColorConfig | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle missing fields from older versions
      return {
        ...DEFAULT_GLOBAL_COLOR_CONFIG,
        ...parsed,
      };
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

/**
 * Save config to session storage
 */
function saveToStorage(config: GlobalColorConfig): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

export interface UseGlobalColorConfigOptions {
  /** Initial configuration override */
  initialConfig?: Partial<GlobalColorConfig>;
  /** Callback when config changes */
  onConfigChange?: (config: GlobalColorConfig) => void;
  /** Metadata for auto-detecting metadata types */
  metadata?: Record<string, unknown[]>;
  /** Disable session storage persistence */
  disablePersistence?: boolean;
}

export interface UseGlobalColorConfigResult {
  /** Current color configuration */
  config: GlobalColorConfig;
  /** Update the entire configuration */
  setConfig: (config: GlobalColorConfig) => void;
  /** Update just the color mode */
  setMode: (mode: GlobalColorMode) => void;
  /** Update metadata key (for metadata mode) */
  setMetadataKey: (key: string | undefined) => void;
  /** Update continuous palette */
  setContinuousPalette: (palette: ContinuousPalette) => void;
  /** Update categorical palette */
  setCategoricalPalette: (palette: CategoricalPalette) => void;
  /** Update unselected opacity */
  setUnselectedOpacity: (opacity: number) => void;
  /** Toggle highlight pinned */
  toggleHighlightPinned: () => void;
  /** Toggle selection override */
  toggleSelectionOverride: () => void;
  /** Reset to default configuration */
  resetConfig: () => void;
  /** Detected metadata type for current metadata key */
  detectedMetadataType: 'categorical' | 'continuous' | null;
}

/**
 * Hook for managing global color configuration
 */
export function useGlobalColorConfig(
  options: UseGlobalColorConfigOptions = {}
): UseGlobalColorConfigResult {
  const {
    initialConfig,
    onConfigChange,
    metadata,
    disablePersistence = false,
  } = options;

  // Initialize state from storage or defaults
  const [config, setConfigState] = useState<GlobalColorConfig>(() => {
    if (!disablePersistence) {
      const stored = loadFromStorage();
      if (stored) {
        return {
          ...stored,
          ...initialConfig,
        };
      }
    }
    return {
      ...DEFAULT_GLOBAL_COLOR_CONFIG,
      ...initialConfig,
    };
  });

  // Detect metadata type for current metadata key
  const detectedMetadataType = useMemo<'categorical' | 'continuous' | null>(() => {
    if (config.mode !== 'metadata' || !config.metadataKey || !metadata) {
      return null;
    }
    const values = metadata[config.metadataKey];
    if (!values || values.length === 0) {
      return null;
    }
    return detectMetadataType(values);
  }, [config.mode, config.metadataKey, metadata]);

  // Persist to storage when config changes
  useEffect(() => {
    if (!disablePersistence) {
      saveToStorage(config);
    }
    onConfigChange?.(config);
  }, [config, disablePersistence, onConfigChange]);

  // Update entire config
  const setConfig = useCallback((newConfig: GlobalColorConfig) => {
    setConfigState(newConfig);
  }, []);

  // Update mode
  const setMode = useCallback((mode: GlobalColorMode) => {
    setConfigState(prev => ({
      ...prev,
      mode,
      // Clear metadata key when switching away from metadata mode
      metadataKey: mode === 'metadata' ? prev.metadataKey : undefined,
      metadataType: mode === 'metadata' ? prev.metadataType : undefined,
    }));
  }, []);

  // Update metadata key
  const setMetadataKey = useCallback((key: string | undefined) => {
    setConfigState(prev => ({
      ...prev,
      metadataKey: key,
      // Auto-detect type when key changes
      metadataType: undefined,
    }));
  }, []);

  // Update continuous palette
  const setContinuousPalette = useCallback((palette: ContinuousPalette) => {
    setConfigState(prev => ({
      ...prev,
      continuousPalette: palette,
    }));
  }, []);

  // Update categorical palette
  const setCategoricalPalette = useCallback((palette: CategoricalPalette) => {
    setConfigState(prev => ({
      ...prev,
      categoricalPalette: palette,
    }));
  }, []);

  // Update unselected opacity
  const setUnselectedOpacity = useCallback((opacity: number) => {
    setConfigState(prev => ({
      ...prev,
      unselectedOpacity: Math.max(0, Math.min(1, opacity)),
    }));
  }, []);

  // Toggle highlight pinned
  const toggleHighlightPinned = useCallback(() => {
    setConfigState(prev => ({
      ...prev,
      highlightPinned: !prev.highlightPinned,
    }));
  }, []);

  // Toggle selection override
  const toggleSelectionOverride = useCallback(() => {
    setConfigState(prev => ({
      ...prev,
      selectionOverride: !prev.selectionOverride,
    }));
  }, []);

  // Reset to defaults
  const resetConfig = useCallback(() => {
    setConfigState(DEFAULT_GLOBAL_COLOR_CONFIG);
  }, []);

  return {
    config,
    setConfig,
    setMode,
    setMetadataKey,
    setContinuousPalette,
    setCategoricalPalette,
    setUnselectedOpacity,
    toggleHighlightPinned,
    toggleSelectionOverride,
    resetConfig,
    detectedMetadataType,
  };
}

export default useGlobalColorConfig;
