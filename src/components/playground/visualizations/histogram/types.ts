/**
 * Shared types and interfaces for YHistogramV2 sub-components.
 */

import type React from 'react';
import type { SelectionContextValue } from '@/context/SelectionContext';
import type { GlobalColorConfig, ColorContext } from '@/lib/playground/colorConfig';
import type { FoldsInfo } from '@/types/playground';

// ============= Basic Types =============

export type BinCountOption = 'auto' | '10' | '20' | '30' | '50' | 'custom';

export interface BinData {
  binStart: number;
  binEnd: number;
  binCenter: number;
  count: number;
  samples: number[];
  label: string;
  foldCounts?: Record<number, number>;
  foldSamples?: Record<number, number[]>;
}

/** Phase 5: Classification mode data */
export interface ClassBarData {
  classLabel: string;
  classIndex: number;
  count: number;
  samples: number[];
  foldCounts?: Record<number, number>;
  foldSamples?: Record<number, number[]>;
}

export interface YStats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  n: number;
  q1: number;
  q3: number;
}

export interface HistogramConfig {
  binCount: BinCountOption;
  customBinCount: number;
  showKDE: boolean;
  showMean: boolean;
  showMedian: boolean;
  showStdBands: boolean;
  yAxisType: 'count' | 'frequency' | 'density';
}

/** Recharts mouse event type for histogram interactions */
export interface RechartsMouseEvent {
  activeLabel?: number | string;
  activePayload?: Array<{ payload?: BinData }>;
  activeTooltipIndex?: number;
}

export interface RangeSelection {
  start: number | null;
  end: number | null;
  isSelecting: boolean;
}

// ============= Default Configuration =============

export const DEFAULT_CONFIG: HistogramConfig = {
  binCount: 'auto',
  customBinCount: 20,
  showKDE: false,
  showMean: false,
  showMedian: false,
  showStdBands: false,
  yAxisType: 'count',
};

export const RANGE_SELECTION_INITIAL: RangeSelection = {
  start: null,
  end: null,
  isSelecting: false,
};

// ============= Component Props =============

export interface YHistogramV2Props {
  /** Y values to display */
  y: number[];
  /** Optional processed Y values (when y_processing is applied) */
  processedY?: number[];
  /** Fold information for fold-based visualization */
  folds?: FoldsInfo | null;
  /** Metadata for metadata-based coloring */
  metadata?: Record<string, unknown[]>;
  /** Spectral metrics for metric-based coloring */
  spectralMetrics?: Record<string, number[]>;
  /** Currently selected sample (deprecated - use SelectionContext) */
  selectedSample?: number | null;
  /** Callback when sample is selected (deprecated - use SelectionContext) */
  onSelectSample?: (index: number) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration for cross-chart highlighting */
  useSelectionContext?: boolean;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Global unified color configuration */
  globalColorConfig?: GlobalColorConfig;
  /** Color context with computed values for coloring */
  colorContext?: ColorContext;
}

// ============= Shared Chart Mode Props =============

/**
 * Props passed from the mode router to each chart mode component.
 * Each component destructures only what it needs.
 */
export interface HistogramChartProps {
  // Core data
  histogramData: BinData[];
  stats: YStats;
  displayY: number[];

  // Config
  config: HistogramConfig;
  yAxisLabel: string;
  getYValue: (count: number) => number;

  // KDE data (used by simple mode)
  kdeData: { x: number; density: number }[];

  // Selection state
  selectedSamples: Set<number>;
  selectedBins: Set<number>;
  hoveredBin: number | null;
  selectionCtx: SelectionContextValue | null;

  // Range selection
  rangeSelection: RangeSelection;
  setRangeSelection: React.Dispatch<React.SetStateAction<RangeSelection>>;

  // Mouse handlers
  handleMouseDown: (e: RechartsMouseEvent) => void;
  handleMouseMove: (e: RechartsMouseEvent) => void;
  handleMouseLeave: () => void;
  handleDragSelection: (e: MouseEvent | null) => boolean;
  handleBarSelection: (
    samples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => void;
  lastMouseEventRef: React.MutableRefObject<MouseEvent | null>;

  // Color config
  globalColorConfig?: GlobalColorConfig;
  colorContext?: ColorContext;

  // Fold-specific
  uniqueFolds: number[];

  // Metadata-specific
  metadata?: Record<string, unknown[]>;
  metadataCategories: string[];

  // Classification-specific
  classBarData: ClassBarData[];
  selectedClasses: Set<number>;
  hoveredClass: number | null;
}

// ============= HistogramBase Props =============

export interface HistogramBaseProps {
  chartRef: React.RefObject<HTMLDivElement | null>;
  config: HistogramConfig;
  updateConfig: (updates: Partial<HistogramConfig>) => void;
  isClassificationMode: boolean;
  classBarData: ClassBarData[];
  isProcessed: boolean;
  displayStats: YStats | null;
  selectedSamples: Set<number>;
  selectedClasses: Set<number>;
  selectionCtx: SelectionContextValue | null;
  compact: boolean;
  globalColorConfig?: GlobalColorConfig;
  colorContext?: ColorContext;
  handleExport: () => void;
  children: React.ReactNode;
}
