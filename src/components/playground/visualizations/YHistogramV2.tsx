/**
 * YHistogramV2 - Enhanced Y distribution histogram
 *
 * Features:
 * - Configurable bin count (auto, 10, 20, 50, custom)
 * - Automatic stacking based on global color mode (partition/fold = stacked)
 * - Color derived from global color configuration
 * - KDE overlay toggle
 * - Reference lines (mean, median)
 * - Cross-chart selection highlighting via SelectionContext
 * - Export functionality (PNG, CSV)
 * - Progressive drill-down for stacked bars (bar → segment → clear)
 *
 * Selection Handling (Phase 3 of Unified Selection Model):
 * - Uses unified selection handlers from selectionHandlers.ts
 * - handleBarSelection: Simple bar selection with computeSelectionAction
 * - handleStackedBarSelection: Stacked bar selection with computeStackedBarAction
 * - Range drag selection uses handleDragSelection
 *
 * @see docs/_internals/PLAYGROUND_SELECTION_MODEL.md
 */

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  Legend,
  ReferenceLine,
  ComposedChart,
  Line,
  ReferenceArea,
} from 'recharts';
import {
  BarChart3,
  Download,
  Settings2,
  ChevronDown,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatYValue,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  detectMetadataType,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import { type TargetType } from '@/lib/playground/targetTypeDetection';
import { useSelection, type SelectionContextValue } from '@/context/SelectionContext';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import { InlineColorLegend } from '../ColorLegend';
import type { FoldsInfo } from '@/types/playground';
import { cn } from '@/lib/utils';

// ============= Types =============

export type BinCountOption = 'auto' | '10' | '20' | '30' | '50' | 'custom';

interface YHistogramV2Props {
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

interface BinData {
  binStart: number;
  binEnd: number;
  binCenter: number;
  count: number;
  samples: number[];
  label: string;
  // For fold-based modes
  foldCounts?: Record<number, number>;
  foldSamples?: Record<number, number[]>;
}

// Phase 5: Classification mode data
interface ClassBarData {
  classLabel: string;
  classIndex: number;
  count: number;
  samples: number[];
  // For fold-based modes
  foldCounts?: Record<number, number>;
  foldSamples?: Record<number, number[]>;
}

interface YStats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  n: number;
  q1: number;
  q3: number;
}

interface HistogramConfig {
  binCount: BinCountOption;
  customBinCount: number;
  showKDE: boolean;
  showMean: boolean;
  showMedian: boolean;
  showStdBands: boolean;
  yAxisType: 'count' | 'frequency' | 'density';
}

// Recharts mouse event type for histogram interactions
interface RechartsMouseEvent {
  activeLabel?: number | string;
  activePayload?: Array<{ payload?: BinData }>;
  activeTooltipIndex?: number;
}

// ============= KDE Calculation =============

/**
 * Calculate Kernel Density Estimation using Gaussian kernel
 */
function computeKDE(
  values: number[],
  nPoints: number = 100,
  bandwidth?: number
): { x: number; density: number }[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return [{ x: min, density: 1 }];
  }

  // Silverman's rule of thumb for bandwidth
  const std = Math.sqrt(
    values.reduce((sum, v) => sum + Math.pow(v - values.reduce((a, b) => a + b, 0) / values.length, 2), 0) /
      values.length
  );
  const h = bandwidth ?? 1.06 * std * Math.pow(values.length, -0.2);

  const step = range / (nPoints - 1);
  const result: { x: number; density: number }[] = [];

  for (let i = 0; i < nPoints; i++) {
    const x = min + i * step;
    let density = 0;

    for (const v of values) {
      const u = (x - v) / h;
      density += Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
    }

    density /= values.length * h;
    result.push({ x, density });
  }

  return result;
}

/**
 * Calculate optimal bin count using Freedman-Diaconis rule
 */
function calculateOptimalBinCount(values: number[]): number {
  if (values.length < 2) return 10;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  if (iqr === 0) return Math.min(20, Math.ceil(Math.sqrt(n)));

  const binWidth = 2 * iqr * Math.pow(n, -1 / 3);
  const range = sorted[n - 1] - sorted[0];
  const binCount = Math.ceil(range / binWidth);

  return Math.max(5, Math.min(50, binCount));
}

// ============= Default Configuration =============

const DEFAULT_CONFIG: HistogramConfig = {
  binCount: 'auto',
  customBinCount: 20,
  showKDE: false,
  showMean: false,
  showMedian: false,
  showStdBands: false,
  yAxisType: 'count',
};

// ============= Component =============

export function YHistogramV2({
  y,
  processedY,
  folds,
  metadata,
  spectralMetrics,
  selectedSample: externalSelectedSample,
  onSelectSample: externalOnSelectSample,
  isLoading = false,
  useSelectionContext = true,
  compact = false,
  globalColorConfig,
  colorContext,
}: YHistogramV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<HistogramConfig>(DEFAULT_CONFIG);

  // Range selection state for brush selection on Y axis
  const [rangeSelection, setRangeSelection] = useState<{
    start: number | null;
    end: number | null;
    isSelecting: boolean;
  }>({ start: null, end: null, isSelecting: false });

  // SelectionContext integration for cross-chart highlighting
  // Always call hook unconditionally, then conditionally use the result
  const fullSelectionCtx = useSelection();
  const selectionCtx = useSelectionContext ? fullSelectionCtx : null;

  // Determine effective selection state
  const selectedSamples = useSelectionContext
    ? fullSelectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined
      ? [externalSelectedSample]
      : []);

  const hoveredSample = useSelectionContext ? fullSelectionCtx.hoveredSample : null;

  // Use processed Y if available
  const displayY = processedY && processedY.length === y.length ? processedY : y;
  const isProcessed = processedY && processedY.length === y.length;

  // Determine effective color mode from global config (like FoldDistributionChartV2)
  const effectiveColorMode = globalColorConfig?.mode ?? 'target';

  // Determine if we should use stacked display based on color mode
  // - partition: stack by train/test (doesn't need folds)
  // - fold: stack by fold index (needs folds)
  // - metadata (categorical): stack by metadata category
  // - selection: stack by selected/unselected
  const shouldStackByPartition = effectiveColorMode === 'partition';
  const shouldStackByFold = effectiveColorMode === 'fold';
  const shouldStackBySelection = effectiveColorMode === 'selection';

  // Auto-detect metadata type if not explicitly set
  const effectiveMetadataType = useMemo(() => {
    if (effectiveColorMode !== 'metadata' || !globalColorConfig?.metadataKey || !metadata) return null;
    if (globalColorConfig?.metadataType) return globalColorConfig.metadataType;
    const values = metadata[globalColorConfig.metadataKey];
    if (!values) return null;
    return detectMetadataType(values);
  }, [effectiveColorMode, globalColorConfig?.metadataKey, globalColorConfig?.metadataType, metadata]);

  const shouldStackByMetadata = effectiveColorMode === 'metadata' && effectiveMetadataType === 'categorical';

  // Get unique metadata categories for stacking
  const metadataCategories = useMemo(() => {
    if (!shouldStackByMetadata || !globalColorConfig?.metadataKey || !metadata) return [];
    const key = globalColorConfig.metadataKey;
    const values = metadata[key];
    if (!values) return [];
    const uniqueValues = [...new Set(values.map(v => String(v)))].filter(v => v !== 'undefined' && v !== 'null');
    return uniqueValues.sort();
  }, [shouldStackByMetadata, globalColorConfig?.metadataKey, metadata]);

  // Calculate effective bin count
  const effectiveBinCount = useMemo(() => {
    if (config.binCount === 'custom') return config.customBinCount;
    if (config.binCount === 'auto') return calculateOptimalBinCount(displayY);
    return parseInt(config.binCount, 10);
  }, [config.binCount, config.customBinCount, displayY]);

  // Compute histogram bins
  const { histogramData, sampleBins } = useMemo(() => {
    if (!displayY || displayY.length === 0) {
      return { histogramData: [], sampleBins: [] };
    }

    // Phase 4: Get display filter from colorContext
    const displayFilter = colorContext?.displayFilteredIndices;

    const values = displayY;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const binWidth = range / effectiveBinCount || 1;

    const histogram: BinData[] = Array.from({ length: effectiveBinCount }, (_, i) => ({
      binStart: min + i * binWidth,
      binEnd: min + (i + 1) * binWidth,
      binCenter: min + (i + 0.5) * binWidth,
      count: 0,
      samples: [],
      label: `${formatYValue(min + i * binWidth, 2)} - ${formatYValue(min + (i + 1) * binWidth, 2)}`,
      foldCounts: {},
      foldSamples: {},
    }));

    const sampleToBin: number[] = [];
    const foldLabels = folds?.fold_labels ?? [];

    values.forEach((v, idx) => {
      // Phase 4: Skip samples not in display filter
      if (displayFilter && !displayFilter.has(idx)) {
        return;
      }

      let binIndex = Math.floor((v - min) / binWidth);
      if (binIndex >= effectiveBinCount) binIndex = effectiveBinCount - 1;
      if (binIndex < 0) binIndex = 0;

      histogram[binIndex].count++;
      histogram[binIndex].samples.push(idx);
      sampleToBin[idx] = binIndex;

      // Track fold distribution within bin
      if (foldLabels.length > 0 && foldLabels[idx] !== undefined) {
        const foldIdx = foldLabels[idx];
        if (foldIdx >= 0) {
          histogram[binIndex].foldCounts![foldIdx] = (histogram[binIndex].foldCounts![foldIdx] || 0) + 1;
          if (!histogram[binIndex].foldSamples![foldIdx]) {
            histogram[binIndex].foldSamples![foldIdx] = [];
          }
          histogram[binIndex].foldSamples![foldIdx].push(idx);
        }
      }
    });

    return { histogramData: histogram, sampleBins: sampleToBin };
  }, [displayY, effectiveBinCount, folds, colorContext?.displayFilteredIndices]);

  // Phase 5: Determine if we're in classification mode
  const isClassificationMode = useMemo(() => {
    const targetType = colorContext?.targetType;
    return targetType === 'classification' || targetType === 'ordinal';
  }, [colorContext?.targetType]);

  // Phase 5: Compute class bar data for classification mode
  const classBarData = useMemo<ClassBarData[]>(() => {
    if (!isClassificationMode) return [];

    const classLabels = colorContext?.classLabels;
    if (!classLabels || classLabels.length === 0) return [];

    const displayFilter = colorContext?.displayFilteredIndices;
    const foldLabels = folds?.fold_labels ?? [];

    // Initialize class bars
    const classBars: ClassBarData[] = classLabels.map((label, idx) => ({
      classLabel: label,
      classIndex: idx,
      count: 0,
      samples: [],
      foldCounts: {},
      foldSamples: {},
    }));

    // Count samples per class
    displayY.forEach((yVal, idx) => {
      // Skip samples not in display filter
      if (displayFilter && !displayFilter.has(idx)) {
        return;
      }

      const classIdx = classLabels.indexOf(String(yVal));
      if (classIdx >= 0) {
        classBars[classIdx].count++;
        classBars[classIdx].samples.push(idx);

        // Track fold distribution within class
        if (foldLabels.length > 0 && foldLabels[idx] !== undefined) {
          const foldIdx = foldLabels[idx];
          if (foldIdx >= 0) {
            classBars[classIdx].foldCounts![foldIdx] =
              (classBars[classIdx].foldCounts![foldIdx] || 0) + 1;
            if (!classBars[classIdx].foldSamples![foldIdx]) {
              classBars[classIdx].foldSamples![foldIdx] = [];
            }
            classBars[classIdx].foldSamples![foldIdx].push(idx);
          }
        }
      }
    });

    return classBars;
  }, [isClassificationMode, colorContext?.classLabels, colorContext?.displayFilteredIndices, displayY, folds]);

  // Phase 5: Map samples to their class index for selection highlighting
  const sampleToClass = useMemo(() => {
    if (!isClassificationMode) return [];
    const classLabels = colorContext?.classLabels ?? [];
    return displayY.map(yVal => classLabels.indexOf(String(yVal)));
  }, [isClassificationMode, colorContext?.classLabels, displayY]);

  // Compute statistics
  const stats = useMemo<YStats | null>(() => {
    if (!displayY || displayY.length === 0) return null;

    // Phase 4: Filter values based on display filter
    const displayFilter = colorContext?.displayFilteredIndices;
    const values = displayFilter
      ? displayY.filter((_, idx) => displayFilter.has(idx))
      : displayY;

    if (values.length === 0) return null;

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];

    return {
      mean,
      median,
      std,
      min: sorted[0],
      max: sorted[n - 1],
      n,
      q1,
      q3,
    };
  }, [displayY, colorContext?.displayFilteredIndices]);

  // Compute stats for selected samples (used in footer when there's a selection)
  const selectedStats = useMemo<YStats | null>(() => {
    if (!displayY || displayY.length === 0 || selectedSamples.size === 0) return null;

    const values = displayY.filter((_, idx) => selectedSamples.has(idx));
    if (values.length === 0) return null;

    const n = values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const median = n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)];
    const variance = values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n;
    const std = Math.sqrt(variance);
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];

    return {
      mean,
      median,
      std,
      min: sorted[0],
      max: sorted[n - 1],
      n,
      q1,
      q3,
    };
  }, [displayY, selectedSamples]);

  // Stats to display in footer: selected stats if there's a selection, otherwise all stats
  const displayStats = selectedSamples.size > 0 ? selectedStats : stats;

  // Compute KDE data
  const kdeData = useMemo(() => {
    if (!config.showKDE || !displayY || displayY.length === 0) return [];
    const kde = computeKDE(displayY);
    // Scale KDE to match histogram height
    const maxCount = Math.max(...histogramData.map(d => d.count));
    const maxDensity = Math.max(...kde.map(d => d.density));
    return kde.map(d => ({
      x: d.x,
      density: (d.density / maxDensity) * maxCount,
    }));
  }, [config.showKDE, displayY, histogramData]);

  // Get unique fold indices
  const uniqueFolds = useMemo(() => {
    if (!folds?.fold_labels) return [];
    return [...new Set(folds.fold_labels.filter(f => f >= 0))].sort((a, b) => a - b);
  }, [folds]);

  // Find which bins contain selected/hovered samples
  const selectedBins = useMemo(() => {
    const bins = new Set<number>();
    selectedSamples.forEach(idx => {
      if (sampleBins[idx] !== undefined) {
        bins.add(sampleBins[idx]);
      }
    });
    return bins;
  }, [selectedSamples, sampleBins]);

  const hoveredBin = hoveredSample !== null && sampleBins[hoveredSample] !== undefined
    ? sampleBins[hoveredSample]
    : null;

  // Phase 5: Find which classes contain selected/hovered samples
  const selectedClasses = useMemo(() => {
    if (!isClassificationMode) return new Set<number>();
    const classes = new Set<number>();
    selectedSamples.forEach(idx => {
      const classIdx = sampleToClass[idx];
      if (classIdx !== undefined && classIdx >= 0) {
        classes.add(classIdx);
      }
    });
    return classes;
  }, [isClassificationMode, selectedSamples, sampleToClass]);

  const hoveredClass = useMemo(() => {
    if (!isClassificationMode || hoveredSample === null) return null;
    const classIdx = sampleToClass[hoveredSample];
    return classIdx !== undefined && classIdx >= 0 ? classIdx : null;
  }, [isClassificationMode, hoveredSample, sampleToClass]);

  // Handle range selection on X axis (Y value range)
  const handleMouseDown = useCallback((e: RechartsMouseEvent) => {
    if (!e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel);
    if (!isNaN(yValue)) {
      setRangeSelection({ start: yValue, end: yValue, isSelecting: true });
    }
  }, []);

  const handleMouseMove = useCallback((e: RechartsMouseEvent) => {
    // Handle range selection only - hover propagation disabled for performance
    if (!rangeSelection.isSelecting || !e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel);
    if (!isNaN(yValue)) {
      setRangeSelection(prev => ({ ...prev, end: yValue }));
    }
  }, [rangeSelection.isSelecting]);

  // Recharts provides CategoricalChartState, but we need native event for modifiers and click position
  // Store last native events for use in Recharts handlers
  const lastMouseEventRef = useRef<MouseEvent | null>(null);
  const mouseDownEventRef = useRef<MouseEvent | null>(null);

  // Track native mouse events for modifier keys and click position
  useEffect(() => {
    const handleNativeMouseUp = (e: MouseEvent) => {
      lastMouseEventRef.current = e;
    };
    const handleNativeMouseDown = (e: MouseEvent) => {
      mouseDownEventRef.current = e;
    };
    window.addEventListener('mouseup', handleNativeMouseUp, { capture: true });
    window.addEventListener('mousedown', handleNativeMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleNativeMouseUp, { capture: true });
      window.removeEventListener('mousedown', handleNativeMouseDown, { capture: true });
    };
  }, []);

  // ============= Unified Selection Handlers (Phase 3) =============
  // These functions use the centralized selection logic from selectionHandlers.ts

  /**
   * Handle bar click selection using unified computeSelectionAction.
   * Used by simple (non-stacked) bar charts.
   */
  const handleBarSelection = useCallback((
    samples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => {
    if (!ctx || samples.length === 0) return;

    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeSelectionAction(
      { indices: samples },
      ctx.selectedSamples,
      modifiers
    );
    executeSelectionAction(ctx, action);
  }, []);

  /**
   * Handle stacked bar click selection using unified computeStackedBarAction.
   * Supports progressive drill-down: bar → segment → clear.
   * Used by partition/fold/metadata/selection stacked charts.
   */
  const handleStackedBarSelection = useCallback((
    barSamples: number[],
    segmentSamples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => {
    if (!ctx || barSamples.length === 0) return;

    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };

    // Always use stacked bar logic for progressive drill-down (bar → segment → clear)
    // If segment samples not detected, use bar samples as segment (first click selects bar)
    const effectiveSegment = segmentSamples.length > 0 ? segmentSamples : barSamples;

    const action = computeStackedBarAction(
      { barIndices: barSamples, segmentIndices: effectiveSegment },
      ctx.selectedSamples,
      modifiers
    );
    executeSelectionAction(ctx, action);
  }, []);

  // ============= Range Selection Handler =============
  // Shared drag selection handler - returns true if drag was handled
  const handleDragSelection = useCallback((e: MouseEvent | null): boolean => {
    if (!rangeSelection.isSelecting || rangeSelection.start === null || rangeSelection.end === null) {
      return false;
    }

    const minY = Math.min(rangeSelection.start, rangeSelection.end);
    const maxY = Math.max(rangeSelection.start, rangeSelection.end);

    // Check if this is a meaningful drag range or just a click
    const binWidth = histogramData.length > 0
      ? histogramData[0].binEnd - histogramData[0].binStart
      : 0;

    const isDragSelection = Math.abs(maxY - minY) > binWidth * 0.3;

    if (isDragSelection) {
      // Drag selection: find all bins that intersect with the selection range
      const samplesInRange: number[] = [];
      histogramData.forEach(bin => {
        if (bin.binEnd >= minY && bin.binStart <= maxY) {
          samplesInRange.push(...bin.samples);
        }
      });

      // Use unified handler for range selection
      handleBarSelection(samplesInRange, e, selectionCtx);
      setRangeSelection({ start: null, end: null, isSelecting: false });
      return true;
    }

    return false;
  }, [rangeSelection, histogramData, selectionCtx, handleBarSelection]);

  // ============= Simple Chart Bar Click Handler =============
  // Handle all click/mouseup interactions on simple (non-stacked) charts
  const handleMouseUp = useCallback((state: RechartsMouseEvent) => {
    const e = lastMouseEventRef.current;

    // Check if this was a drag selection
    if (handleDragSelection(e)) {
      return;
    }

    // Reset range selection state
    setRangeSelection({ start: null, end: null, isSelecting: false });

    // Check if click was on a bar
    const target = e?.target as SVGElement | null;
    const isBar = target?.classList?.contains('recharts-rectangle') ||
      target?.closest('.recharts-bar-rectangle') !== null;

    // Get clicked bar data from Recharts state
    const payload = state?.activePayload;

    if (isBar && payload && payload.length > 0 && payload[0]?.payload) {
      const clickedData = payload[0].payload as BinData;
      if (clickedData?.samples?.length) {
        // Use unified handler
        handleBarSelection(clickedData.samples, e, selectionCtx);
      }
    }
  }, [handleDragSelection, selectionCtx, handleBarSelection]);

  // Export handler
  const handleExport = useCallback(() => {
    const exportData = histogramData.map(h => ({
      bin_center: h.binCenter,
      bin_start: h.binStart,
      bin_end: h.binEnd,
      count: h.count,
    }));
    exportChart(chartRef.current, exportData, 'y_histogram');
  }, [histogramData]);

  // Update config
  const updateConfig = useCallback((updates: Partial<HistogramConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // Determine bar color for simple mode based on global color config
  const getBarColor = useCallback((entry: BinData, _index: number) => {
    // Use effectiveColorMode (derived from globalColorConfig)
    switch (effectiveColorMode) {
      case 'target': {
        // Color by average Y value in bin
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      case 'fold': {
        // Color by dominant fold in bin
        if (uniqueFolds.length > 0) {
          const foldCounts = entry.foldCounts || {};
          let maxFold = -1;
          let maxCount = 0;
          for (const [fold, count] of Object.entries(foldCounts)) {
            if (count > maxCount) {
              maxCount = count;
              maxFold = parseInt(fold, 10);
            }
          }
          if (maxFold >= 0) {
            return getCategoricalColor(maxFold, globalColorConfig?.categoricalPalette ?? 'default');
          }
        }
        return 'hsl(var(--primary) / 0.6)';
      }

      case 'partition': {
        // Check if bin has more train or test samples
        const trainCount = entry.samples.filter(s => colorContext?.trainIndices?.has(s)).length;
        const testCount = entry.samples.filter(s => colorContext?.testIndices?.has(s)).length;
        if (trainCount > testCount) return PARTITION_COLORS.train;
        if (testCount > trainCount) return PARTITION_COLORS.test;
        return 'hsl(var(--primary) / 0.6)';
      }

      case 'outlier': {
        // Color by proportion of outliers in bin
        if (colorContext?.outlierIndices) {
          const outlierCount = entry.samples.filter(s => colorContext.outlierIndices?.has(s)).length;
          if (outlierCount > entry.samples.length / 2) return HIGHLIGHT_COLORS.outlier;
        }
        return 'hsl(var(--muted-foreground) / 0.6)';
      }

      case 'selection':
        return 'hsl(var(--muted-foreground) / 0.6)';

      case 'index': {
        // For index mode, use average sample index in bin
        const avgIndex = entry.samples.length > 0
          ? entry.samples.reduce((a, b) => a + b, 0) / entry.samples.length
          : 0;
        const totalSamples = colorContext?.totalSamples ?? displayY.length;
        const t = avgIndex / Math.max(1, totalSamples - 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      case 'metadata': {
        const metadataKey = globalColorConfig?.metadataKey;
        if (metadataKey && metadata?.[metadataKey] && entry.samples.length > 0) {
          const metadataValues = metadata[metadataKey];
          const metadataType = globalColorConfig?.metadataType ?? detectMetadataType(metadataValues);

          if (metadataType === 'continuous') {
            // Calculate average metadata value for samples in this bin
            const numericValues = metadataValues.filter(v => typeof v === 'number') as number[];
            if (numericValues.length > 0) {
              const sum = entry.samples.reduce((acc, sampleIdx) => {
                const val = metadataValues[sampleIdx];
                return acc + (typeof val === 'number' ? val : 0);
              }, 0);
              const avgValue = sum / entry.samples.length;
              const min = Math.min(...numericValues);
              const max = Math.max(...numericValues);
              const t = normalizeValue(avgValue, min, max);
              return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
            }
          } else {
            // Categorical metadata - find dominant category in bin
            const categoryCounts: Record<string, number> = {};
            entry.samples.forEach(sampleIdx => {
              const val = String(metadataValues[sampleIdx] ?? '');
              if (val && val !== 'undefined' && val !== 'null') {
                categoryCounts[val] = (categoryCounts[val] || 0) + 1;
              }
            });

            // Find dominant category
            let maxCategory = '';
            let maxCount = 0;
            Object.entries(categoryCounts).forEach(([cat, count]) => {
              if (count > maxCount) {
                maxCount = count;
                maxCategory = cat;
              }
            });

            if (maxCategory) {
              const uniqueValues = [...new Set(metadataValues
                .filter(v => v !== null && v !== undefined)
                .map(v => String(v)))].sort();
              const idx = uniqueValues.indexOf(maxCategory);
              return getCategoricalColor(idx >= 0 ? idx : 0, globalColorConfig?.categoricalPalette ?? 'default');
            }
          }
        }
        // Fallback to Y-based coloring
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      default: {
        // Default to Y-based coloring
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }
    }
  }, [effectiveColorMode, uniqueFolds, globalColorConfig, colorContext, stats, displayY.length, metadata]);

  // Check if we should show fold-based display modes
  const hasFolds = uniqueFolds.length > 0;

  // Empty state
  if (!displayY || displayY.length === 0 || !stats) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <BarChart3 className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>No Y values available</p>
        </div>
      </div>
    );
  }

  // Render settings dropdown
  const renderSettingsDropdown = () => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2">
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Histogram Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={config.showMean}
          onCheckedChange={(checked) => updateConfig({ showMean: checked })}
        >
          Show Mean Line
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showMedian}
          onCheckedChange={(checked) => updateConfig({ showMedian: checked })}
        >
          Show Median Line
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showKDE}
          onCheckedChange={(checked) => updateConfig({ showKDE: checked })}
        >
          Show KDE Overlay
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showStdBands}
          onCheckedChange={(checked) => updateConfig({ showStdBands: checked })}
        >
          Show ±1σ Bands
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Y-Axis</DropdownMenuLabel>

        <DropdownMenuCheckboxItem
          checked={config.yAxisType === 'count'}
          onCheckedChange={() => updateConfig({ yAxisType: 'count' })}
        >
          Count
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.yAxisType === 'frequency'}
          onCheckedChange={() => updateConfig({ yAxisType: 'frequency' })}
        >
          Frequency (%)
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.yAxisType === 'density'}
          onCheckedChange={() => updateConfig({ yAxisType: 'density' })}
        >
          Density
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Calculate Y values based on yAxisType
  const getYValue = (count: number) => {
    switch (config.yAxisType) {
      case 'frequency':
        return (count / stats.n) * 100;
      case 'density': {
        const binWidth = histogramData.length > 0
          ? histogramData[0].binEnd - histogramData[0].binStart
          : 1;
        return count / (stats.n * binWidth);
      }
      default:
        return count;
    }
  };

  const yAxisLabel = config.yAxisType === 'frequency' ? '%' : config.yAxisType === 'density' ? 'Density' : 'Count';

  // Render stacked bar chart by partition (train/test)
  const renderStackedByPartition = () => {
    // Transform data for partition stacking
    const stackedData = histogramData.map(bin => {
      const trainSamples = bin.samples.filter(s => colorContext?.trainIndices?.has(s));
      const testSamples = bin.samples.filter(s => colorContext?.testIndices?.has(s));
      return {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
        train: getYValue(trainSamples.length),
        test: getYValue(testSamples.length),
        trainCount: trainSamples.length,
        testCount: testSamples.length,
        trainSamples,
        testSamples,
      };
    });

    // Calculate range selection bounds for ReferenceArea
    const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
      ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
      : null;

    // Unified mouseUp handler - handles EVERYTHING: drag selection, bar clicks, segment clicks
    const handleStackedPartitionMouseUp = (state: RechartsMouseEvent) => {
      const e = lastMouseEventRef.current;

      // 1. Check drag selection first (mouse moved between down and up)
      if (handleDragSelection(e)) {
        return;
      }
      setRangeSelection({ start: null, end: null, isSelecting: false });

      // 2. Check if click was on a bar
      const target = e?.target as SVGElement | null;
      const isBar = target?.classList?.contains('recharts-rectangle') ||
        target?.closest('.recharts-bar-rectangle') !== null;

      if (!isBar) {
        // Background click - clear selection
        if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
          selectionCtx.clear();
        }
        return;
      }

      // 3. Get clicked bar data from Recharts state
      const activeIndex = state?.activeTooltipIndex;
      if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
        return;
      }
      const entry = stackedData[activeIndex];
      if (!entry || !selectionCtx) return;

      // 4. Detect which segment was clicked
      // Find the actual bar rect - if target is the ReferenceArea overlay, look underneath it
      let barRect: Element | null = null;
      if (e && target) {
        if (target.classList.contains('recharts-reference-area-rect')) {
          // Target is the overlay - find bar underneath using elementsFromPoint
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          barRect = elements.find(el =>
            el.classList.contains('recharts-rectangle') &&
            !el.classList.contains('recharts-reference-area-rect')
          ) || null;
        } else if (target.tagName.toLowerCase() === 'rect') {
          barRect = target;
        } else {
          barRect = target.closest('rect');
        }
      }

      const clickedFill = barRect?.getAttribute('fill') || '';

      const segmentSamples = clickedFill === PARTITION_COLORS.test
        ? entry.testSamples
        : entry.trainSamples;

      // 5. Apply 3-click selection logic
      const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
      const action = computeStackedBarAction(
        { barIndices: entry.samples, segmentIndices: segmentSamples },
        selectionCtx.selectedSamples,
        modifiers
      );
      executeSelectionAction(selectionCtx, action);
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stackedData}
          margin={CHART_MARGINS.histogram}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleStackedPartitionMouseUp}
          onMouseLeave={() => {
            if (rangeSelection.isSelecting) {
              setRangeSelection({ start: null, end: null, isSelecting: false });
            }
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload;
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">{data.label}</p>
                  {data.trainCount > 0 && (
                    <p className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: PARTITION_COLORS.train }} />
                      Train: {data.trainCount}
                    </p>
                  )}
                  {data.testCount > 0 && (
                    <p className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: PARTITION_COLORS.test }} />
                      Test: {data.testCount}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
          />
          <Bar
            dataKey="train"
            name="Train"
            stackId="partition"
            fill={PARTITION_COLORS.train}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {stackedData.map((entry, index) => {
              // Check if this segment has selected samples (segment-level highlighting)
              const hasSelectedInSegment = entry.trainSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`train-${index}`}
                  fill={PARTITION_COLORS.train}
                  stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
          <Bar
            dataKey="test"
            name="Test"
            stackId="partition"
            fill={PARTITION_COLORS.test}
            radius={[2, 2, 0, 0]}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {stackedData.map((entry, index) => {
              // Check if this segment has selected samples (segment-level highlighting)
              const hasSelectedInSegment = entry.testSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`test-${index}`}
                  fill={PARTITION_COLORS.test}
                  stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
          {/* Range selection overlay */}
          {rangeSelectionBounds && (
            <ReferenceArea
              x1={rangeSelectionBounds.min}
              x2={rangeSelectionBounds.max}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Render stacked bar chart by fold
  const renderStackedByFold = () => {
    if (uniqueFolds.length === 0) return renderSimpleChart();

    // Transform data for fold stacking
    const stackedData = histogramData.map(bin => {
      const row: Record<string, unknown> = {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
      };
      uniqueFolds.forEach(foldIdx => {
        row[`fold${foldIdx}`] = getYValue(bin.foldCounts?.[foldIdx] || 0);
        row[`fold${foldIdx}Samples`] = bin.foldSamples?.[foldIdx] || [];
      });
      return row;
    });

    // Calculate range selection bounds for ReferenceArea
    const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
      ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
      : null;

    // Unified mouseUp handler - handles EVERYTHING: drag selection, bar clicks, segment clicks
    const handleStackedFoldMouseUp = (state: RechartsMouseEvent) => {
      const e = lastMouseEventRef.current;

      // 1. Check drag selection first
      if (handleDragSelection(e)) {
        return;
      }
      setRangeSelection({ start: null, end: null, isSelecting: false });

      // 2. Check if click was on a bar
      const target = e?.target as SVGElement | null;
      const isBar = target?.classList?.contains('recharts-rectangle') ||
        target?.closest('.recharts-bar-rectangle') !== null;

      if (!isBar) {
        // Background click - clear selection
        if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
          selectionCtx.clear();
        }
        return;
      }

      // 3. Get clicked bar data from Recharts state
      const activeIndex = state?.activeTooltipIndex;
      if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
        return;
      }
      const entry = stackedData[activeIndex];
      if (!entry || !selectionCtx) return;

      // 4. Detect which fold segment was clicked
      // Find the actual bar rect - if target is the ReferenceArea overlay, look underneath it
      let barRect: Element | null = null;
      if (e && target) {
        if (target.classList.contains('recharts-reference-area-rect')) {
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          barRect = elements.find(el =>
            el.classList.contains('recharts-rectangle') &&
            !el.classList.contains('recharts-reference-area-rect')
          ) || null;
        } else if (target.tagName.toLowerCase() === 'rect') {
          barRect = target;
        } else {
          barRect = target.closest('rect');
        }
      }

      const clickedFill = barRect?.getAttribute('fill') || '';
      const palette = globalColorConfig?.categoricalPalette ?? 'default';

      // Find which fold has this color
      let clickedFoldIdx = uniqueFolds[0];
      for (const foldIdx of uniqueFolds) {
        if (getCategoricalColor(foldIdx, palette) === clickedFill) {
          clickedFoldIdx = foldIdx;
          break;
        }
      }

      const barSamples = entry.samples as number[];
      const segmentSamples = (entry[`fold${clickedFoldIdx}Samples`] as number[] | undefined) ?? [];

      // 5. Apply 3-click selection logic
      const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
      const action = computeStackedBarAction(
        { barIndices: barSamples, segmentIndices: segmentSamples },
        selectionCtx.selectedSamples,
        modifiers
      );
      executeSelectionAction(selectionCtx, action);
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stackedData}
          margin={CHART_MARGINS.histogram}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleStackedFoldMouseUp}
          onMouseLeave={() => {
            if (rangeSelection.isSelecting) {
              setRangeSelection({ start: null, end: null, isSelecting: false });
            }
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload;
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">{data.label}</p>
                  {uniqueFolds.map(foldIdx => {
                    const count = data[`fold${foldIdx}`] || 0;
                    if (count === 0) return null;
                    return (
                      <p key={foldIdx} className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: getCategoricalColor(foldIdx, globalColorConfig?.categoricalPalette ?? 'default') }}
                        />
                        Fold {foldIdx + 1}: {typeof count === 'number' ? count.toFixed(config.yAxisType === 'count' ? 0 : 2) : count}
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
            formatter={(value) => (
              <span className="text-[10px]">
                {value.replace('fold', 'Fold ').replace(/(\d+)/, (m: string) => String(Number(m) + 1))}
              </span>
            )}
          />
          {uniqueFolds.map(foldIdx => (
            <Bar
              key={`fold-${foldIdx}`}
              dataKey={`fold${foldIdx}`}
              name={`fold${foldIdx}`}
              stackId="folds"
              fill={getCategoricalColor(foldIdx, globalColorConfig?.categoricalPalette ?? 'default')}
              radius={foldIdx === uniqueFolds[uniqueFolds.length - 1] ? [2, 2, 0, 0] : undefined}
              cursor="pointer"
              {...ANIMATION_CONFIG}
            >
              {stackedData.map((entry, index) => {
                // Check if this segment has selected samples (segment-level highlighting)
                const segmentSamples = (entry[`fold${foldIdx}Samples`] as number[] | undefined) ?? [];
                const hasSelectedInSegment = segmentSamples.some(s => selectedSamples.has(s));
                const isHovered = hoveredBin === index;
                return (
                  <Cell
                    key={`fold-${foldIdx}-${index}`}
                    fill={getCategoricalColor(foldIdx, globalColorConfig?.categoricalPalette ?? 'default')}
                    stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                    strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                  />
                );
              })}
            </Bar>
          ))}
          {/* Range selection overlay */}
          {rangeSelectionBounds && (
            <ReferenceArea
              x1={rangeSelectionBounds.min}
              x2={rangeSelectionBounds.max}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Render stacked bar chart by metadata category
  const renderStackedByMetadata = () => {
    if (metadataCategories.length === 0) return renderSimpleChart();

    const metadataKey = globalColorConfig?.metadataKey;
    if (!metadataKey || !metadata?.[metadataKey]) return renderSimpleChart();

    const metadataValues = metadata[metadataKey];

    // Transform data for metadata category stacking
    const stackedData = histogramData.map(bin => {
      const row: Record<string, unknown> = {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
      };
      // Count samples per category in this bin and store sample indices
      metadataCategories.forEach((category, catIdx) => {
        const categorySamples = bin.samples.filter(sampleIdx => String(metadataValues[sampleIdx]) === category);
        row[`cat${catIdx}`] = getYValue(categorySamples.length);
        row[`cat${catIdx}Count`] = categorySamples.length;
        row[`cat${catIdx}Label`] = category;
        row[`cat${catIdx}Samples`] = categorySamples;
      });
      return row;
    });

    // Calculate range selection bounds for ReferenceArea
    const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
      ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
      : null;

    // Unified mouseUp handler - handles EVERYTHING: drag selection, bar clicks, segment clicks
    const handleStackedMetadataMouseUp = (state: RechartsMouseEvent) => {
      const e = lastMouseEventRef.current;

      // 1. Check drag selection first
      if (handleDragSelection(e)) {
        return;
      }
      setRangeSelection({ start: null, end: null, isSelecting: false });

      // 2. Check if click was on a bar
      const target = e?.target as SVGElement | null;
      const isBar = target?.classList?.contains('recharts-rectangle') ||
        target?.closest('.recharts-bar-rectangle') !== null;

      if (!isBar) {
        // Background click - clear selection
        if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
          selectionCtx.clear();
        }
        return;
      }

      // 3. Get clicked bar data from Recharts state
      const activeIndex = state?.activeTooltipIndex;
      if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
        return;
      }
      const entry = stackedData[activeIndex];
      if (!entry || !selectionCtx) return;

      // 4. Detect which category segment was clicked
      // Find the actual bar rect - if target is the ReferenceArea overlay, look underneath it
      let barRect: Element | null = null;
      if (e && target) {
        if (target.classList.contains('recharts-reference-area-rect')) {
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          barRect = elements.find(el =>
            el.classList.contains('recharts-rectangle') &&
            !el.classList.contains('recharts-reference-area-rect')
          ) || null;
        } else if (target.tagName.toLowerCase() === 'rect') {
          barRect = target;
        } else {
          barRect = target.closest('rect');
        }
      }

      const clickedFill = barRect?.getAttribute('fill') || '';
      const palette = globalColorConfig?.categoricalPalette ?? 'default';

      // Find which category has this color
      let clickedCatIdx = 0;
      for (let catIdx = 0; catIdx < metadataCategories.length; catIdx++) {
        if (getCategoricalColor(catIdx, palette) === clickedFill) {
          clickedCatIdx = catIdx;
          break;
        }
      }

      const barSamples = entry.samples as number[];
      const segmentSamples = (entry[`cat${clickedCatIdx}Samples`] as number[] | undefined) ?? [];

      // 5. Apply 3-click selection logic
      const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
      const action = computeStackedBarAction(
        { barIndices: barSamples, segmentIndices: segmentSamples },
        selectionCtx.selectedSamples,
        modifiers
      );
      executeSelectionAction(selectionCtx, action);
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stackedData}
          margin={CHART_MARGINS.histogram}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleStackedMetadataMouseUp}
          onMouseLeave={() => {
            if (rangeSelection.isSelecting) {
              setRangeSelection({ start: null, end: null, isSelecting: false });
            }
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload;
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">{data.label}</p>
                  {metadataCategories.map((category, catIdx) => {
                    const count = data[`cat${catIdx}Count`] || 0;
                    if (count === 0) return null;
                    return (
                      <p key={catIdx} className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: getCategoricalColor(catIdx, globalColorConfig?.categoricalPalette ?? 'default') }}
                        />
                        {category}: {count}
                      </p>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
            formatter={(value) => {
              const idx = parseInt(value.replace('cat', ''), 10);
              return <span className="text-[10px]">{metadataCategories[idx] ?? value}</span>;
            }}
          />
          {metadataCategories.map((category, catIdx) => (
            <Bar
              key={`cat-${catIdx}`}
              dataKey={`cat${catIdx}`}
              name={`cat${catIdx}`}
              stackId="metadata"
              fill={getCategoricalColor(catIdx, globalColorConfig?.categoricalPalette ?? 'default')}
              radius={catIdx === metadataCategories.length - 1 ? [2, 2, 0, 0] : undefined}
              cursor="pointer"
              {...ANIMATION_CONFIG}
            >
              {stackedData.map((entry, index) => {
                // Check if this segment has selected samples (segment-level highlighting)
                const segmentSamples = (entry[`cat${catIdx}Samples`] as number[] | undefined) ?? [];
                const hasSelectedInSegment = segmentSamples.some(s => selectedSamples.has(s));
                const isHovered = hoveredBin === index;
                return (
                  <Cell
                    key={`cat-${catIdx}-${index}`}
                    fill={getCategoricalColor(catIdx, globalColorConfig?.categoricalPalette ?? 'default')}
                    stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                    strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                  />
                );
              })}
            </Bar>
          ))}
          {/* Range selection overlay */}
          {rangeSelectionBounds && (
            <ReferenceArea
              x1={rangeSelectionBounds.min}
              x2={rangeSelectionBounds.max}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Render stacked bar chart by selection (selected vs unselected)
  const renderStackedBySelection = () => {
    // Transform data for selection stacking
    const stackedData = histogramData.map(bin => {
      const selectedSamplesInBin = bin.samples.filter(s => selectedSamples.has(s));
      const unselectedSamplesInBin = bin.samples.filter(s => !selectedSamples.has(s));
      return {
        binCenter: bin.binCenter,
        binStart: bin.binStart,
        binEnd: bin.binEnd,
        samples: bin.samples,
        label: bin.label,
        selected: getYValue(selectedSamplesInBin.length),
        unselected: getYValue(unselectedSamplesInBin.length),
        selectedCount: selectedSamplesInBin.length,
        unselectedCount: unselectedSamplesInBin.length,
        selectedSamples: selectedSamplesInBin,
        unselectedSamples: unselectedSamplesInBin,
      };
    });

    // Calculate range selection bounds for ReferenceArea
    const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
      ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
      : null;

    // Handle mouseUp for drag selection and background clicks only
    // Unified mouseUp handler - handles EVERYTHING: drag selection, bar clicks, segment clicks
    const handleStackedSelectionMouseUp = (state: RechartsMouseEvent) => {
      const e = lastMouseEventRef.current;

      // 1. Check drag selection first
      if (handleDragSelection(e)) {
        return;
      }
      setRangeSelection({ start: null, end: null, isSelecting: false });

      // 2. Check if click was on a bar
      const target = e?.target as SVGElement | null;
      const isBar = target?.classList?.contains('recharts-rectangle') ||
        target?.closest('.recharts-bar-rectangle') !== null;

      if (!isBar) {
        // Background click - clear selection
        if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
          selectionCtx.clear();
        }
        return;
      }

      // 3. Get clicked bar data from Recharts state
      const activeIndex = state?.activeTooltipIndex;
      if (activeIndex === undefined || activeIndex < 0 || activeIndex >= stackedData.length) {
        return;
      }
      const entry = stackedData[activeIndex];
      if (!entry || !selectionCtx) return;

      // 4. Detect which segment was clicked
      // Find the actual bar rect - if target is the ReferenceArea overlay, look underneath it
      let barRect: Element | null = null;
      if (e && target) {
        if (target.classList.contains('recharts-reference-area-rect')) {
          const elements = document.elementsFromPoint(e.clientX, e.clientY);
          barRect = elements.find(el =>
            el.classList.contains('recharts-rectangle') &&
            !el.classList.contains('recharts-reference-area-rect')
          ) || null;
        } else if (target.tagName.toLowerCase() === 'rect') {
          barRect = target;
        } else {
          barRect = target.closest('rect');
        }
      }

      const clickedFill = barRect?.getAttribute('fill') || '';

      // Determine segment based on fill color (selected uses HIGHLIGHT_COLORS.selected)
      const isSelectedSegment = clickedFill === HIGHLIGHT_COLORS.selected;
      const segmentSamples = isSelectedSegment ? entry.selectedSamples : entry.unselectedSamples;

      // 5. Apply 3-click selection logic
      const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
      const action = computeStackedBarAction(
        { barIndices: entry.samples, segmentIndices: segmentSamples },
        selectionCtx.selectedSamples,
        modifiers
      );
      executeSelectionAction(selectionCtx, action);
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={stackedData}
          margin={CHART_MARGINS.histogram}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleStackedSelectionMouseUp}
          onMouseLeave={() => {
            if (rangeSelection.isSelecting) {
              setRangeSelection({ start: null, end: null, isSelecting: false });
            }
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload;
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">{data.label}</p>
                  {data.selectedCount > 0 && (
                    <p className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: HIGHLIGHT_COLORS.selected }} />
                      Selected: {data.selectedCount}
                    </p>
                  )}
                  {data.unselectedCount > 0 && (
                    <p className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground) / 0.4)' }} />
                      Unselected: {data.unselectedCount}
                    </p>
                  )}
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
          />
          <Bar
            dataKey="unselected"
            name="Unselected"
            stackId="selection"
            fill="hsl(var(--muted-foreground) / 0.4)"
            cursor="pointer"
            isAnimationActive={false}
          >
            {stackedData.map((entry, index) => {
              // For the "unselected" segment, show border if any of its samples are now selected
              // (This can happen when click selects the whole bar first, then segment drill-down)
              const hasSelectedInSegment = entry.unselectedSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`unselected-${index}`}
                  fill="hsl(var(--muted-foreground) / 0.4)"
                  stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
          <Bar
            dataKey="selected"
            name="Selected"
            stackId="selection"
            fill={HIGHLIGHT_COLORS.selected}
            radius={[2, 2, 0, 0]}
            cursor="pointer"
            isAnimationActive={false}
          >
            {stackedData.map((entry, index) => {
              // For the "selected" segment, show border if any of its samples are selected
              const hasSelectedInSegment = entry.selectedSamples.some(s => selectedSamples.has(s));
              const isHovered = hoveredBin === index;
              return (
                <Cell
                  key={`selected-${index}`}
                  fill={HIGHLIGHT_COLORS.selected}
                  stroke={hasSelectedInSegment ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={hasSelectedInSegment ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
          {/* Range selection overlay */}
          {rangeSelectionBounds && (
            <ReferenceArea
              x1={rangeSelectionBounds.min}
              x2={rangeSelectionBounds.max}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Render simple bar chart (with KDE and reference lines)
  const renderSimpleChart = () => {
    const chartData = histogramData.map(bin => ({
      ...bin,
      displayCount: getYValue(bin.count),
    }));

    // Merge KDE data - find nearest KDE point for each bin center
    // kdeData is already scaled to match histogram count scale
    const mergedData = chartData.map((bin) => {
      // Find nearest KDE point to bin center
      let nearestKde: { x: number; density: number } | undefined;
      let minDist = Infinity;
      for (const kp of kdeData) {
        const dist = Math.abs(kp.x - bin.binCenter);
        if (dist < minDist) {
          minDist = dist;
          nearestKde = kp;
        }
      }
      // Convert KDE density to the same scale as displayCount
      const kdeValue = nearestKde ? getYValue(nearestKde.density) : undefined;
      return {
        ...bin,
        kde: kdeValue,
      };
    });

    // Calculate range selection bounds for ReferenceArea
    const rangeSelectionBounds = rangeSelection.start !== null && rangeSelection.end !== null
      ? { min: Math.min(rangeSelection.start, rangeSelection.end), max: Math.max(rangeSelection.start, rangeSelection.end) }
      : null;

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={mergedData}
          margin={CHART_MARGINS.histogram}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => {
            if (rangeSelection.isSelecting) {
              setRangeSelection({ start: null, end: null, isSelecting: false });
            }
            // Clear hover when mouse leaves chart
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            allowDecimals={config.yAxisType !== 'count'}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload as BinData & { displayCount: number };
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">{data.label}</p>
                  <p className="text-muted-foreground">
                    {yAxisLabel}: {data.displayCount.toFixed(config.yAxisType === 'count' ? 0 : 2)}
                    {config.yAxisType === 'count' && ` (${((data.count / stats.n) * 100).toFixed(1)}%)`}
                  </p>
                </div>
              );
            }}
          />

          {/* ±1σ bands */}
          {config.showStdBands && stats && (
            <>
              <ReferenceLine
                x={stats.mean - stats.std}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
              <ReferenceLine
                x={stats.mean + stats.std}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                strokeOpacity={0.5}
              />
            </>
          )}

          {/* Range selection overlay */}
          {rangeSelectionBounds && (
            <ReferenceArea
              x1={rangeSelectionBounds.min}
              x2={rangeSelectionBounds.max}
              fill="hsl(var(--primary))"
              fillOpacity={0.15}
              stroke="hsl(var(--primary))"
              strokeOpacity={0.5}
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}

          {/* Mean reference line */}
          {config.showMean && stats && (
            <ReferenceLine
              x={stats.mean}
              stroke="hsl(217, 70%, 50%)"
              strokeWidth={2}
              label={{
                value: 'μ',
                position: 'top',
                fontSize: 10,
                fill: 'hsl(217, 70%, 50%)',
              }}
            />
          )}

          {/* Median reference line */}
          {config.showMedian && stats && (
            <ReferenceLine
              x={stats.median}
              stroke="hsl(142, 70%, 45%)"
              strokeWidth={2}
              strokeDasharray="5 5"
              label={{
                value: 'Med',
                position: 'top',
                fontSize: 10,
                fill: 'hsl(142, 70%, 45%)',
              }}
            />
          )}

          {/* Histogram bars */}
          <Bar
            dataKey="displayCount"
            radius={[2, 2, 0, 0]}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {mergedData.map((entry, index) => {
              const isSelected = selectedBins.has(index);
              const isHovered = hoveredBin === index;
              const fillColor = getBarColor(entry, index);
              return (
                <Cell
                  key={`cell-${index}`}
                  fill={fillColor}
                  stroke={isSelected ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>

          {/* KDE overlay - uses the kde property merged into bar data */}
          {config.showKDE && (
            <Line
              dataKey="kde"
              type="monotone"
              stroke="hsl(280, 65%, 55%)"
              strokeWidth={2}
              dot={false}
              connectNulls
              {...ANIMATION_CONFIG}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  // Phase 5: Render classification bar chart
  const renderClassificationChart = () => {
    if (!isClassificationMode || classBarData.length === 0) {
      return renderSimpleChart();
    }

    const totalCount = classBarData.reduce((sum, d) => sum + d.count, 0);

    // Get class bar color - now just returns the base color (selection handled via stroke)
    const getClassBarColor = (entry: ClassBarData, _index: number) => {
      // Use categorical color for each class
      if (globalColorConfig) {
        return getCategoricalColor(entry.classIndex, globalColorConfig.categoricalPalette);
      }
      return getCategoricalColor(entry.classIndex, 'default');
    };

    const chartData = classBarData.map(bar => ({
      ...bar,
      displayCount: config.yAxisType === 'frequency'
        ? (bar.count / totalCount) * 100
        : bar.count,
    }));

    // Handle click for classification chart - uses unified bar selection
    const handleClassChartMouseUp = (state: RechartsMouseEvent) => {
      const e = lastMouseEventRef.current;

      // Check if click was on a bar
      const target = e?.target as SVGElement | null;
      const isBar = target?.classList?.contains('recharts-rectangle') ||
        target?.closest('.recharts-bar-rectangle') !== null;

      const payload = state?.activePayload;
      if (isBar && payload && payload.length > 0 && payload[0]?.payload) {
        const clickedData = payload[0].payload as unknown as ClassBarData;
        if (clickedData?.samples?.length) {
          // Use unified handler for simple bar selection
          handleBarSelection(clickedData.samples, e, selectionCtx);
          return;
        }
      }
      // No bar clicked - clear selection
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
    };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={CHART_MARGINS.histogram}
          onMouseUp={handleClassChartMouseUp}
          onMouseLeave={() => {
            if (selectionCtx) {
              selectionCtx.setHovered(null);
            }
          }}
        >
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="classLabel"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            interval={0}
            tick={{ fontSize: 10 }}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={35}
            allowDecimals={config.yAxisType !== 'count'}
            label={{
              value: yAxisLabel,
              angle: -90,
              position: 'insideLeft',
              fontSize: 9,
            }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload }) => {
              if (!payload || payload.length === 0) return null;
              const data = payload[0]?.payload as ClassBarData & { displayCount: number };
              if (!data) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium">Class: {data.classLabel}</p>
                  <p className="text-muted-foreground">
                    {yAxisLabel}: {data.displayCount.toFixed(config.yAxisType === 'count' ? 0 : 1)}
                    {config.yAxisType === 'count' && ` (${((data.count / totalCount) * 100).toFixed(1)}%)`}
                  </p>
                </div>
              );
            }}
          />
          <Bar
            dataKey="displayCount"
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onMouseEnter={(data: { payload?: ClassBarData }) => {
              if (selectionCtx && data.payload?.samples?.length) {
                selectionCtx.setHovered(data.payload.samples[0]);
              }
            }}
            {...ANIMATION_CONFIG}
          >
            {chartData.map((entry, index) => {
              const isSelected = selectedClasses.has(entry.classIndex);
              const isHovered = hoveredClass === entry.classIndex;
              const fillColor = getClassBarColor(entry, index);
              return (
                <Cell
                  key={`class-cell-${index}`}
                  fill={fillColor}
                  stroke={isSelected ? 'hsl(var(--foreground))' : isHovered ? 'hsl(var(--primary))' : 'none'}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 0}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Select renderer based on color mode
  const renderChart = () => {
    // Phase 5: Use classification chart for categorical targets
    if (isClassificationMode && classBarData.length > 0) {
      return renderClassificationChart();
    }

    // Stack by partition (train/test) when partition mode is selected
    if (shouldStackByPartition && colorContext?.trainIndices && colorContext?.testIndices) {
      return renderStackedByPartition();
    }

    // Stack by fold when fold mode is selected and folds are available
    if (shouldStackByFold && hasFolds) {
      return renderStackedByFold();
    }

    // Stack by metadata category when metadata mode is selected with categorical type
    if (shouldStackByMetadata && metadataCategories.length > 0) {
      return renderStackedByMetadata();
    }

    // Stack by selection when selection mode is selected
    if (shouldStackBySelection) {
      return renderStackedBySelection();
    }

    return renderSimpleChart();
  };

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-1 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          {isClassificationMode ? 'Class Distribution' : 'Y Distribution'}
          {isProcessed && (
            <span className="text-[10px] text-muted-foreground font-normal">(processed)</span>
          )}
          {isClassificationMode && (
            <span className="text-[10px] text-muted-foreground font-normal">
              ({colorContext?.classLabels?.length ?? 0} classes)
            </span>
          )}
        </h3>

        <div className="flex items-center gap-1">
          {/* Bin count selector */}
          <Select
            value={config.binCount}
            onValueChange={(v) => updateConfig({ binCount: v as BinCountOption })}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="30">30</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>

          {/* Settings dropdown */}
          {renderSettingsDropdown()}

          {/* Clear selection button - only show when there's a selection */}
          {selectionCtx && selectionCtx.selectedSamples.size > 0 && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => selectionCtx.clear()}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">Clear selection ({selectionCtx.selectedSamples.size})</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          {/* Export button */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Export chart</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {renderChart()}
      </div>

      {/* Statistics footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2">
          {isClassificationMode ? (
            // Phase 5: Class distribution stats
            <div className="flex items-center gap-3 text-[10px] flex-1 overflow-x-auto">
              {classBarData.slice(0, 6).map((bar, idx) => (
                <div
                  key={bar.classLabel}
                  className={cn(
                    'flex items-center gap-1.5 shrink-0',
                    selectedClasses.has(idx) && 'font-medium'
                  )}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: globalColorConfig
                        ? getCategoricalColor(idx, globalColorConfig.categoricalPalette)
                        : getCategoricalColor(idx, 'default'),
                    }}
                  />
                  <span className="text-muted-foreground truncate max-w-[60px]">{bar.classLabel}</span>
                  <span className="font-mono">{bar.count}</span>
                </div>
              ))}
              {classBarData.length > 6 && (
                <span className="text-muted-foreground">+{classBarData.length - 6} more</span>
              )}
            </div>
          ) : (
            // Regression stats - show selected stats if there's a selection, otherwise all stats
            <div className="grid grid-cols-5 gap-1 text-[10px] flex-1">
              {[
                { label: 'Mean', value: displayStats?.mean ?? 0, highlight: config.showMean },
                { label: 'Med', value: displayStats?.median ?? 0, highlight: config.showMedian },
                { label: 'Std', value: displayStats?.std ?? 0 },
                { label: 'Min', value: displayStats?.min ?? 0 },
                { label: 'Max', value: displayStats?.max ?? 0 },
              ].map(({ label, value, highlight }) => (
                <div
                  key={label}
                  className={cn(
                    'bg-muted rounded p-1 text-center',
                    highlight && 'ring-1 ring-primary/50',
                    selectedSamples.size > 0 && 'ring-1 ring-primary/30'
                  )}
                >
                  <div className="text-muted-foreground">{label}</div>
                  <div className="font-mono font-medium">{formatYValue(value, 1)}</div>
                </div>
              ))}
            </div>
          )}
          {selectedSamples.size > 0 && (
            <div className="text-[10px] text-primary font-medium ml-2">
              {selectedSamples.size} sel.
            </div>
          )}
        </div>
      )}

      {/* Color legend */}
      {globalColorConfig && colorContext && !compact && (
        <div className="mt-2">
          <InlineColorLegend config={globalColorConfig} context={colorContext} />
        </div>
      )}
    </div>
  );
}

export default React.memo(YHistogramV2);
