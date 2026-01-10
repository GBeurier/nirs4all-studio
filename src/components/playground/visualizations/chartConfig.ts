/**
 * Shared chart configuration for Playground visualizations
 *
 * Phase 1 Refactoring: Type Safety Improvements
 *
 * Provides consistent colors, themes, and helper functions across all charts.
 * This ensures visual consistency and simplifies maintenance.
 *
 * Also includes discriminated union types for chart state management.
 */

// ============= Discriminated Union Types for Chart State =============

/**
 * Base state for all charts when loading
 */
export interface ChartLoadingState {
  readonly status: 'loading';
}

/**
 * Base state for all charts when there's an error
 */
export interface ChartErrorState {
  readonly status: 'error';
  readonly error: string;
}

/**
 * Base state for all charts when there's no data
 */
export interface ChartEmptyState {
  readonly status: 'empty';
  readonly message?: string;
}

/**
 * Generic data-ready state for charts
 */
export interface ChartDataState<T> {
  readonly status: 'ready';
  readonly data: T;
}

/**
 * Discriminated union for chart state
 * Use this to handle all possible chart states in a type-safe way
 */
export type ChartState<T> =
  | ChartLoadingState
  | ChartErrorState
  | ChartEmptyState
  | ChartDataState<T>;

/**
 * Helper to create a loading state
 */
export function chartLoading(): ChartLoadingState {
  return { status: 'loading' };
}

/**
 * Helper to create an error state
 */
export function chartError(error: string): ChartErrorState {
  return { status: 'error', error };
}

/**
 * Helper to create an empty state
 */
export function chartEmpty(message?: string): ChartEmptyState {
  return { status: 'empty', message };
}

/**
 * Helper to create a data-ready state
 */
export function chartReady<T>(data: T): ChartDataState<T> {
  return { status: 'ready', data };
}

/**
 * Type guard for loading state
 */
export function isChartLoading<T>(state: ChartState<T>): state is ChartLoadingState {
  return state.status === 'loading';
}

/**
 * Type guard for error state
 */
export function isChartError<T>(state: ChartState<T>): state is ChartErrorState {
  return state.status === 'error';
}

/**
 * Type guard for empty state
 */
export function isChartEmpty<T>(state: ChartState<T>): state is ChartEmptyState {
  return state.status === 'empty';
}

/**
 * Type guard for data-ready state
 */
export function isChartReady<T>(state: ChartState<T>): state is ChartDataState<T> {
  return state.status === 'ready';
}

// ============= Chart Data Types =============

/**
 * Spectra chart data
 */
export interface SpectraChartData {
  spectra: number[][];
  wavelengths: number[];
  y: number[];
  sampleIds?: string[];
  foldLabels?: number[];
}

/**
 * Histogram chart data
 */
export interface HistogramChartData {
  values: number[];
  bins?: number;
  foldLabels?: number[];
}

/**
 * Scatter chart data (PCA/UMAP)
 */
export interface ScatterChartData {
  coordinates: number[][];
  y: number[];
  sampleIds?: string[];
  foldLabels?: number[];
  explainedVariance?: number[];
}

/**
 * Fold distribution chart data
 */
export interface FoldDistributionData {
  folds: Array<{
    foldIndex: number;
    trainCount: number;
    testCount: number;
    trainIndices: number[];
    testIndices: number[];
  }>;
  nFolds: number;
  y?: number[];
}

/**
 * Repetitions chart data
 */
export interface RepetitionsChartData {
  hasRepetitions: boolean;
  nBioSamples: number;
  data: Array<{
    bioSample: string;
    repIndex: number;
    sampleIndex: number;
    distance: number;
    y?: number;
  }>;
}

// ============= Typed Chart State Types =============

export type SpectraChartState = ChartState<SpectraChartData>;
export type HistogramChartState = ChartState<HistogramChartData>;
export type ScatterChartState = ChartState<ScatterChartData>;
export type FoldDistributionState = ChartState<FoldDistributionData>;
export type RepetitionsChartState = ChartState<RepetitionsChartData>;

// ============= DEPRECATED Color Palettes =============
// ⚠️ IMPORTANT: All color constants below are DEPRECATED
// Use the unified color system from '@/lib/playground/colorConfig' instead:
// - PARTITION_COLORS for train/test colors
// - HIGHLIGHT_COLORS for selection/hover/pinned states
// - getCategoricalColor() for fold/category colors
// - getContinuousColor() for continuous value colors

/**
 * Fold colors - distinct colors for cross-validation folds
 * @deprecated ⚠️ DO NOT USE - Use getCategoricalColor(index, palette) from '@/lib/playground/colorConfig'
 */
export const FOLD_COLORS = [
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
] as const;

/**
 * Get fold color by index (wraps around if more folds than colors)
 * @deprecated ⚠️ DO NOT USE - Use getCategoricalColor(foldIndex, palette) from '@/lib/playground/colorConfig'
 */
export function getFoldColor(foldIndex: number): string {
  return FOLD_COLORS[foldIndex % FOLD_COLORS.length];
}

/**
 * Train/Test colors for fold visualization
 * @deprecated ⚠️ DO NOT USE - Use PARTITION_COLORS from '@/lib/playground/colorConfig'
 */
export const TRAIN_TEST_COLORS = {
  train: 'hsl(217, 70%, 50%)',
  test: 'hsl(38, 92%, 50%)',
  trainLight: 'hsl(217, 70%, 75%)',
  testLight: 'hsl(38, 92%, 75%)',
} as const;

/**
 * Sample colors by target value (Y)
 * @deprecated ⚠️ DO NOT USE - Use getContinuousColor(t, palette) from '@/lib/playground/colorConfig'
 */
export function getSampleColorByY(
  yValue: number,
  yMin: number,
  yMax: number
): string {
  const t = (yValue - yMin) / (yMax - yMin + 0.001);
  const hue = 240 - t * 180; // Blue to red gradient
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Sample colors by fold assignment
 * @deprecated ⚠️ DO NOT USE - Use getCategoricalColor(foldLabel, palette) from '@/lib/playground/colorConfig'
 */
export function getSampleColorByFold(
  foldLabel: number | undefined,
  isSelected: boolean = false
): string {
  if (isSelected) {
    return 'hsl(var(--primary))';
  }
  if (foldLabel === undefined || foldLabel < 0) {
    return 'hsl(var(--muted-foreground))';
  }
  return getFoldColor(foldLabel);
}

// ============= Chart Theme =============

/**
 * Common chart styling constants
 * Using concrete color values for SVG compatibility
 */
export const CHART_THEME = {
  // Grid
  gridStroke: '#3f3f46', // zinc-700
  gridOpacity: 0.3,
  gridDasharray: '3 3',

  // Axes
  axisStroke: '#a1a1aa', // zinc-400
  axisFontSize: 10,
  axisLabelFontSize: 10,

  // Tooltip
  tooltipBg: 'hsl(var(--card))',
  tooltipBorder: 'hsl(var(--border))',
  tooltipBorderRadius: 8,
  tooltipFontSize: 12,

  // Selection - Enhanced for Phase 2
  selectedStroke: '#ffffff',
  selectedStrokeWidth: 2,
  selectedGlow: '0 0 8px hsl(var(--primary))',

  // Hover state
  hoveredStroke: '#ffffff',
  hoveredStrokeWidth: 3,
  hoveredOpacity: 1,

  // Pinned state
  pinnedStroke: 'hsl(45, 90%, 50%)', // Gold
  pinnedStrokeWidth: 2,
  pinnedDashArray: '4 2',

  // Unselected when selection exists
  unselectedOpacity: 0.25,

  // Lines
  lineStrokeWidth: 1,
  selectedLineStrokeWidth: 2.5,
  hoveredLineStrokeWidth: 3,
  pinnedLineStrokeWidth: 2,

  // Points
  pointRadius: 5,
  selectedPointRadius: 8,
  hoveredPointRadius: 9,
  pinnedPointRadius: 7,

  // Statistics band
  statisticsBandOpacity: 0.2,
  statisticsLineOpacity: 0.8,

  // Phase 6: Reference dataset
  referenceLineColor: '#9333ea', // purple-600
  referenceLineOpacity: 0.7,
  referenceDashArray: '6 3',
} as const;

// ============= DEPRECATED Selection Colors =============

/**
 * Colors for selection states - Phase 2 Enhancement
 * @deprecated ⚠️ DO NOT USE - Use HIGHLIGHT_COLORS from '@/lib/playground/colorConfig'
 */
export const SELECTION_COLORS = {
  // Primary selection - Distinctive cyan for better visibility
  selected: 'hsl(180, 85%, 45%)',
  selectedBg: 'hsl(180, 85%, 45% / 0.15)',
  selectedStroke: '#ffffff',

  // Hover state - Bright orange for high contrast
  hovered: 'hsl(35, 95%, 55%)',
  hoveredBg: 'hsl(35, 95%, 55% / 0.1)',

  // Pinned state (gold/amber)
  pinned: 'hsl(45, 90%, 50%)',
  pinnedBg: 'hsl(45, 90%, 50% / 0.15)',

  // Unselected when there's an active selection
  unselected: 'hsl(var(--muted-foreground) / 0.3)',

  // Range selection overlay
  rangeOverlay: 'hsl(var(--primary) / 0.15)',
  rangeStroke: 'hsl(var(--primary) / 0.5)',
} as const;

/**
 * Get selection state color for a sample
 * @deprecated ⚠️ DO NOT USE - Use getUnifiedSampleColor from '@/lib/playground/colorConfig'
 */
export function getSelectionStateColor(
  index: number,
  selectedSamples: Set<number>,
  pinnedSamples: Set<number>,
  hoveredSample: number | null,
  baseColor: string
): { fill: string; stroke?: string; strokeWidth?: number; opacity?: number } {
  const isSelected = selectedSamples.has(index);
  const isPinned = pinnedSamples.has(index);
  const isHovered = hoveredSample === index;
  const hasSelection = selectedSamples.size > 0;

  if (isHovered) {
    return {
      fill: SELECTION_COLORS.selected,
      stroke: SELECTION_COLORS.selectedStroke,
      strokeWidth: CHART_THEME.hoveredStrokeWidth,
      opacity: 1,
    };
  }

  if (isSelected) {
    return {
      fill: SELECTION_COLORS.selected,
      stroke: SELECTION_COLORS.selectedStroke,
      strokeWidth: CHART_THEME.selectedStrokeWidth,
      opacity: 1,
    };
  }

  if (isPinned) {
    return {
      fill: baseColor,
      stroke: SELECTION_COLORS.pinned,
      strokeWidth: CHART_THEME.pinnedStrokeWidth,
      opacity: 1,
    };
  }

  if (hasSelection) {
    return {
      fill: baseColor,
      opacity: CHART_THEME.unselectedOpacity,
    };
  }

  return { fill: baseColor };
}

// ============= Statistics Colors =============

/**
 * Colors for statistics visualization (mean, std bands, etc.)
 */
export const STATISTICS_COLORS = {
  mean: 'hsl(217, 70%, 50%)',
  std: 'hsl(217, 70%, 50%)',
  p5p95: 'hsl(173, 60%, 50%)',
  minMax: 'hsl(280, 50%, 50%)',
  median: 'hsl(278, 65%, 50%)',
  original: 'hsl(142, 60%, 45%)',
  processed: 'hsl(217, 70%, 50%)',
} as const;

// ============= Chart Margins =============

/**
 * Default margins for charts
 */
export const CHART_MARGINS = {
  spectra: { top: 5, right: 10, left: 0, bottom: 5 },
  pca: { top: 5, right: 10, left: 0, bottom: 5 },
  histogram: { top: 5, right: 10, left: 0, bottom: 5 },
  folds: { top: 10, right: 20, left: 10, bottom: 5 },
  boxplot: { top: 5, right: 20, left: 10, bottom: 20 },
} as const;

// ============= Formatting Functions =============

/**
 * Format wavelength for display
 */
export function formatWavelength(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return String(value);
  }
  return value.toFixed(0);
}

/**
 * Format Y value for display
 */
export function formatYValue(value: number, precision: number = 2): string {
  return value.toFixed(precision);
}

/**
 * Format percentage for display
 */
export function formatPercentage(value: number, precision: number = 1): string {
  return `${value.toFixed(precision)}%`;
}

/**
 * Format fold label
 */
export function formatFoldLabel(foldIndex: number): string {
  return `Fold ${foldIndex + 1}`;
}

// ============= Legend Items =============

export interface LegendItem {
  label: string;
  color: string;
  dashed?: boolean;
}

/**
 * Generate legend items for fold visualization
 * @deprecated ⚠️ DO NOT USE - Build legend items using getCategoricalColor from '@/lib/playground/colorConfig'
 */
export function getFoldLegendItems(nFolds: number): LegendItem[] {
  return Array.from({ length: Math.min(nFolds, FOLD_COLORS.length) }, (_, i) => ({
    label: formatFoldLabel(i),
    color: getFoldColor(i),
  }));
}

/**
 * Generate legend items for train/test split
 * @deprecated ⚠️ DO NOT USE - Build legend items using PARTITION_COLORS from '@/lib/playground/colorConfig'
 */
export function getTrainTestLegendItems(): LegendItem[] {
  return [
    { label: 'Train', color: TRAIN_TEST_COLORS.train },
    { label: 'Test', color: TRAIN_TEST_COLORS.test },
  ];
}

/**
 * Generate legend items for statistics bands
 */
export function getStatisticsLegendItems(includeMinMax: boolean = false): LegendItem[] {
  const items: LegendItem[] = [
    { label: 'Mean', color: STATISTICS_COLORS.mean },
    { label: '±1 Std', color: STATISTICS_COLORS.std, dashed: true },
  ];

  if (includeMinMax) {
    items.push({ label: 'Min/Max', color: STATISTICS_COLORS.minMax, dashed: true });
  }

  return items;
}

// ============= Animation Settings =============

/**
 * Disable animations for performance
 */
export const ANIMATION_CONFIG = {
  isAnimationActive: false,
} as const;

// ============= Responsive Breakpoints =============

/**
 * Number of samples to show based on container width
 */
export function getMaxSamplesForWidth(width: number): number {
  if (width < 400) return 20;
  if (width < 600) return 30;
  if (width < 800) return 50;
  return 100;
}

/**
 * Wavelength downsampling factor based on width
 */
export function getWavelengthDownsampleFactor(
  wavelengthCount: number,
  containerWidth: number
): number {
  const targetPoints = Math.min(containerWidth, 500);
  return Math.max(1, Math.ceil(wavelengthCount / targetPoints));
}
