/**
 * Unified Color Configuration System for Playground
 *
 * Provides a single, global coloration system that applies consistently
 * across all charts (Spectra, Histogram, PCA/UMAP, Folds, Reps).
 *
 * Phase 5: Classification Support
 * - Detects regression vs classification targets
 * - Auto-selects categorical palette for classification
 * - Supports ordinal scales
 */

import { type TargetType } from './targetTypeDetection';

// ============= Type Definitions =============

/**
 * Unified color modes available across all charts
 */
export type GlobalColorMode =
  | 'target'      // Continuous gradient by Y value
  | 'partition'   // Categorical: train=blue, test=orange
  | 'fold'        // Categorical by fold index
  | 'metadata'    // Continuous or categorical based on column type
  | 'selection'   // Selected=primary, unselected=grey
  | 'outlier'     // Outliers=red (front), non-outliers=grey
  | 'index';      // Continuous gradient by sample position (0 to N-1)

/**
 * Palette types for continuous coloring
 */
export type ContinuousPalette =
  | 'blue_red'    // Current default (blue->cyan->green->yellow->red)
  | 'viridis'     // Purple->blue->green->yellow
  | 'plasma'      // Purple->pink->orange->yellow
  | 'inferno'     // Black->purple->red->yellow
  | 'coolwarm'    // Blue->white->red (diverging)
  | 'spectral'    // Red->orange->yellow->green->blue (rainbow)
  | 'cividis'     // Blue->green->yellow (colorblind-friendly)
  | 'winter'      // Blue->cyan (cool colors only)
  | 'blues'       // Light blue->dark blue (single hue)
  | 'greens'      // Light green->dark green (single hue)
  | 'turbo';      // Blue->cyan->green->yellow->red (improved rainbow)

/**
 * Palette types for categorical coloring
 */
export type CategoricalPalette =
  | 'default'     // Current FOLD_COLORS (teal, blue, green, orange, purple...)
  | 'tableau10'   // Tableau's colorblind-safe palette
  | 'set1'        // ColorBrewer Set1
  | 'set2'        // ColorBrewer Set2
  | 'paired';     // ColorBrewer Paired

/**
 * Unified global color configuration
 */
export interface GlobalColorConfig {
  /** Primary color mode */
  mode: GlobalColorMode;

  /** Metadata column key (required when mode='metadata') */
  metadataKey?: string;

  /** Whether metadata column is categorical or continuous (auto-detected if not set) */
  metadataType?: 'categorical' | 'continuous';

  /** Continuous palette selection */
  continuousPalette: ContinuousPalette;

  /** Categorical palette selection */
  categoricalPalette: CategoricalPalette;

  /** Opacity for unselected/non-highlighted samples (0-1) */
  unselectedOpacity: number;

  /** Whether to always highlight pinned samples */
  highlightPinned: boolean;

  /** Whether selection always overrides base color */
  selectionOverride: boolean;

  /** Whether to show red border/stroke for outliers in all color modes (except outlier mode) */
  showOutlierOverlay?: boolean;

  /**
   * Phase 5: Manual override for target type detection
   * When set, overrides the auto-detected target type
   * 'auto' means use detected type
   */
  targetTypeOverride?: TargetType | 'auto';
}

/**
 * Result from getUnifiedSampleColor function
 */
export interface ColorResult {
  color: string;
  opacity: number;
  stroke?: string;
  strokeWidth?: number;
  zIndex?: number;
  /** Phase 4: Whether the sample should be hidden from display */
  hidden?: boolean;
}

/**
 * Context data needed for color computation
 */
export interface ColorContext {
  // For target mode
  y?: number[];
  yMin?: number;
  yMax?: number;

  // For partition mode
  trainIndices?: Set<number>;
  testIndices?: Set<number>;

  // For fold mode
  foldLabels?: number[];

  // For metadata mode
  metadata?: Record<string, unknown[]>;

  // For outlier mode
  outlierIndices?: Set<number>;

  // For index mode
  totalSamples?: number;

  // Selection state
  selectedSamples?: Set<number>;
  pinnedSamples?: Set<number>;
  hoveredSample?: number | null;

  // Display filtering (Phase 4)
  displayFilteredIndices?: Set<number>;

  // Phase 5: Classification support
  /** Detected target type (regression, classification, ordinal) */
  targetType?: TargetType;
  /** Class labels for classification/ordinal targets */
  classLabels?: string[];
  /** Map of Y value to class index for efficient lookup */
  classLabelMap?: Map<string, number>;
}

// ============= Default Configuration =============

/**
 * Default global color configuration
 */
export const DEFAULT_GLOBAL_COLOR_CONFIG: GlobalColorConfig = {
  mode: 'target',
  continuousPalette: 'blue_red',
  categoricalPalette: 'default',
  unselectedOpacity: 0.25,
  highlightPinned: true,
  selectionOverride: true,
  showOutlierOverlay: true,
};

// ============= Palette Definitions =============

/**
 * Continuous palette color functions
 * Each returns an HSL/RGB color string for a normalized value t (0-1)
 */
export const CONTINUOUS_PALETTES: Record<ContinuousPalette, (t: number) => string> = {
  blue_red: (t) => {
    // Blue (240) -> Cyan (180) -> Green (120) -> Yellow (60) -> Red (0)
    const hue = 240 - t * 240;
    return `hsl(${hue}, 70%, 50%)`;
  },

  viridis: (t) => {
    // Approximation of viridis colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${270 - s * 30}, ${70 + s * 10}%, ${25 + s * 10}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${240 - s * 60}, ${80 - s * 10}%, ${35 + s * 10}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${180 - s * 80}, ${70 - s * 5}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${100 - s * 40}, ${65 - s * 15}%, ${55 + s * 15}%)`;
    }
  },

  plasma: (t) => {
    // Approximation of plasma colormap
    if (t < 0.33) {
      const s = t / 0.33;
      return `hsl(${280 - s * 20}, ${80 + s * 10}%, ${25 + s * 20}%)`;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      return `hsl(${260 - s * 210}, ${90 - s * 10}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.66) / 0.34;
      return `hsl(${50 - s * 10}, ${80 + s * 10}%, ${55 + s * 20}%)`;
    }
  },

  inferno: (t) => {
    // Approximation of inferno colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${280 + s * 10}, ${60 + s * 20}%, ${10 + s * 15}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${290 - s * 270}, ${80 + s * 10}%, ${25 + s * 15}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${20 + s * 20}, ${90}%, ${40 + s * 15}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${40 + s * 20}, ${90 - s * 20}%, ${55 + s * 30}%)`;
    }
  },

  coolwarm: (t) => {
    // Diverging blue-white-red
    if (t < 0.5) {
      const intensity = (0.5 - t) * 2;
      const lightness = 95 - intensity * 45;
      return `hsl(220, ${Math.round(70 * intensity)}%, ${Math.round(lightness)}%)`;
    } else {
      const intensity = (t - 0.5) * 2;
      const lightness = 95 - intensity * 45;
      return `hsl(10, ${Math.round(70 * intensity)}%, ${Math.round(lightness)}%)`;
    }
  },

  spectral: (t) => {
    // Rainbow: Red -> Orange -> Yellow -> Green -> Blue
    const hue = (1 - t) * 240;
    return `hsl(${hue}, 80%, 50%)`;
  },

  cividis: (t) => {
    // Colorblind-friendly: Navy blue -> teal -> olive -> yellow
    // Based on the matplotlib cividis colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${235 - s * 25}, ${50 + s * 20}%, ${25 + s * 10}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${210 - s * 30}, ${70 - s * 10}%, ${35 + s * 10}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${180 - s * 100}, ${60 - s * 10}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${80 - s * 30}, ${50 + s * 30}%, ${55 + s * 25}%)`;
    }
  },

  winter: (t) => {
    // Cool colors only: Blue -> Cyan -> Light Cyan
    const hue = 240 - t * 60; // 240 (blue) to 180 (cyan)
    const lightness = 40 + t * 25; // Gets lighter
    return `hsl(${hue}, 75%, ${lightness}%)`;
  },

  blues: (t) => {
    // Single hue blue: Light blue -> Dark blue
    const lightness = 90 - t * 55; // 90% (very light) to 35% (dark)
    const saturation = 60 + t * 30; // More saturated as it gets darker
    return `hsl(215, ${saturation}%, ${lightness}%)`;
  },

  greens: (t) => {
    // Single hue green: Light green -> Dark green
    const lightness = 90 - t * 55; // 90% (very light) to 35% (dark)
    const saturation = 50 + t * 40; // More saturated as it gets darker
    return `hsl(140, ${saturation}%, ${lightness}%)`;
  },

  turbo: (t) => {
    // Improved rainbow: Blue -> Cyan -> Green -> Yellow -> Orange -> Red
    // Better perceptual uniformity than jet/spectral
    if (t < 0.2) {
      const s = t / 0.2;
      return `hsl(${260 - s * 40}, ${70 + s * 20}%, ${35 + s * 15}%)`;
    } else if (t < 0.4) {
      const s = (t - 0.2) / 0.2;
      return `hsl(${220 - s * 40}, ${90}%, ${50 + s * 5}%)`;
    } else if (t < 0.6) {
      const s = (t - 0.4) / 0.2;
      return `hsl(${180 - s * 60}, ${85}%, ${55 - s * 5}%)`;
    } else if (t < 0.8) {
      const s = (t - 0.6) / 0.2;
      return `hsl(${120 - s * 70}, ${80 + s * 10}%, ${50}%)`;
    } else {
      const s = (t - 0.8) / 0.2;
      return `hsl(${50 - s * 45}, ${90}%, ${50 - s * 5}%)`;
    }
  },
};

/**
 * Categorical palette color arrays
 * Colorblind-safe palettes from ColorBrewer and Tableau
 */
export const CATEGORICAL_PALETTES: Record<CategoricalPalette, readonly string[]> = {
  default: [
    'hsl(173, 80%, 45%)', // Teal
    'hsl(217, 70%, 50%)', // Blue
    'hsl(142, 76%, 45%)', // Green
    'hsl(38, 92%, 50%)',  // Orange
    'hsl(280, 65%, 55%)', // Purple
    'hsl(350, 70%, 55%)', // Red
    'hsl(200, 70%, 45%)', // Cyan
    'hsl(95, 60%, 45%)',  // Lime
    'hsl(320, 60%, 55%)', // Magenta
    'hsl(55, 80%, 45%)',  // Yellow
  ],

  tableau10: [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  ],

  set1: [
    '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
    '#ffff33', '#a65628', '#f781bf', '#999999',
  ],

  set2: [
    '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854',
    '#ffd92f', '#e5c494', '#b3b3b3',
  ],

  paired: [
    '#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99',
    '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a',
  ],
};

/**
 * Fixed colors for train/test partition
 */
export const PARTITION_COLORS = {
  train: 'hsl(217, 70%, 50%)',      // Blue
  test: 'hsl(38, 92%, 50%)',        // Orange
  trainLight: 'hsl(217, 70%, 75%)',
  testLight: 'hsl(38, 92%, 75%)',
} as const;

/**
 * Fixed colors for selection/outlier modes
 * NOTE: Some of these use CSS variables which work in SVG/CSS but not in WebGL/canvas
 */
export const HIGHLIGHT_COLORS = {
  selected: 'hsl(var(--primary))',
  hovered: 'hsl(var(--primary))',
  pinned: 'hsl(45, 90%, 50%)',      // Gold
  outlier: 'hsl(0, 70%, 55%)',      // Red
  unselected: 'hsl(var(--muted-foreground))',
  muted: 'hsl(var(--muted-foreground) / 0.3)',
} as const;

/**
 * Concrete color alternatives for WebGL/canvas renderers that can't parse CSS variables
 * These match the theme's typical primary/muted colors
 */
export const HIGHLIGHT_COLORS_CONCRETE = {
  selected: 'hsl(173, 80%, 45%)',   // Teal (matches --primary in default theme)
  hovered: 'hsl(173, 80%, 45%)',    // Teal
  pinned: 'hsl(45, 90%, 50%)',      // Gold
  outlier: 'hsl(0, 70%, 55%)',      // Red
  unselected: 'hsl(220, 10%, 50%)', // Muted gray
  muted: 'hsl(220, 10%, 50%, 0.3)', // Muted gray with alpha
} as const;

// ============= Color Utility Functions =============

/**
 * Get categorical color by index (wraps around)
 */
export function getCategoricalColor(
  index: number,
  palette: CategoricalPalette = 'default'
): string {
  const colors = CATEGORICAL_PALETTES[palette];
  return colors[index % colors.length];
}

/**
 * Get continuous color by normalized value
 */
export function getContinuousColor(
  t: number, // 0-1 normalized value
  palette: ContinuousPalette = 'blue_red'
): string {
  const clampedT = Math.max(0, Math.min(1, t));
  return CONTINUOUS_PALETTES[palette](clampedT);
}

/**
 * Normalize a value to 0-1 range
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

/**
 * Get the effective target type considering manual override
 * Phase 5: Helper function for determining actual target type
 */
export function getEffectiveTargetType(
  detectedType: TargetType | undefined,
  override: TargetType | 'auto' | undefined
): TargetType | undefined {
  if (override && override !== 'auto') {
    return override;
  }
  return detectedType;
}

/**
 * Determine if a mode uses continuous or categorical coloring
 * Phase 5: Now considers targetType for 'target' mode
 */
export function isContinuousMode(
  mode: GlobalColorMode,
  metadataType?: 'categorical' | 'continuous',
  targetType?: TargetType,
  targetTypeOverride?: TargetType | 'auto'
): boolean {
  if (mode === 'target') {
    // Phase 5: Check override first, then detected type
    const effectiveType = getEffectiveTargetType(targetType, targetTypeOverride);
    if (effectiveType === 'classification' || effectiveType === 'ordinal') {
      return false;
    }
    return true;
  }
  if (mode === 'index') return true;
  if (mode === 'metadata' && metadataType === 'continuous') return true;
  return false;
}

/**
 * Auto-detect if a metadata column is categorical or continuous
 */
export function detectMetadataType(values: unknown[]): 'categorical' | 'continuous' {
  if (values.length === 0) return 'categorical';

  // Check if all non-null values are numbers
  const nonNullValues = values.filter(v => v !== null && v !== undefined);
  const allNumeric = nonNullValues.every(v => typeof v === 'number' && !isNaN(v as number));

  if (!allNumeric) return 'categorical';

  // If numeric, check uniqueness ratio
  const uniqueValues = new Set(nonNullValues);
  const uniqueRatio = uniqueValues.size / nonNullValues.length;

  // If more than 20% unique values and more than 10 unique values, treat as continuous
  return uniqueRatio > 0.2 && uniqueValues.size > 10 ? 'continuous' : 'categorical';
}

/**
 * Get base color for a sample (without selection state)
 */
export function getBaseColor(
  sampleIndex: number,
  config: GlobalColorConfig,
  context: ColorContext
): string {
  const {
    y, yMin, yMax, trainIndices, testIndices,
    foldLabels, metadata, outlierIndices,
  } = context;

  switch (config.mode) {
    case 'target': {
      if (!y || yMin === undefined || yMax === undefined) {
        return HIGHLIGHT_COLORS.unselected;
      }

      // Phase 5: Classification mode - use categorical colors
      // Check for manual override first, then use detected type
      const { targetType: detectedType, classLabels, classLabelMap } = context;
      const effectiveTargetType = config.targetTypeOverride && config.targetTypeOverride !== 'auto'
        ? config.targetTypeOverride
        : detectedType;

      if (effectiveTargetType === 'classification' || effectiveTargetType === 'ordinal') {
        if (classLabels && classLabels.length > 0) {
          const yValue = y[sampleIndex];
          const classIdx = classLabelMap
            ? classLabelMap.get(String(yValue)) ?? -1
            : classLabels.indexOf(String(yValue));
          if (classIdx >= 0) {
            return getCategoricalColor(classIdx, config.categoricalPalette);
          }
        }
        return HIGHLIGHT_COLORS.unselected;
      }

      // Regression mode - continuous gradient
      const t = normalizeValue(y[sampleIndex], yMin, yMax);
      return getContinuousColor(t, config.continuousPalette);
    }

    case 'partition': {
      if (trainIndices?.has(sampleIndex)) {
        return PARTITION_COLORS.train;
      }
      if (testIndices?.has(sampleIndex)) {
        return PARTITION_COLORS.test;
      }
      return HIGHLIGHT_COLORS.unselected;
    }

    case 'fold': {
      const foldLabel = foldLabels?.[sampleIndex];
      if (foldLabel !== undefined && foldLabel >= 0) {
        return getCategoricalColor(foldLabel, config.categoricalPalette);
      }
      return HIGHLIGHT_COLORS.unselected;
    }

    case 'metadata': {
      if (!metadata || !config.metadataKey) {
        return HIGHLIGHT_COLORS.unselected;
      }
      const values = metadata[config.metadataKey];
      const value = values?.[sampleIndex];
      if (value === undefined || value === null) {
        return HIGHLIGHT_COLORS.unselected;
      }

      // Determine type (use explicit type or auto-detect)
      const metadataType = config.metadataType ?? detectMetadataType(values);

      if (metadataType === 'continuous' && typeof value === 'number') {
        const numericValues = values.filter(v => typeof v === 'number') as number[];
        const min = Math.min(...numericValues);
        const max = Math.max(...numericValues);
        const t = normalizeValue(value, min, max);
        return getContinuousColor(t, config.continuousPalette);
      } else {
        // Categorical
        const uniqueValues = [...new Set(values.filter(v => v !== null && v !== undefined))];
        const idx = uniqueValues.indexOf(value);
        return getCategoricalColor(idx >= 0 ? idx : 0, config.categoricalPalette);
      }
    }

    case 'selection': {
      // In selection mode, base color is grey (selection highlighting handled separately)
      return HIGHLIGHT_COLORS.unselected;
    }

    case 'outlier': {
      const isOutlier = outlierIndices?.has(sampleIndex) ?? false;
      return isOutlier ? HIGHLIGHT_COLORS.outlier : HIGHLIGHT_COLORS.unselected;
    }

    case 'index': {
      const totalSamples = context.totalSamples ?? (y?.length || 1);
      const t = sampleIndex / Math.max(1, totalSamples - 1);
      return getContinuousColor(t, config.continuousPalette);
    }

    default:
      return HIGHLIGHT_COLORS.unselected;
  }
}

/**
 * Compute sample color based on unified config, including selection state
 */
export function getUnifiedSampleColor(
  sampleIndex: number,
  config: GlobalColorConfig,
  context: ColorContext
): ColorResult {
  const {
    selectedSamples, pinnedSamples, hoveredSample, outlierIndices, displayFilteredIndices,
  } = context;

  // Phase 4: Display filtering - hide samples not in the filter
  if (displayFilteredIndices && !displayFilteredIndices.has(sampleIndex)) {
    return {
      color: 'transparent',
      opacity: 0,
      hidden: true,
    };
  }

  const isSelected = selectedSamples?.has(sampleIndex) ?? false;
  const isPinned = pinnedSamples?.has(sampleIndex) ?? false;
  const isHovered = hoveredSample === sampleIndex;
  const hasSelection = (selectedSamples?.size ?? 0) > 0;
  const isOutlier = outlierIndices?.has(sampleIndex) ?? false;

  // Handle hover state (highest priority)
  if (isHovered) {
    return {
      color: HIGHLIGHT_COLORS.hovered,
      opacity: 1,
      stroke: 'hsl(var(--foreground))',
      strokeWidth: 3,
      zIndex: 1000,
    };
  }

  // Handle selection mode specially
  if (config.mode === 'selection') {
    if (isSelected) {
      return {
        color: HIGHLIGHT_COLORS.selected,
        opacity: 1,
        stroke: 'hsl(var(--foreground))',
        strokeWidth: 2,
        zIndex: 100,
      };
    }
    return {
      color: HIGHLIGHT_COLORS.unselected,
      opacity: config.unselectedOpacity,
    };
  }

  // Handle outlier mode specially
  if (config.mode === 'outlier') {
    if (isOutlier) {
      return {
        color: HIGHLIGHT_COLORS.outlier,
        opacity: 1,
        zIndex: 100,
      };
    }
    return {
      color: HIGHLIGHT_COLORS.unselected,
      opacity: config.unselectedOpacity,
    };
  }

  // Handle selected state with selection override
  if (isSelected && config.selectionOverride) {
    return {
      color: HIGHLIGHT_COLORS.selected,
      opacity: 1,
      stroke: 'hsl(var(--foreground))',
      strokeWidth: 2,
      zIndex: 100,
    };
  }

  // Handle pinned state
  if (isPinned && config.highlightPinned) {
    const baseColor = getBaseColor(sampleIndex, config, context);
    return {
      color: baseColor,
      opacity: 1,
      stroke: HIGHLIGHT_COLORS.pinned,
      strokeWidth: 2,
      zIndex: 50,
    };
  }

  // Get base color by mode
  const baseColor = getBaseColor(sampleIndex, config, context);

  // Apply opacity reduction if there's a selection and this sample isn't selected
  const opacity = hasSelection && !isSelected && !isPinned
    ? config.unselectedOpacity
    : 1;

  // Apply outlier overlay (red border) in all modes except 'outlier' mode
  // Note: 'outlier' mode already returned above, so we don't need to check for it here
  if (isOutlier && config.showOutlierOverlay !== false) {
    return {
      color: baseColor,
      opacity,
      stroke: HIGHLIGHT_COLORS.outlier,
      strokeWidth: 2,
    };
  }

  return { color: baseColor, opacity };
}

/**
 * Get sample color for WebGL/canvas renderers (returns concrete colors, no CSS variables)
 * Similar to getUnifiedSampleColor but uses HIGHLIGHT_COLORS_CONCRETE for CSS-variable colors
 */
export function getWebGLSampleColor(
  sampleIndex: number,
  config: GlobalColorConfig,
  context: ColorContext
): string {
  const {
    selectedSamples, pinnedSamples, hoveredSample, outlierIndices, displayFilteredIndices,
  } = context;

  // Display filtering - return transparent for hidden samples
  if (displayFilteredIndices && !displayFilteredIndices.has(sampleIndex)) {
    return 'transparent';
  }

  const isSelected = selectedSamples?.has(sampleIndex) ?? false;
  const isPinned = pinnedSamples?.has(sampleIndex) ?? false;
  const isHovered = hoveredSample === sampleIndex;
  const hasSelection = (selectedSamples?.size ?? 0) > 0;
  const isOutlier = outlierIndices?.has(sampleIndex) ?? false;

  // Handle hover state (highest priority)
  if (isHovered) {
    return HIGHLIGHT_COLORS_CONCRETE.hovered;
  }

  // Handle selection mode specially
  if (config.mode === 'selection') {
    return isSelected ? HIGHLIGHT_COLORS_CONCRETE.selected : HIGHLIGHT_COLORS_CONCRETE.unselected;
  }

  // Handle outlier mode specially
  if (config.mode === 'outlier') {
    return isOutlier ? HIGHLIGHT_COLORS_CONCRETE.outlier : HIGHLIGHT_COLORS_CONCRETE.unselected;
  }

  // Handle selected state with selection override
  if (isSelected && config.selectionOverride) {
    return HIGHLIGHT_COLORS_CONCRETE.selected;
  }

  // Handle pinned state - return base color (pinned styling is handled via stroke in renderers)
  // Get base color by mode
  const baseColor = getBaseColor(sampleIndex, config, context);

  // For dimmed unselected samples, we can't easily apply opacity in WebGL color strings
  // So we return the base color and let the renderer handle opacity if needed
  return baseColor;
}

/**
 * Get all unique values for a metadata column (for legend/binning)
 */
export function getMetadataUniqueValues(
  metadata: Record<string, unknown[]>,
  key: string
): unknown[] {
  const values = metadata[key];
  if (!values) return [];
  return [...new Set(values.filter(v => v !== null && v !== undefined))];
}

/**
 * Compute Y value bins for stacked charts (terciles by default)
 */
export function computeYBins(
  y: number[],
  numBins: number = 3
): { min: number; max: number; label: string }[] {
  if (y.length === 0) return [];

  const sorted = [...y].sort((a, b) => a - b);
  const bins: { min: number; max: number; label: string }[] = [];

  for (let i = 0; i < numBins; i++) {
    const startIdx = Math.floor((i / numBins) * sorted.length);
    const endIdx = Math.floor(((i + 1) / numBins) * sorted.length) - 1;
    const min = sorted[startIdx];
    const max = sorted[Math.min(endIdx, sorted.length - 1)];

    const labels = ['Low', 'Medium', 'High'];
    bins.push({
      min,
      max,
      label: numBins === 3 ? labels[i] : `Bin ${i + 1}`,
    });
  }

  return bins;
}

/**
 * Get the bin index for a Y value
 */
export function getYBinIndex(
  yValue: number,
  bins: { min: number; max: number }[]
): number {
  for (let i = 0; i < bins.length; i++) {
    if (yValue >= bins[i].min && (i === bins.length - 1 || yValue < bins[i + 1].min)) {
      return i;
    }
  }
  return bins.length - 1;
}

// ============= Palette Display Helpers =============

/**
 * Get display name for a continuous palette
 */
export function getContinuousPaletteLabel(palette: ContinuousPalette): string {
  const labels: Record<ContinuousPalette, string> = {
    blue_red: 'Blue-Red',
    viridis: 'Viridis',
    plasma: 'Plasma',
    inferno: 'Inferno',
    coolwarm: 'Cool-Warm',
    spectral: 'Spectral',
    cividis: 'Cividis',
    winter: 'Winter',
    blues: 'Blues',
    greens: 'Greens',
    turbo: 'Turbo',
  };
  return labels[palette];
}

/**
 * Get display name for a categorical palette
 */
export function getCategoricalPaletteLabel(palette: CategoricalPalette): string {
  const labels: Record<CategoricalPalette, string> = {
    default: 'Default',
    tableau10: 'Tableau 10',
    set1: 'Set 1',
    set2: 'Set 2',
    paired: 'Paired',
  };
  return labels[palette];
}

/**
 * Get display name for a color mode
 */
export function getColorModeLabel(mode: GlobalColorMode): string {
  const labels: Record<GlobalColorMode, string> = {
    target: 'By Y Value',
    partition: 'By Partition',
    fold: 'By Fold',
    metadata: 'By Metadata',
    selection: 'By Selection',
    outlier: 'By Outlier',
    index: 'By Index',
  };
  return labels[mode];
}

/**
 * Generate preview gradient for a continuous palette (CSS gradient)
 */
export function getContinuousPaletteGradient(palette: ContinuousPalette): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    stops.push(`${getContinuousColor(t, palette)} ${t * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
