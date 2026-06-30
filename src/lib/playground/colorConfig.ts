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
import {
  type CategoricalPalette,
  type ContinuousPalette,
} from './colorConfigPalettes';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_COLORS_CONCRETE,
  detectMetadataType as detectMetadataTypeBase,
  getBaseColor as getBaseColorBase,
  getEffectiveTargetType as getEffectiveTargetTypeBase,
  getMetadataUniqueCategories as getMetadataUniqueCategoriesBase,
  isContinuousMode as isContinuousModeBase,
} from './colorConfigBase';

// Re-export the pure palette primitives so existing `from '.../colorConfig'`
// imports keep working unchanged.
export * from './colorConfigPalettes';
export * from './colorConfigPartitions';
export { HIGHLIGHT_COLORS, HIGHLIGHT_COLORS_CONCRETE } from './colorConfigBase';

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
  foldKind?: 'test_split' | 'cv_folds';
  foldCount?: number;

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
  unselectedOpacity: 0.3,
  highlightPinned: true,
  selectionOverride: false,
  showOutlierOverlay: true,
};

// ============= Color Utility Functions =============

/**
 * Get the effective target type considering manual override
 * Phase 5: Helper function for determining actual target type
 */
export function getEffectiveTargetType(
  detectedType: TargetType | undefined,
  override: TargetType | 'auto' | undefined
): TargetType | undefined {
  return getEffectiveTargetTypeBase(detectedType, override);
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
  return isContinuousModeBase(mode, metadataType, targetType, targetTypeOverride);
}

/**
 * Auto-detect if a metadata column is categorical or continuous
 */
export function detectMetadataType(values: unknown[]): 'categorical' | 'continuous' {
  return detectMetadataTypeBase(values);
}

/**
 * Get base color for a sample (without selection state)
 */
export function getBaseColor(
  sampleIndex: number,
  config: GlobalColorConfig,
  context: ColorContext
): string {
  return getBaseColorBase(sampleIndex, config, context);
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

  const baseColor = getBaseColor(sampleIndex, config, context);

  // Keep selection visible in every mode without forcing a fill override.
  if (isSelected) {
    return {
      color: config.selectionOverride ? HIGHLIGHT_COLORS.selected : baseColor,
      opacity: 1,
      stroke: 'hsl(var(--foreground))',
      strokeWidth: 2,
      zIndex: 100,
    };
  }

  // Handle pinned state
  if (isPinned && config.highlightPinned) {
    return {
      color: baseColor,
      opacity: 1,
      stroke: HIGHLIGHT_COLORS.pinned,
      strokeWidth: 2,
      zIndex: 50,
    };
  }

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
    selectedSamples, hoveredSample, outlierIndices, displayFilteredIndices,
  } = context;

  // Display filtering - return transparent for hidden samples
  if (displayFilteredIndices && !displayFilteredIndices.has(sampleIndex)) {
    return 'transparent';
  }

  const isSelected = selectedSamples?.has(sampleIndex) ?? false;
  const isHovered = hoveredSample === sampleIndex;
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
 * Get all unique categorical labels for a metadata column while preserving
 * the original data order used by the other playground charts.
 */
export function getMetadataUniqueCategories(values: unknown[]): string[] {
  return getMetadataUniqueCategoriesBase(values);
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

// ============= Mode Display Helpers =============

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
