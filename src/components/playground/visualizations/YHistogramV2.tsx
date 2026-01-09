/**
 * YHistogramV2 - Enhanced Y distribution histogram (Phase 3)
 *
 * Features:
 * - Configurable bin count (auto, 10, 20, 50, custom)
 * - Color by: target value, fold, metadata column, spectral metric
 * - Stacked fold display mode
 * - Ridge plot fold display mode
 * - Overlaid transparency mode
 * - KDE overlay toggle
 * - Reference lines (mean, median)
 * - Cross-chart selection highlighting via SelectionContext
 * - Export functionality (PNG, CSV)
 */

import React, { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
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
  Brush,
  ReferenceArea,
} from 'recharts';
import {
  BarChart3,
  Download,
  Settings2,
  Layers,
  TrendingUp,
  ChevronDown,
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
  getFoldColor,
  formatYValue,
  FOLD_COLORS,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getCategoricalColor,
  getContinuousColor,
  normalizeValue,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
} from '@/lib/playground/colorConfig';
import { type TargetType } from '@/lib/playground/targetTypeDetection';
import { useSelection } from '@/context/SelectionContext';
import type { FoldsInfo } from '@/types/playground';
import { cn } from '@/lib/utils';

// ============= Types =============

export type HistogramColorMode = 'uniform' | 'fold' | 'metadata' | 'metric';
export type HistogramDisplayMode = 'simple' | 'stacked' | 'overlaid' | 'ridge';
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
  colorMode: HistogramColorMode;
  displayMode: HistogramDisplayMode;
  showKDE: boolean;
  showMean: boolean;
  showMedian: boolean;
  showStdBands: boolean;
  yAxisType: 'count' | 'frequency' | 'density';
  metadataKey?: string;
  metricKey?: string;
}

// Recharts mouse event type for histogram interactions
interface RechartsMouseEvent {
  activeLabel?: number | string;
  activePayload?: Array<{ payload?: BinData }>;
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
  colorMode: 'uniform',
  displayMode: 'simple',
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

  // Ridge plot data transformation
  const ridgePlotData = useMemo(() => {
    if (config.displayMode !== 'ridge' || uniqueFolds.length === 0) return null;

    const ridgeHeight = 100 / (uniqueFolds.length + 1);
    const ridgeOverlap = 0.4;

    return uniqueFolds.map((foldIdx, i) => {
      const foldBins = histogramData.map(bin => ({
        binCenter: bin.binCenter,
        count: bin.foldCounts?.[foldIdx] || 0,
        offset: i * ridgeHeight * (1 - ridgeOverlap),
        foldIndex: foldIdx,
        samples: bin.foldSamples?.[foldIdx] || [],
      }));
      return {
        foldIndex: foldIdx,
        data: foldBins,
        color: getFoldColor(foldIdx),
      };
    });
  }, [config.displayMode, uniqueFolds, histogramData]);

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

  // Handle bar click - select all samples in the bin
  // Recharts Bar onClick passes: (data, index, event) where data contains payload property
  const handleClick = useCallback((data: unknown, _index: number, event?: React.MouseEvent) => {
    // Recharts wraps the data - extract payload if present
    const rawData = data as { payload?: BinData } | BinData;
    const binData = 'payload' in rawData && rawData.payload ? rawData.payload : rawData as BinData;

    if (!binData?.samples?.length) {
      console.warn('YHistogramV2: No samples in clicked bin', binData);
      return;
    }

    if (selectionCtx) {
      if (event?.shiftKey) {
        selectionCtx.select(binData.samples, 'add');
      } else if (event?.ctrlKey || event?.metaKey) {
        selectionCtx.toggle(binData.samples);
      } else {
        selectionCtx.select(binData.samples, 'replace');
      }
    } else if (externalOnSelectSample) {
      externalOnSelectSample(binData.samples[0]);
    }
  }, [selectionCtx, externalOnSelectSample]);

  // Handle background click to clear selection
  const handleChartBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'svg' || target.classList.contains('recharts-surface') || target.classList.contains('recharts-wrapper')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
    }
  }, [selectionCtx]);

  // Handle range selection on X axis (Y value range)
  const handleMouseDown = useCallback((e: RechartsMouseEvent) => {
    // Don't start range selection when clicking directly on a bar
    // (bar click is handled separately by handleClick)
    if (e?.activePayload && e.activePayload.length > 0 && e.activePayload[0]?.payload?.samples?.length > 0) {
      return;
    }
    if (!e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel);
    if (!isNaN(yValue)) {
      setRangeSelection({ start: yValue, end: yValue, isSelecting: true });
    }
  }, []);

  const handleMouseMove = useCallback((e: RechartsMouseEvent) => {
    // Handle hover detection for SelectionContext
    if (selectionCtx && e?.activePayload?.[0]?.payload) {
      const binData = e.activePayload[0].payload as BinData;
      if (binData?.samples?.length > 0) {
        // Hover the first sample in the bin
        const sampleToHover = binData.samples[0];
        if (selectionCtx.hoveredSample !== sampleToHover) {
          selectionCtx.setHovered(sampleToHover);
        }
      }
    }

    // Handle range selection
    if (!rangeSelection.isSelecting || !e?.activeLabel) return;
    const yValue = typeof e.activeLabel === 'number' ? e.activeLabel : parseFloat(e.activeLabel);
    if (!isNaN(yValue)) {
      setRangeSelection(prev => ({ ...prev, end: yValue }));
    }
  }, [rangeSelection.isSelecting, selectionCtx]);

  // Recharts provides CategoricalChartState, but we need native event for modifiers
  // Store last native event for use in Recharts handler
  const lastMouseEventRef = useRef<MouseEvent | null>(null);

  // Track native mouse events for modifier keys
  useEffect(() => {
    const handleNativeMouseUp = (e: MouseEvent) => {
      lastMouseEventRef.current = e;
    };
    window.addEventListener('mouseup', handleNativeMouseUp, { capture: true });
    return () => {
      window.removeEventListener('mouseup', handleNativeMouseUp, { capture: true });
    };
  }, []);

  const handleMouseUp = useCallback(() => {
    const e = lastMouseEventRef.current;
    if (!rangeSelection.isSelecting || rangeSelection.start === null || rangeSelection.end === null) {
      setRangeSelection({ start: null, end: null, isSelecting: false });
      return;
    }

    const minY = Math.min(rangeSelection.start, rangeSelection.end);
    const maxY = Math.max(rangeSelection.start, rangeSelection.end);

    // Only process if there's a meaningful range (not just a click)
    const binWidth = histogramData.length > 0
      ? histogramData[0].binEnd - histogramData[0].binStart
      : 0;

    if (Math.abs(maxY - minY) > binWidth * 0.5) {
      // Find all samples within the Y range
      const samplesInRange: number[] = [];
      displayY.forEach((yVal, idx) => {
        if (yVal >= minY && yVal <= maxY) {
          samplesInRange.push(idx);
        }
      });

      if (samplesInRange.length > 0 && selectionCtx) {
        if (e?.shiftKey) {
          selectionCtx.select(samplesInRange, 'add');
        } else if (e?.ctrlKey || e?.metaKey) {
          selectionCtx.toggle(samplesInRange);
        } else {
          selectionCtx.select(samplesInRange, 'replace');
        }
      }
    }

    setRangeSelection({ start: null, end: null, isSelecting: false });
  }, [rangeSelection, displayY, histogramData, selectionCtx]);

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

  // Determine bar color for simple mode
  const getBarColor = useCallback((entry: BinData, index: number) => {
    const isSelected = selectedBins.has(index);
    const isHovered = hoveredBin === index;
    const hasSelection = selectedSamples.size > 0;

    if (isHovered) return 'hsl(var(--primary))';
    if (isSelected) return 'hsl(var(--primary))';
    if (hasSelection) return 'hsl(var(--primary) / 0.2)';

    // Use global color config if provided
    if (globalColorConfig) {
      const mode = globalColorConfig.mode;

      if (mode === 'target') {
        // Color by average Y value in bin
        const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
        return getContinuousColor(t, globalColorConfig.continuousPalette);
      }

      if (mode === 'fold' && uniqueFolds.length > 0) {
        // Color by dominant fold in bin
        const foldCounts = entry.foldCounts || {};
        let maxFold = -1;
        let maxCount = 0;
        for (const [fold, count] of Object.entries(foldCounts)) {
          if (count > maxCount) {
            maxCount = count;
            maxFold = parseInt(fold, 10);
          }
        }
        return maxFold >= 0 ? getCategoricalColor(maxFold, globalColorConfig.categoricalPalette) : 'hsl(var(--primary) / 0.6)';
      }

      if (mode === 'partition') {
        // Check if bin has more train or test samples
        const trainCount = entry.samples.filter(s => colorContext?.trainIndices?.has(s)).length;
        const testCount = entry.samples.filter(s => colorContext?.testIndices?.has(s)).length;
        if (trainCount > testCount) return PARTITION_COLORS.train;
        if (testCount > trainCount) return PARTITION_COLORS.test;
        return 'hsl(var(--primary) / 0.6)';
      }

      if (mode === 'outlier' && colorContext?.outlierIndices) {
        // Color by proportion of outliers in bin
        const outlierCount = entry.samples.filter(s => colorContext.outlierIndices?.has(s)).length;
        if (outlierCount > entry.samples.length / 2) return HIGHLIGHT_COLORS.outlier;
        return 'hsl(var(--muted-foreground) / 0.6)';
      }

      if (mode === 'selection') {
        return 'hsl(var(--muted-foreground) / 0.6)';
      }

      // Default to Y-based coloring for other modes
      const t = normalizeValue(entry.binCenter, stats?.min ?? 0, stats?.max ?? 1);
      return getContinuousColor(t, globalColorConfig.continuousPalette);
    }

    // Legacy behavior
    if (config.colorMode === 'fold' && uniqueFolds.length > 0) {
      // Color by dominant fold in bin
      const foldCounts = entry.foldCounts || {};
      let maxFold = -1;
      let maxCount = 0;
      for (const [fold, count] of Object.entries(foldCounts)) {
        if (count > maxCount) {
          maxCount = count;
          maxFold = parseInt(fold, 10);
        }
      }
      return maxFold >= 0 ? getFoldColor(maxFold) : 'hsl(var(--primary) / 0.6)';
    }

    return 'hsl(var(--primary) / 0.6)';
  }, [selectedBins, hoveredBin, selectedSamples.size, config.colorMode, uniqueFolds, globalColorConfig, colorContext, stats]);

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

  // Render ridge plot
  const renderRidgePlot = () => {
    if (!ridgePlotData) return null;

    const maxCount = Math.max(
      ...ridgePlotData.flatMap(r => r.data.map(d => d.count))
    );

    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart margin={CHART_MARGINS.histogram}>
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="binCenter"
            type="number"
            domain={['dataMin', 'dataMax']}
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            tickFormatter={(v) => formatYValue(v, 1)}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
          />
          {ridgePlotData.map((ridge, ridgeIdx) => (
            <Area
              key={`ridge-${ridge.foldIndex}`}
              data={ridge.data.map(d => ({
                binCenter: d.binCenter,
                [`fold${ridge.foldIndex}`]: d.count + d.offset * maxCount,
              }))}
              dataKey={`fold${ridge.foldIndex}`}
              fill={ridge.color}
              fillOpacity={0.6}
              stroke={ridge.color}
              strokeWidth={1.5}
              type="monotone"
              baseValue={ridge.data[0]?.offset * maxCount || 0}
              {...ANIMATION_CONFIG}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  };

  // Render stacked bar chart
  const renderStackedChart = () => {
    if (uniqueFolds.length === 0) return renderSimpleChart();

    // Transform data for stacking
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

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={stackedData} margin={CHART_MARGINS.histogram}>
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
                          style={{ backgroundColor: getFoldColor(foldIdx) }}
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
              stackId="folds"
              fill={getFoldColor(foldIdx)}
              radius={foldIdx === uniqueFolds[uniqueFolds.length - 1] ? [2, 2, 0, 0] : undefined}
              {...ANIMATION_CONFIG}
            />
          ))}
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

    // Merge KDE data
    const mergedData = chartData.map((bin, idx) => {
      const kdePoint = kdeData.find(k =>
        k.x >= bin.binStart && k.x < bin.binEnd
      );
      return {
        ...bin,
        kde: kdePoint ? getYValue(kdePoint.density * (bin.binEnd - bin.binStart) * stats.n) : undefined,
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
            onClick={handleClick}
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {mergedData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getBarColor(entry, index)}
                stroke={selectedBins.has(index) || hoveredBin === index ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={selectedBins.has(index) || hoveredBin === index ? 1 : 0}
              />
            ))}
          </Bar>

          {/* KDE overlay */}
          {config.showKDE && kdeData.length > 0 && (
            <Line
              data={kdeData.map(d => ({
                binCenter: d.x,
                kde: d.density,
              }))}
              dataKey="kde"
              type="monotone"
              stroke="hsl(280, 65%, 55%)"
              strokeWidth={2}
              dot={false}
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

    // Get class bar color
    const getClassBarColor = (entry: ClassBarData, _index: number) => {
      const isSelected = selectedClasses.has(entry.classIndex);
      const isHovered = hoveredClass === entry.classIndex;
      const hasSelection = selectedSamples.size > 0;

      if (isHovered) return 'hsl(var(--primary))';
      if (isSelected) return 'hsl(var(--primary))';
      if (hasSelection) return 'hsl(var(--primary) / 0.2)';

      // Use categorical color for each class
      if (globalColorConfig) {
        return getCategoricalColor(entry.classIndex, globalColorConfig.categoricalPalette);
      }
      return getCategoricalColor(entry.classIndex, 'default');
    };

    // Handle class bar click
    const handleClassClick = (data: unknown, _index: number, event?: React.MouseEvent) => {
      const rawData = data as { payload?: ClassBarData } | ClassBarData;
      const barData = 'payload' in rawData && rawData.payload ? rawData.payload : rawData as ClassBarData;

      if (!barData?.samples?.length) return;

      if (selectionCtx) {
        if (event?.shiftKey) {
          selectionCtx.select(barData.samples, 'add');
        } else if (event?.ctrlKey || event?.metaKey) {
          selectionCtx.toggle(barData.samples);
        } else {
          selectionCtx.select(barData.samples, 'replace');
        }
      } else if (externalOnSelectSample) {
        externalOnSelectSample(barData.samples[0]);
      }
    };

    const chartData = classBarData.map(bar => ({
      ...bar,
      displayCount: config.yAxisType === 'frequency'
        ? (bar.count / totalCount) * 100
        : bar.count,
    }));

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={chartData}
          margin={CHART_MARGINS.histogram}
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
            onClick={handleClassClick}
            cursor="pointer"
            onMouseEnter={(data: { payload?: ClassBarData }) => {
              if (selectionCtx && data.payload?.samples?.length) {
                selectionCtx.setHovered(data.payload.samples[0]);
              }
            }}
            {...ANIMATION_CONFIG}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`class-cell-${index}`}
                fill={getClassBarColor(entry, index)}
                stroke={selectedClasses.has(entry.classIndex) || hoveredClass === entry.classIndex ? 'hsl(var(--primary))' : 'none'}
                strokeWidth={selectedClasses.has(entry.classIndex) || hoveredClass === entry.classIndex ? 1 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  };

  // Select renderer based on display mode
  const renderChart = () => {
    // Phase 5: Use classification chart for categorical targets
    if (isClassificationMode && classBarData.length > 0) {
      return renderClassificationChart();
    }

    switch (config.displayMode) {
      case 'ridge':
        return hasFolds ? renderRidgePlot() : renderSimpleChart();
      case 'stacked':
        return hasFolds ? renderStackedChart() : renderSimpleChart();
      case 'overlaid':
        return hasFolds ? renderStackedChart() : renderSimpleChart();
      default:
        return renderSimpleChart();
    }
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

          {/* Display mode selector (only when folds available) */}
          {hasFolds && (
            <Select
              value={config.displayMode}
              onValueChange={(v) => updateConfig({ displayMode: v as HistogramDisplayMode })}
            >
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Simple</SelectItem>
                <SelectItem value="stacked">Stacked</SelectItem>
                <SelectItem value="ridge">Ridge</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Color mode selector */}
          {hasFolds && config.displayMode === 'simple' && (
            <Select
              value={config.colorMode}
              onValueChange={(v) => updateConfig({ colorMode: v as HistogramColorMode })}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="uniform">Color</SelectItem>
                <SelectItem value="fold">Fold</SelectItem>
              </SelectContent>
            </Select>
          )}

          {/* Settings dropdown */}
          {renderSettingsDropdown()}

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
      <div className="flex-1 min-h-0" onClick={handleChartBackgroundClick}>
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
            // Regression stats
            <div className="grid grid-cols-5 gap-1 text-[10px] flex-1">
              {[
                { label: 'Mean', value: stats?.mean ?? 0, highlight: config.showMean },
                { label: 'Med', value: stats?.median ?? 0, highlight: config.showMedian },
                { label: 'Std', value: stats?.std ?? 0 },
                { label: 'Min', value: stats?.min ?? 0 },
                { label: 'Max', value: stats?.max ?? 0 },
              ].map(({ label, value, highlight }) => (
                <div
                  key={label}
                  className={cn(
                    'bg-muted rounded p-1 text-center',
                    highlight && 'ring-1 ring-primary/50'
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

      {/* Fold legend for stacked/ridge modes */}
      {hasFolds && (config.displayMode === 'stacked' || config.displayMode === 'ridge') && !compact && (
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          {uniqueFolds.slice(0, 5).map(foldIdx => (
            <span key={foldIdx} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm"
                style={{ backgroundColor: getFoldColor(foldIdx) }}
              />
              <span>F{foldIdx + 1}</span>
            </span>
          ))}
          {uniqueFolds.length > 5 && (
            <span className="text-muted-foreground">+{uniqueFolds.length - 5} more</span>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(YHistogramV2);
