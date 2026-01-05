/**
 * Shared chart configuration for Playground visualizations
 *
 * Provides consistent colors, themes, and helper functions across all charts.
 * This ensures visual consistency and simplifies maintenance.
 */

// ============= Color Palettes =============

/**
 * Fold colors - distinct colors for cross-validation folds
 * Designed to be colorblind-friendly with high contrast
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
 */
export function getFoldColor(foldIndex: number): string {
  return FOLD_COLORS[foldIndex % FOLD_COLORS.length];
}

/**
 * Train/Test colors for fold visualization
 */
export const TRAIN_TEST_COLORS = {
  train: 'hsl(217, 70%, 50%)',
  test: 'hsl(38, 92%, 50%)',
  trainLight: 'hsl(217, 70%, 75%)',
  testLight: 'hsl(38, 92%, 75%)',
} as const;

/**
 * Sample colors by target value (Y)
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
 */
export const CHART_THEME = {
  // Grid
  gridStroke: 'hsl(var(--border))',
  gridOpacity: 0.3,
  gridDasharray: '3 3',

  // Axes
  axisStroke: 'hsl(var(--muted-foreground))',
  axisFontSize: 10,
  axisLabelFontSize: 10,

  // Tooltip
  tooltipBg: 'hsl(var(--card))',
  tooltipBorder: 'hsl(var(--border))',
  tooltipBorderRadius: 8,
  tooltipFontSize: 12,

  // Selection
  selectedStroke: 'hsl(var(--foreground))',
  selectedStrokeWidth: 2,

  // Lines
  lineStrokeWidth: 1,
  selectedLineStrokeWidth: 2.5,

  // Points
  pointRadius: 5,
  selectedPointRadius: 8,

  // Statistics band
  statisticsBandOpacity: 0.2,
  statisticsLineOpacity: 0.8,
} as const;

// ============= Statistics Colors =============

/**
 * Colors for statistics visualization (mean, std bands, etc.)
 */
export const STATISTICS_COLORS = {
  mean: 'hsl(217, 70%, 50%)',
  std: 'hsl(217, 70%, 50%)',
  p5p95: 'hsl(173, 60%, 50%)',
  minMax: 'hsl(280, 50%, 50%)',
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

// ============= Color Mode =============

/**
 * Extended color modes including fold-based coloring
 */
export type ExtendedColorMode = 'target' | 'dataset' | 'metadata' | 'fold';

export interface ExtendedColorConfig {
  mode: ExtendedColorMode;
  metadataKey?: string;
  showFolds?: boolean;
}

/**
 * Get sample color based on extended color configuration
 */
export function getExtendedSampleColor(
  index: number,
  y: number[],
  foldLabels?: number[],
  colorConfig?: ExtendedColorConfig,
  selectedSample?: number | null,
  datasetSource?: string[]
): string {
  // Selected sample always highlighted
  if (selectedSample === index) {
    return 'hsl(var(--primary))';
  }

  const mode = colorConfig?.mode ?? 'target';

  // Fold coloring mode
  if (mode === 'fold' && foldLabels && foldLabels[index] !== undefined) {
    return getSampleColorByFold(foldLabels[index]);
  }

  // Dataset coloring mode
  if (mode === 'dataset' && datasetSource) {
    const sources = [...new Set(datasetSource)];
    const sourceIndex = sources.indexOf(datasetSource[index]);
    const hue = sourceIndex === 0 ? 217 : sourceIndex === 1 ? 142 : (sourceIndex * 60) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  }

  // Target (Y) coloring mode (default)
  const yMin = Math.min(...y);
  const yMax = Math.max(...y);
  return getSampleColorByY(y[index], yMin, yMax);
}

// ============= Formatting Functions =============

/**
 * Format wavelength for display
 */
export function formatWavelength(value: number): string {
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
 */
export function getFoldLegendItems(nFolds: number): LegendItem[] {
  return Array.from({ length: Math.min(nFolds, FOLD_COLORS.length) }, (_, i) => ({
    label: formatFoldLabel(i),
    color: getFoldColor(i),
  }));
}

/**
 * Generate legend items for train/test split
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
