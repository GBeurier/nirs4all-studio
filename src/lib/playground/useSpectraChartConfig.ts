/**
 * useSpectraChartConfig - React hook for SpectraChart configuration management
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Provides centralized state management for SpectraChart configuration
 * with session storage persistence and optimized update callbacks.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  type SpectraChartConfig,
  type SpectraViewMode,
  type OverlayStyle,
  type SubsetMode,
  type SamplingConfig,
  type AggregationConfig,
  type WavelengthFocusConfig,
  type SpectraFilterConfig,
  type AggregationMode,
  type SamplingStrategy,
  type PartitionFilter,
  DEFAULT_SPECTRA_CHART_CONFIG,
  serializeConfig,
  deserializeConfig,
} from './spectraConfig';

const STORAGE_KEY = 'playground-spectra-chart-config';

/**
 * Options for useSpectraChartConfig hook
 */
export interface UseSpectraChartConfigOptions {
  /** Initial configuration (merged with defaults) */
  initialConfig?: Partial<SpectraChartConfig>;
  /** Whether to persist to session storage */
  persist?: boolean;
  /** Callback when config changes */
  onChange?: (config: SpectraChartConfig) => void;
}

/**
 * Return type for useSpectraChartConfig hook
 */
export interface UseSpectraChartConfigResult {
  // Current configuration
  config: SpectraChartConfig;

  // Bulk update
  updateConfig: (updates: Partial<SpectraChartConfig>) => void;
  resetConfig: () => void;

  // View mode
  setViewMode: (mode: SpectraViewMode) => void;
  setOverlayStyle: (style: OverlayStyle) => void;

  // Subset mode
  setSubsetMode: (mode: SubsetMode) => void;

  // Sampling
  setSamplingStrategy: (strategy: SamplingStrategy) => void;
  setSampleCount: (count: number) => void;
  updateSampling: (updates: Partial<SamplingConfig>) => void;

  // Aggregation
  setAggregationMode: (mode: AggregationMode) => void;
  setAutoThreshold: (threshold: number) => void;
  updateAggregation: (updates: Partial<AggregationConfig>) => void;

  // Wavelength focus
  setWavelengthRange: (range: [number, number] | null) => void;
  setDerivative: (order: 0 | 1 | 2) => void;
  setEdgeMask: (enabled: boolean, start?: number, end?: number) => void;
  setActivePreset: (presetId: string | undefined) => void;
  updateWavelengthFocus: (updates: Partial<WavelengthFocusConfig>) => void;

  // Filters
  setPartitionFilter: (partition: PartitionFilter, foldIndex?: number) => void;
  setTargetRange: (range: [number, number] | undefined) => void;
  setQCStatus: (status: 'accepted' | 'rejected' | 'all') => void;
  updateFilters: (updates: Partial<SpectraFilterConfig>) => void;

  // Display options
  setMaxSamples: (max: number) => void;
  toggleGrid: () => void;
  toggleLegend: () => void;
  toggleTooltip: () => void;
}

/**
 * Load persisted config from session storage
 */
function loadPersistedConfig(): SpectraChartConfig | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      return deserializeConfig(stored);
    }
  } catch (e) {
    console.warn('Failed to load persisted spectra chart config:', e);
  }
  return null;
}

/**
 * Save config to session storage
 */
function persistConfig(config: SpectraChartConfig): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, serializeConfig(config));
  } catch (e) {
    console.warn('Failed to persist spectra chart config:', e);
  }
}

/**
 * Hook for managing SpectraChart configuration
 */
export function useSpectraChartConfig(
  options: UseSpectraChartConfigOptions = {}
): UseSpectraChartConfigResult {
  const { initialConfig, persist = true, onChange } = options;

  // Initialize config from storage or defaults
  const [config, setConfig] = useState<SpectraChartConfig>(() => {
    const persisted = persist ? loadPersistedConfig() : null;
    const base = persisted ?? DEFAULT_SPECTRA_CHART_CONFIG;

    if (initialConfig) {
      return {
        ...base,
        ...initialConfig,
        sampling: { ...base.sampling, ...initialConfig.sampling },
        aggregation: { ...base.aggregation, ...initialConfig.aggregation },
        wavelengthFocus: { ...base.wavelengthFocus, ...initialConfig.wavelengthFocus },
        filters: { ...base.filters, ...initialConfig.filters },
      };
    }

    return base;
  });

  // Persist on change
  useEffect(() => {
    if (persist) {
      persistConfig(config);
    }
    onChange?.(config);
  }, [config, persist, onChange]);

  // Bulk update
  const updateConfig = useCallback((updates: Partial<SpectraChartConfig>) => {
    setConfig(prev => ({
      ...prev,
      ...updates,
    }));
  }, []);

  const resetConfig = useCallback(() => {
    setConfig(DEFAULT_SPECTRA_CHART_CONFIG);
  }, []);

  // View mode setters
  const setViewMode = useCallback((mode: SpectraViewMode) => {
    setConfig(prev => ({ ...prev, viewMode: mode }));
  }, []);

  const setOverlayStyle = useCallback((style: OverlayStyle) => {
    setConfig(prev => ({ ...prev, overlayStyle: style }));
  }, []);

  // Subset mode
  const setSubsetMode = useCallback((mode: SubsetMode) => {
    setConfig(prev => ({ ...prev, subsetMode: mode }));
  }, []);

  // Sampling setters
  const setSamplingStrategy = useCallback((strategy: SamplingStrategy) => {
    setConfig(prev => ({
      ...prev,
      sampling: { ...prev.sampling, strategy },
    }));
  }, []);

  const setSampleCount = useCallback((count: number) => {
    setConfig(prev => ({
      ...prev,
      sampling: { ...prev.sampling, sampleCount: count },
    }));
  }, []);

  const updateSampling = useCallback((updates: Partial<SamplingConfig>) => {
    setConfig(prev => ({
      ...prev,
      sampling: { ...prev.sampling, ...updates },
    }));
  }, []);

  // Aggregation setters
  const setAggregationMode = useCallback((mode: AggregationMode) => {
    setConfig(prev => ({
      ...prev,
      aggregation: { ...prev.aggregation, mode },
    }));
  }, []);

  const setAutoThreshold = useCallback((threshold: number) => {
    setConfig(prev => ({
      ...prev,
      aggregation: { ...prev.aggregation, autoThreshold: threshold },
    }));
  }, []);

  const updateAggregation = useCallback((updates: Partial<AggregationConfig>) => {
    setConfig(prev => ({
      ...prev,
      aggregation: { ...prev.aggregation, ...updates },
    }));
  }, []);

  // Wavelength focus setters
  const setWavelengthRange = useCallback((range: [number, number] | null) => {
    setConfig(prev => ({
      ...prev,
      wavelengthFocus: { ...prev.wavelengthFocus, range, activePreset: undefined },
    }));
  }, []);

  const setDerivative = useCallback((order: 0 | 1 | 2) => {
    setConfig(prev => ({
      ...prev,
      wavelengthFocus: { ...prev.wavelengthFocus, derivative: order },
    }));
  }, []);

  const setEdgeMask = useCallback((enabled: boolean, start?: number, end?: number) => {
    setConfig(prev => ({
      ...prev,
      wavelengthFocus: {
        ...prev.wavelengthFocus,
        edgeMask: {
          enabled,
          start: start ?? prev.wavelengthFocus.edgeMask.start,
          end: end ?? prev.wavelengthFocus.edgeMask.end,
        },
      },
    }));
  }, []);

  const setActivePreset = useCallback((presetId: string | undefined) => {
    setConfig(prev => ({
      ...prev,
      wavelengthFocus: { ...prev.wavelengthFocus, activePreset: presetId },
    }));
  }, []);

  const updateWavelengthFocus = useCallback((updates: Partial<WavelengthFocusConfig>) => {
    setConfig(prev => ({
      ...prev,
      wavelengthFocus: { ...prev.wavelengthFocus, ...updates },
    }));
  }, []);

  // Filter setters
  const setPartitionFilter = useCallback((partition: PartitionFilter, foldIndex?: number) => {
    setConfig(prev => ({
      ...prev,
      filters: { ...prev.filters, partition, foldIndex },
    }));
  }, []);

  const setTargetRange = useCallback((range: [number, number] | undefined) => {
    setConfig(prev => ({
      ...prev,
      filters: { ...prev.filters, targetRange: range },
    }));
  }, []);

  const setQCStatus = useCallback((status: 'accepted' | 'rejected' | 'all') => {
    setConfig(prev => ({
      ...prev,
      filters: { ...prev.filters, qcStatus: status },
    }));
  }, []);

  const updateFilters = useCallback((updates: Partial<SpectraFilterConfig>) => {
    setConfig(prev => ({
      ...prev,
      filters: { ...prev.filters, ...updates },
    }));
  }, []);

  // Display option setters
  const setMaxSamples = useCallback((max: number) => {
    setConfig(prev => ({ ...prev, maxSamples: max }));
  }, []);

  const toggleGrid = useCallback(() => {
    setConfig(prev => ({ ...prev, showGrid: !prev.showGrid }));
  }, []);

  const toggleLegend = useCallback(() => {
    setConfig(prev => ({ ...prev, showLegend: !prev.showLegend }));
  }, []);

  const toggleTooltip = useCallback(() => {
    setConfig(prev => ({ ...prev, showTooltip: !prev.showTooltip }));
  }, []);

  return useMemo(() => ({
    config,
    updateConfig,
    resetConfig,
    setViewMode,
    setOverlayStyle,
    setSubsetMode,
    setSamplingStrategy,
    setSampleCount,
    updateSampling,
    setAggregationMode,
    setAutoThreshold,
    updateAggregation,
    setWavelengthRange,
    setDerivative,
    setEdgeMask,
    setActivePreset,
    updateWavelengthFocus,
    setPartitionFilter,
    setTargetRange,
    setQCStatus,
    updateFilters,
    setMaxSamples,
    toggleGrid,
    toggleLegend,
    toggleTooltip,
  }), [
    config,
    updateConfig,
    resetConfig,
    setViewMode,
    setOverlayStyle,
    setSubsetMode,
    setSamplingStrategy,
    setSampleCount,
    updateSampling,
    setAggregationMode,
    setAutoThreshold,
    updateAggregation,
    setWavelengthRange,
    setDerivative,
    setEdgeMask,
    setActivePreset,
    updateWavelengthFocus,
    setPartitionFilter,
    setTargetRange,
    setQCStatus,
    updateFilters,
    setMaxSamples,
    toggleGrid,
    toggleLegend,
    toggleTooltip,
  ]);
}
