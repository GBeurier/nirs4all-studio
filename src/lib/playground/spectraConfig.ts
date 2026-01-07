/**
 * SpectraChart Configuration Types and Utilities
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Provides centralized configuration for the SpectraChart component,
 * including view modes, sampling strategies, aggregation modes,
 * and wavelength focus settings.
 */

// ============= View Mode Types =============

/**
 * View mode determines which data to display
 */
export type SpectraViewMode = 'processed' | 'original' | 'both' | 'difference';

/**
 * Overlay style when showing both original and processed
 */
export type OverlayStyle = 'opacity' | 'dashed' | 'desaturated';

/**
 * Subset mode determines which samples to show
 */
export type SubsetMode = 'all' | 'sampled' | 'selected' | 'filtered';

/**
 * Display mode for individual spectra vs aggregated
 */
export type SpectraDisplayMode = 'individual' | 'selected_only' | 'aggregated' | 'grouped';

/**
 * Color mode for spectra visualization
 */
export type SpectraColorMode = 'target' | 'fold' | 'partition' | 'metadata' | 'selection' | 'outlier';

/**
 * Coloring configuration for spectra
 */
export interface SpectraColorConfig {
  /** Primary color mode */
  mode: SpectraColorMode;
  /** Metadata column key for 'metadata' mode */
  metadataKey?: string;
  /** Custom color palette name */
  palette?: string;
  /** Opacity for non-highlighted samples */
  unselectedOpacity: number;
  /** Whether to show pinned samples with distinct style */
  highlightPinned: boolean;
}

/**
 * Default spectra color configuration
 */
export const DEFAULT_SPECTRA_COLOR_CONFIG: SpectraColorConfig = {
  mode: 'target',
  unselectedOpacity: 0.25,
  highlightPinned: true,
};

/**
 * Reference step configuration for "before" view
 */
export interface ReferenceStepConfig {
  /** Step index (0 = raw, 1 = after first operator, etc.) */
  stepIndex: number;
  /** Step label for display */
  label: string;
}

/**
 * Current step configuration for "after" view
 */
export interface CurrentStepConfig {
  /** Step index (-1 = final output, or specific step) */
  stepIndex: number;
  /** Step label for display */
  label: string;
}

// ============= Sampling Strategy Types =============

/**
 * Sampling strategies for large datasets
 */
export type SamplingStrategy = 'random' | 'stratified' | 'coverage' | 'progressive';

/**
 * Configuration for sampling strategy
 */
export interface SamplingConfig {
  strategy: SamplingStrategy;
  /** Number of samples to display (for random/stratified) */
  sampleCount: number;
  /** Progressive level-of-detail thresholds */
  progressiveLevels?: number[];
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Default sampling configuration
 */
export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  strategy: 'random',
  sampleCount: 50,
  progressiveLevels: [50, 200, 1000],
  seed: 42,
};

// ============= Aggregation Mode Types =============

/**
 * Aggregation mode for summarizing spectra
 */
export type AggregationMode = 'none' | 'mean_std' | 'median_quantiles' | 'minmax' | 'density';

/**
 * Configuration for aggregation display
 */
export interface AggregationConfig {
  mode: AggregationMode;
  /** Auto-switch to aggregation above this sample count */
  autoThreshold: number;
  /** Quantile range for median_quantiles mode (default: [0.05, 0.95]) */
  quantileRange?: [number, number];
  /** Group by metadata field for grouped aggregates */
  groupBy?: string;
  /** Whether to show individual lines behind aggregation */
  showIndividualLines?: boolean;
}

/**
 * Default aggregation configuration
 */
export const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
  mode: 'none',
  autoThreshold: 200,
  quantileRange: [0.05, 0.95],
  showIndividualLines: false,
};

// ============= Wavelength Focus Types =============

/**
 * Predefined NIR region of interest
 */
export interface WavelengthROI {
  id: string;
  name: string;
  range: [number, number];
  description?: string;
  color?: string;
}

/**
 * Default NIR ROI presets
 */
export const NIR_ROI_PRESETS: WavelengthROI[] = [
  { id: 'full', name: 'Full Range', range: [0, Infinity], description: 'Complete spectrum' },
  { id: 'water_1', name: 'Water Band I', range: [1400, 1500], description: 'O-H first overtone', color: 'hsl(200, 70%, 50%)' },
  { id: 'water_2', name: 'Water Band II', range: [1900, 2050], description: 'O-H combination', color: 'hsl(200, 70%, 45%)' },
  { id: 'protein', name: 'Protein Region', range: [2050, 2200], description: 'N-H/C=O absorption', color: 'hsl(350, 70%, 50%)' },
  { id: 'ch_stretch', name: 'C-H Stretch', range: [2300, 2400], description: 'C-H first overtone', color: 'hsl(45, 80%, 50%)' },
  { id: 'lipid', name: 'Lipid Region', range: [1700, 1800], description: 'C-H combination', color: 'hsl(120, 60%, 50%)' },
  { id: 'carb', name: 'Carbohydrate', range: [2050, 2150], description: 'Starch/cellulose', color: 'hsl(280, 60%, 50%)' },
];

/**
 * Configuration for wavelength focus
 */
export interface WavelengthFocusConfig {
  /** Selected wavelength range [start, end] in nm, null for full range */
  range: [number, number] | null;
  /** Show derivative of spectrum */
  derivative: 0 | 1 | 2;
  /** Mask edges of spectrum */
  edgeMask: {
    enabled: boolean;
    /** Number of points to mask from start */
    start: number;
    /** Number of points to mask from end */
    end: number;
  };
  /** Active ROI preset id */
  activePreset?: string;
  /** Custom saved ROIs */
  customPresets?: WavelengthROI[];
}

/**
 * Default wavelength focus configuration
 */
export const DEFAULT_WAVELENGTH_FOCUS_CONFIG: WavelengthFocusConfig = {
  range: null,
  derivative: 0,
  edgeMask: {
    enabled: false,
    start: 0,
    end: 0,
  },
};

// ============= Filter Types =============

/**
 * Partition filter options
 */
export type PartitionFilter = 'all' | 'train' | 'test' | 'fold' | 'oof';

/**
 * Spectra filter configuration
 */
export interface SpectraFilterConfig {
  /** Partition filter */
  partition: PartitionFilter;
  /** Specific fold index (when partition is 'fold') */
  foldIndex?: number;
  /** Target value range filter */
  targetRange?: [number, number];
  /** Metadata column filters */
  metadataFilters?: Record<string, unknown>;
  /** QC status filter */
  qcStatus?: 'accepted' | 'rejected' | 'all';
}

/**
 * Default filter configuration
 */
export const DEFAULT_FILTER_CONFIG: SpectraFilterConfig = {
  partition: 'all',
  qcStatus: 'all',
};

// ============= Main Configuration Type =============

/**
 * Complete SpectraChart configuration
 */
export interface SpectraChartConfig {
  // View mode
  viewMode: SpectraViewMode;
  overlayStyle: OverlayStyle;

  // Display mode (individual vs aggregated)
  displayMode: SpectraDisplayMode;

  // Color configuration
  colorConfig: SpectraColorConfig;

  // Reference step for "before" view (when in 'both' or 'difference' mode)
  referenceStep: ReferenceStepConfig;

  // Subset selection
  subsetMode: SubsetMode;
  sampling: SamplingConfig;

  // Aggregation
  aggregation: AggregationConfig;

  // Wavelength focus
  wavelengthFocus: WavelengthFocusConfig;

  // Filters
  filters: SpectraFilterConfig;

  // Display options
  maxSamples: number;
  showGrid: boolean;
  showLegend: boolean;
  showTooltip: boolean;
}

/**
 * Default SpectraChart configuration
 */
export const DEFAULT_SPECTRA_CHART_CONFIG: SpectraChartConfig = {
  viewMode: 'processed',
  overlayStyle: 'dashed',
  displayMode: 'individual',
  colorConfig: DEFAULT_SPECTRA_COLOR_CONFIG,
  referenceStep: { stepIndex: 0, label: 'Original' },
  subsetMode: 'all',
  sampling: DEFAULT_SAMPLING_CONFIG,
  aggregation: DEFAULT_AGGREGATION_CONFIG,
  wavelengthFocus: DEFAULT_WAVELENGTH_FOCUS_CONFIG,
  filters: DEFAULT_FILTER_CONFIG,
  maxSamples: 50,
  showGrid: true,
  showLegend: true,
  showTooltip: true,
};

// ============= Helper Functions =============

/**
 * Check if aggregation should be automatically enabled
 */
export function shouldAutoAggregate(
  sampleCount: number,
  config: AggregationConfig
): boolean {
  return config.mode === 'none' && sampleCount > config.autoThreshold;
}

/**
 * Get effective wavelength range considering edge masking
 */
export function getEffectiveWavelengthRange(
  wavelengths: number[],
  config: WavelengthFocusConfig
): [number, number] {
  if (wavelengths.length === 0) return [0, 0];

  let startIdx = 0;
  let endIdx = wavelengths.length - 1;

  // Apply edge masking
  if (config.edgeMask.enabled) {
    startIdx = Math.min(config.edgeMask.start, wavelengths.length - 1);
    endIdx = Math.max(0, wavelengths.length - 1 - config.edgeMask.end);
  }

  // Apply range filter if set
  if (config.range) {
    const [rangeStart, rangeEnd] = config.range;
    while (startIdx < wavelengths.length && wavelengths[startIdx] < rangeStart) {
      startIdx++;
    }
    while (endIdx >= 0 && wavelengths[endIdx] > rangeEnd) {
      endIdx--;
    }
  }

  return [wavelengths[startIdx] ?? 0, wavelengths[endIdx] ?? 0];
}

/**
 * Apply wavelength filter to spectrum data
 */
export function filterWavelengths(
  wavelengths: number[],
  spectra: number[][],
  config: WavelengthFocusConfig
): { wavelengths: number[]; spectra: number[][] } {
  const [rangeStart, rangeEnd] = getEffectiveWavelengthRange(wavelengths, config);

  const indices: number[] = [];
  wavelengths.forEach((wl, idx) => {
    if (wl >= rangeStart && wl <= rangeEnd) {
      indices.push(idx);
    }
  });

  return {
    wavelengths: indices.map(i => wavelengths[i]),
    spectra: spectra.map(spectrum => indices.map(i => spectrum[i])),
  };
}

/**
 * Compute first or second derivative of spectrum
 */
export function computeDerivative(
  spectrum: number[],
  wavelengths: number[],
  order: 1 | 2
): number[] {
  if (spectrum.length < 3) return spectrum;

  const result: number[] = [];

  if (order === 1) {
    // First derivative using central differences
    for (let i = 0; i < spectrum.length; i++) {
      if (i === 0) {
        const dw = wavelengths[1] - wavelengths[0];
        result.push((spectrum[1] - spectrum[0]) / dw);
      } else if (i === spectrum.length - 1) {
        const dw = wavelengths[i] - wavelengths[i - 1];
        result.push((spectrum[i] - spectrum[i - 1]) / dw);
      } else {
        const dw = wavelengths[i + 1] - wavelengths[i - 1];
        result.push((spectrum[i + 1] - spectrum[i - 1]) / dw);
      }
    }
  } else {
    // Second derivative
    const first = computeDerivative(spectrum, wavelengths, 1);
    return computeDerivative(first, wavelengths, 1);
  }

  return result;
}

/**
 * Serialize config to session storage
 */
export function serializeConfig(config: SpectraChartConfig): string {
  return JSON.stringify(config);
}

/**
 * Deserialize config from session storage
 */
export function deserializeConfig(json: string): SpectraChartConfig | null {
  try {
    const parsed = JSON.parse(json);
    // Merge with defaults to handle missing fields
    return {
      ...DEFAULT_SPECTRA_CHART_CONFIG,
      ...parsed,
      sampling: { ...DEFAULT_SAMPLING_CONFIG, ...parsed.sampling },
      aggregation: { ...DEFAULT_AGGREGATION_CONFIG, ...parsed.aggregation },
      wavelengthFocus: { ...DEFAULT_WAVELENGTH_FOCUS_CONFIG, ...parsed.wavelengthFocus },
      filters: { ...DEFAULT_FILTER_CONFIG, ...parsed.filters },
    };
  } catch {
    return null;
  }
}
