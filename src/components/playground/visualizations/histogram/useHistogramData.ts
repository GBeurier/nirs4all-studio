/**
 * Shared hook for YHistogramV2: bins computation, KDE, statistics, selection, event handlers.
 *
 * All shared logic that was previously inline in YHistogramV2 is extracted here.
 * Mode-specific chart components consume this hook's return value via props.
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { useSelection, type SelectionContextValue } from '@/context/SelectionContext';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { extractModifiers } from '@/lib/playground/selectionUtils';
import {
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  detectMetadataType,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import { exportChart } from '@/lib/chartExport';
import { formatYValue } from '../chartConfig';
import { computeKDE, calculateOptimalBinCount } from './utils';
import {
  type YHistogramV2Props,
  type BinData,
  type ClassBarData,
  type YStats,
  type HistogramConfig,
  type RechartsMouseEvent,
  type RangeSelection,
  DEFAULT_CONFIG,
  RANGE_SELECTION_INITIAL,
} from './types';

export function useHistogramData(props: YHistogramV2Props) {
  const {
    y,
    processedY,
    folds,
    metadata,
    selectedSample: externalSelectedSample,
    useSelectionContext: useSelectionContextFlag = true,
    compact = false,
    globalColorConfig,
    colorContext,
  } = props;

  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<HistogramConfig>(DEFAULT_CONFIG);

  // Range selection state for brush selection on Y axis
  const [rangeSelection, setRangeSelection] = useState<RangeSelection>(RANGE_SELECTION_INITIAL);

  // SelectionContext integration for cross-chart highlighting
  // Always call hook unconditionally, then conditionally use the result
  const fullSelectionCtx = useSelection();
  const selectionCtx = useSelectionContextFlag ? fullSelectionCtx : null;

  // Determine effective selection state
  const selectedSamples = useSelectionContextFlag
    ? fullSelectionCtx.selectedSamples
    : new Set<number>(externalSelectedSample !== null && externalSelectedSample !== undefined
      ? [externalSelectedSample]
      : []);

  const hoveredSample = useSelectionContextFlag ? fullSelectionCtx.hoveredSample : null;

  // Use processed Y if available
  const displayY = processedY && processedY.length === y.length ? processedY : y;
  const isProcessed = processedY && processedY.length === y.length;

  // Determine effective color mode from global config
  const effectiveColorMode = globalColorConfig?.mode ?? 'target';

  // Determine stacking modes
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
      return { histogramData: [] as BinData[], sampleBins: [] as number[] };
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
    if (!isClassificationMode) return [] as number[];
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

    return { mean, median, std, min: sorted[0], max: sorted[n - 1], n, q1, q3 };
  }, [displayY, colorContext?.displayFilteredIndices]);

  // Compute stats for selected samples
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

    return { mean, median, std, min: sorted[0], max: sorted[n - 1], n, q1, q3 };
  }, [displayY, selectedSamples]);

  // Stats to display in footer
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
    if (!folds?.fold_labels) return [] as number[];
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

  const hasFolds = uniqueFolds.length > 0;

  // ============= getYValue and yAxisLabel =============

  const getYValue = useCallback((count: number) => {
    switch (config.yAxisType) {
      case 'frequency':
        return stats ? (count / stats.n) * 100 : count;
      case 'density': {
        const binWidth = histogramData.length > 0
          ? histogramData[0].binEnd - histogramData[0].binStart
          : 1;
        return stats ? count / (stats.n * binWidth) : count;
      }
      default:
        return count;
    }
  }, [config.yAxisType, stats, histogramData]);

  const yAxisLabel = config.yAxisType === 'frequency' ? '%' : config.yAxisType === 'density' ? 'Density' : 'Count';

  // ============= Mouse Event Tracking =============

  const lastMouseEventRef = useRef<MouseEvent | null>(null);

  useEffect(() => {
    const handleNativeMouseUp = (e: MouseEvent) => {
      lastMouseEventRef.current = e;
    };
    const handleNativeMouseDown = (e: MouseEvent) => {
      // Store for use in drag detection
      void e;
    };
    window.addEventListener('mouseup', handleNativeMouseUp, { capture: true });
    window.addEventListener('mousedown', handleNativeMouseDown, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleNativeMouseUp, { capture: true });
      window.removeEventListener('mousedown', handleNativeMouseDown, { capture: true });
    };
  }, []);

  // ============= Range Selection Handlers =============

  const handleMouseDown = useCallback((e: RechartsMouseEvent) => {
    if (!e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel as string);
    if (!isNaN(yValue)) {
      setRangeSelection({ start: yValue, end: yValue, isSelecting: true });
    }
  }, []);

  const handleMouseMove = useCallback((e: RechartsMouseEvent) => {
    // Handle range selection only - hover propagation disabled for performance
    if (!rangeSelection.isSelecting || !e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel as string);
    if (!isNaN(yValue)) {
      setRangeSelection(prev => ({ ...prev, end: yValue }));
    }
  }, [rangeSelection.isSelecting]);

  const handleMouseLeave = useCallback(() => {
    if (rangeSelection.isSelecting) {
      setRangeSelection(RANGE_SELECTION_INITIAL);
    }
    if (selectionCtx) {
      selectionCtx.setHovered(null);
    }
  }, [rangeSelection.isSelecting, selectionCtx]);

  // ============= Unified Selection Handlers (Phase 3) =============

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
   */
  const handleStackedBarSelection = useCallback((
    barSamples: number[],
    segmentSamples: number[],
    e: MouseEvent | null,
    ctx: SelectionContextValue | null
  ) => {
    if (!ctx || barSamples.length === 0) return;

    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const effectiveSegment = segmentSamples.length > 0 ? segmentSamples : barSamples;

    const action = computeStackedBarAction(
      { barIndices: barSamples, segmentIndices: effectiveSegment },
      ctx.selectedSamples,
      modifiers
    );
    executeSelectionAction(ctx, action);
  }, []);

  // ============= Drag Selection Handler =============

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
      setRangeSelection(RANGE_SELECTION_INITIAL);
      return true;
    }

    return false;
  }, [rangeSelection, histogramData, selectionCtx, handleBarSelection]);

  // ============= Export Handler =============

  const handleExport = useCallback(() => {
    const exportData = histogramData.map(h => ({
      bin_center: h.binCenter,
      bin_start: h.binStart,
      bin_end: h.binEnd,
      count: h.count,
    }));
    exportChart(chartRef.current, exportData, 'y_histogram');
  }, [histogramData]);

  // ============= Config Update =============

  const updateConfig = useCallback((updates: Partial<HistogramConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // ============= Bar Color (simple mode) =============

  const getBarColor = useCallback((entry: BinData, _index: number) => {
    switch (effectiveColorMode) {
      case 'target': {
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }

      case 'fold': {
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
        const trainCount = entry.samples.filter(s => colorContext?.trainIndices?.has(s)).length;
        const testCount = entry.samples.filter(s => colorContext?.testIndices?.has(s)).length;
        if (trainCount > testCount) return PARTITION_COLORS.train;
        if (testCount > trainCount) return PARTITION_COLORS.test;
        return 'hsl(var(--primary) / 0.6)';
      }

      case 'outlier': {
        if (colorContext?.outlierIndices) {
          const outlierCount = entry.samples.filter(s => colorContext.outlierIndices?.has(s)).length;
          if (outlierCount > entry.samples.length / 2) return HIGHLIGHT_COLORS.outlier;
        }
        return 'hsl(var(--muted-foreground) / 0.6)';
      }

      case 'selection':
        return 'hsl(var(--muted-foreground) / 0.6)';

      case 'index': {
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
            const categoryCounts: Record<string, number> = {};
            entry.samples.forEach(sampleIdx => {
              const val = String(metadataValues[sampleIdx] ?? '');
              if (val && val !== 'undefined' && val !== 'null') {
                categoryCounts[val] = (categoryCounts[val] || 0) + 1;
              }
            });

            let maxCategory = '';
            let maxCatCount = 0;
            Object.entries(categoryCounts).forEach(([cat, count]) => {
              if (count > maxCatCount) {
                maxCatCount = count;
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
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig?.continuousPalette ?? 'blue_red');
      }
    }
  }, [effectiveColorMode, uniqueFolds, globalColorConfig, colorContext, stats, displayY.length, metadata]);

  return {
    // Refs
    chartRef,
    lastMouseEventRef,

    // Config state
    config,
    updateConfig,

    // Computed data
    displayY,
    isProcessed: !!isProcessed,
    histogramData,
    sampleBins,
    stats,
    selectedStats,
    displayStats,
    kdeData,
    classBarData,
    sampleToClass,

    // Mode detection
    effectiveColorMode,
    isClassificationMode,
    shouldStackByPartition,
    shouldStackByFold,
    shouldStackByMetadata,
    shouldStackBySelection,
    hasFolds,
    uniqueFolds,
    metadataCategories,

    // Selection state
    selectedSamples,
    hoveredSample,
    selectedBins,
    hoveredBin,
    selectedClasses,
    hoveredClass,
    selectionCtx,

    // Range selection
    rangeSelection,
    setRangeSelection,

    // Computed values
    getYValue,
    yAxisLabel,
    getBarColor,

    // Handlers
    handleMouseDown,
    handleMouseMove,
    handleMouseLeave,
    handleDragSelection,
    handleBarSelection,
    handleStackedBarSelection,
    handleExport,

    // Pass-through props
    compact,
    globalColorConfig,
    colorContext,
    metadata,
    folds,
  };
}

export type UseHistogramDataReturn = ReturnType<typeof useHistogramData>;
