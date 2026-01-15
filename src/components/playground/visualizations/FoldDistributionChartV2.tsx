/**
 * FoldDistributionChartV2 - Enhanced fold visualization (Phase 3)
 *
 * Features:
 * - Color by mean target value per partition
 * - Color by metadata mode per partition
 * - Color by mean spectral metric per partition
 * - Interactive: click bar → select samples in partition via SelectionContext
 * - Improved tooltips with partition statistics
 * - View modes: counts, distribution, both
 * - Cross-chart selection highlighting
 * - Export functionality
 */

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  ComposedChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  Legend,
  ErrorBar,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import {
  LayoutGrid,
  Download,
  Settings2,
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
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { exportDataAsCSV } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatFoldLabel,
  formatYValue,
  computeUniformBins,
  getUniformBinIndex,
  calculateOptimalBinCount,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getContinuousColor,
  getCategoricalColor,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
  normalizeValue,
} from '@/lib/playground/colorConfig';
import { isCategoricalTarget } from '@/lib/playground/targetTypeDetection';
import { useSelection, type SelectionContextValue } from '@/context/SelectionContext';
import type { FoldsInfo, FoldData, YStats } from '@/types/playground';
import { cn } from '@/lib/utils';
import {
  computeSelectionAction,
  computeStackedBarAction,
  executeSelectionAction,
} from '@/lib/playground/selectionHandlers';
import { extractModifiers } from '@/lib/playground/selectionUtils';

// ============= Types =============

export type FoldColorMode = 'partition' | 'target_mean' | 'metadata' | 'metric';
export type FoldViewMode = 'counts' | 'distribution' | 'both';

interface FoldDistributionChartV2Props {
  /** Fold information from backend */
  folds: FoldsInfo | null;
  /** Y values for coloring and statistics */
  y?: number[];
  /** Metadata for metadata-based coloring */
  metadata?: Record<string, unknown[]>;
  /** Spectral metrics for metric-based coloring */
  spectralMetrics?: Record<string, number[]>;
  /** Currently selected fold (null = all folds) */
  selectedFold?: number | null;
  /** Callback when fold is selected */
  onSelectFold?: (foldIndex: number | null) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
  /** Enable SelectionContext integration */
  useSelectionContext?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Global color configuration (unified system) */
  globalColorConfig?: GlobalColorConfig;
  /** Color context data for unified color system */
  colorContext?: ColorContext;
}

interface ChartConfig {
  viewMode: FoldViewMode;
  colorMode: FoldColorMode;
  metadataKey?: string;
  metricKey?: string;
  showMeanLine: boolean;
  showLegend: boolean;
  showYLegend: boolean;
  barOrientation: 'horizontal' | 'vertical';
}

/**
 * Data structure for partition-based visualization (separate bars per partition)
 * Each bar represents a single partition (train or val/test for a specific fold)
 */
interface PartitionBarData {
  /** Numeric index for the bar (used for ReferenceArea) */
  index: number;
  /** Label for the bar (e.g., "Train 1", "Val 1", "Test") */
  label: string;
  /** Unique identifier for the partition */
  partitionId: string;
  /** Partition type: 'train' | 'val' | 'test' */
  partitionType: 'train' | 'val' | 'test';
  /** Fold index (null for held-out test set) */
  foldIndex: number | null;
  /** Total count of samples in this partition */
  count: number;
  /** Sample indices in this partition */
  indices: number[];
  /** Y mean for this partition */
  yMean?: number;
  /** Y std for this partition */
  yStd?: number;
  /** Stacked segment counts for coloration modes */
  segments: Record<string, number>;
  /** Stacked segment sample indices for selection (Phase 5: Unified Selection) */
  segmentIndices: Record<string, number[]>;
}

interface FoldYData {
  fold: string;
  foldIndex: number;
  trainMean: number;
  trainStd: number;
  trainMin: number;
  trainMax: number;
  testMean: number;
  testStd: number;
  testMin: number;
  testMax: number;
  trainLower: number;
  trainUpper: number;
  testLower: number;
  testUpper: number;
}

/**
 * Result of computing segments - includes both counts and sample indices
 * (Phase 5: Enhanced to support segment-level selection)
 */
interface SegmentResult {
  counts: Record<string, number>;
  indices: Record<string, number[]>;
}

// ============= Default Configuration =============

const DEFAULT_CONFIG: ChartConfig = {
  viewMode: 'counts',
  colorMode: 'partition',
  showMeanLine: false,
  showLegend: true,
  showYLegend: false,
  barOrientation: 'vertical',
};

// ============= Color Helpers =============

/**
 * Get color based on Y mean value (blue to red gradient)
 */
function getYMeanColor(
  yMean: number,
  yMin: number,
  yMax: number,
  palette?: GlobalColorConfig['continuousPalette']
): string {
  if (yMax === yMin) return 'hsl(180, 60%, 50%)';
  const t = normalizeValue(yMean, yMin, yMax);
  if (palette) {
    return getContinuousColor(t, palette);
  }
  // Default blue to red
  const hue = 240 - t * 180;
  return `hsl(${hue}, 70%, 50%)`;
}

// ============= Component =============

export function FoldDistributionChartV2({
  folds,
  y,
  metadata,
  spectralMetrics,
  selectedFold: externalSelectedFold,
  onSelectFold,
  isLoading = false,
  useSelectionContext = true,
  compact = false,
  globalColorConfig,
  colorContext,
}: FoldDistributionChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [internalSelectedFold, setInternalSelectedFold] = useState<number | null>(null);
  // Track which partition was clicked in THIS chart (for stroke display)
  // This is separate from selectedSamples because in k-fold CV, training sets overlap
  const [clickedPartitionId, setClickedPartitionId] = useState<string | null>(null);

  // Drag selection state
  const [rangeSelection, setRangeSelection] = useState<{
    start: number | null;
    end: number | null;
    isSelecting: boolean;
  }>({ start: null, end: null, isSelecting: false });

  // Recharts provides CategoricalChartState, but we need native event for modifiers and click position
  // Store last native events for use in Recharts handlers
  const lastMouseEventRef = useRef<MouseEvent | null>(null);
  const mouseDownEventRef = useRef<MouseEvent | null>(null);
  // Track when we just completed a drag selection to prevent background click from clearing
  const justCompletedDragRef = useRef<boolean>(false);

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

  // SelectionContext integration - always call hook, conditionally use result
  const selectionHook = useSelection();
  const selectionCtx = useSelectionContext ? selectionHook : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();

  // Use external selection if provided
  const selectedFold = externalSelectedFold ?? internalSelectedFold;
  const handleSelectFold = onSelectFold ?? setInternalSelectedFold;

  // Determine effective color mode (global or internal)
  const effectiveColorMode = globalColorConfig?.mode ?? 'partition';

  // Phase 5: Detect if target is classification
  const isClassificationMode = useMemo(() => {
    return colorContext?.targetType && isCategoricalTarget(colorContext.targetType);
  }, [colorContext?.targetType]);

  // Get class labels for classification mode
  const classLabels = colorContext?.classLabels ?? [];

  // Calculate optimal bin count using Freedman-Diaconis rule (same as YHistogram)
  // Use shared utility to ensure consistency with Y Histogram
  const optimalBinCount = useMemo(() => {
    if (!y || y.length < 4) return 5;
    // Use same bin count range as Y Histogram for consistency
    return calculateOptimalBinCount(y, 5, 50);
  }, [y]);

  // Compute Y bins for target mode (regression) using UNIFORM binning
  // This ensures bins match exactly with Y Histogram ranges
  const yBins = useMemo(() => {
    if (!y || y.length === 0 || isClassificationMode) return [];
    return computeUniformBins(y, optimalBinCount);
  }, [y, isClassificationMode, optimalBinCount]);

  // Get unique metadata values for metadata mode
  const metadataCategories = useMemo(() => {
    if (!globalColorConfig?.metadataKey || !colorContext?.metadata) return [];
    const values = colorContext.metadata[globalColorConfig.metadataKey];
    if (!values) return [];
    return [...new Set(values.filter(v => v !== null && v !== undefined))].slice(0, 10) as string[];
  }, [globalColorConfig?.metadataKey, colorContext?.metadata]);

  /**
   * Compute segment counts and indices for a set of indices based on color mode.
   * Returns both counts (for rendering bar heights) and indices (for selection).
   */
  const computeSegments = useCallback((indices: number[]): SegmentResult => {
    const counts: Record<string, number> = {};
    const segmentIndices: Record<string, number[]> = {};
    const total = indices.length;

    switch (effectiveColorMode) {
      case 'partition':
        // In partition mode, the bar itself represents the partition, so just show total
        counts.total = total;
        segmentIndices.total = [...indices];
        break;

      case 'target':
        // Classification mode - group by class
        if (isClassificationMode && classLabels.length > 0 && y) {
          classLabels.forEach((label, i) => {
            const segKey = `class_${i}`;
            const matching = indices.filter(idx => {
              const yVal = y[idx];
              return yVal !== undefined && String(yVal) === label;
            });
            counts[segKey] = matching.length;
            segmentIndices[segKey] = matching;
          });
        } else if (y && yBins.length > 0) {
          // Regression mode - group samples by Y bin using uniform binning
          yBins.forEach((bin, i) => {
            const segKey = `bin_${i}`;
            const matching = indices.filter(idx => {
              const yVal = y[idx];
              return yVal !== undefined && getUniformBinIndex(yVal, yBins) === i;
            });
            counts[segKey] = matching.length;
            segmentIndices[segKey] = matching;
          });
        } else {
          counts.total = total;
          segmentIndices.total = [...indices];
        }
        break;

      case 'fold':
        counts.total = total;
        segmentIndices.total = [...indices];
        break;

      case 'outlier':
        if (colorContext?.outlierIndices) {
          const outliers = indices.filter(idx => colorContext.outlierIndices!.has(idx));
          const normals = indices.filter(idx => !colorContext.outlierIndices!.has(idx));
          counts.outlier = outliers.length;
          counts.normal = normals.length;
          segmentIndices.outlier = outliers;
          segmentIndices.normal = normals;
        } else {
          counts.normal = total;
          segmentIndices.normal = [...indices];
        }
        break;

      case 'selection': {
        const selected = indices.filter(idx => selectedSamples.has(idx));
        const unselected = indices.filter(idx => !selectedSamples.has(idx));
        counts.selected = selected.length;
        counts.unselected = unselected.length;
        segmentIndices.selected = selected;
        segmentIndices.unselected = unselected;
        break;
      }

      case 'metadata':
        if (globalColorConfig?.metadataKey && colorContext?.metadata) {
          const values = colorContext.metadata[globalColorConfig.metadataKey];
          if (values) {
            const uncategorized: number[] = [];
            metadataCategories.forEach((cat, i) => {
              const segKey = `meta_${i}`;
              const matching = indices.filter(idx => values[idx] === cat);
              counts[segKey] = matching.length;
              segmentIndices[segKey] = matching;
            });
            // Find uncategorized samples
            const categorizedSet = new Set(metadataCategories);
            indices.forEach(idx => {
              if (!categorizedSet.has(values[idx] as string)) {
                uncategorized.push(idx);
              }
            });
            if (uncategorized.length > 0) {
              counts.other = uncategorized.length;
              segmentIndices.other = uncategorized;
            }
          }
        } else {
          counts.total = total;
          segmentIndices.total = [...indices];
        }
        break;

      default:
        counts.total = total;
        segmentIndices.total = [...indices];
    }

    return { counts, indices: segmentIndices };
  }, [effectiveColorMode, y, yBins, isClassificationMode, classLabels, colorContext, selectedSamples, globalColorConfig?.metadataKey, metadataCategories]);

  // Phase 4: Get display filter from colorContext
  const displayFilteredIndices = colorContext?.displayFilteredIndices;

  /**
   * Transform fold data into partition-based bars
   * Creates separate bars for each partition: Train 1, Val 1, Train 2, Val 2, ..., Test
   * Phase 4: Filters by displayFilteredIndices when present (selected only / unselected only)
   */
  const partitionBarData = useMemo((): PartitionBarData[] => {
    if (!folds || !folds.folds || folds.folds.length === 0) return [];

    const bars: Omit<PartitionBarData, 'index'>[] = [];

    // Helper to filter indices by display filter
    const filterIndices = (indices: number[]): number[] => {
      if (!displayFilteredIndices) return indices;
      return indices.filter(i => displayFilteredIndices.has(i));
    };
    const nFolds = folds.n_folds;

    // Detect held-out test samples using multiple methods:
    // 1. Metadata 'set' column with 'test' values (user's explicit partition)
    // 2. fold_labels array: -1 indicates samples not in any fold's test set
    // 3. Indices not present in any fold's train/test indices

    // Method 1: Check metadata for 'set' column (highest priority - user's explicit partition)
    const heldOutFromMetadata: number[] = [];
    if (metadata && 'set' in metadata) {
      const setColumn = metadata.set as unknown[];
      setColumn.forEach((value, idx) => {
        const strValue = String(value).toLowerCase();
        if (strValue === 'test' || strValue === 'holdout' || strValue === 'held-out') {
          heldOutFromMetadata.push(idx);
        }
      });
    }

    // Method 2: Use fold_labels if available
    // Backend sets fold_labels[i] = -1 for held-out test samples
    const heldOutFromLabels: number[] = [];
    if (folds.fold_labels && folds.fold_labels.length > 0) {
      folds.fold_labels.forEach((label, idx) => {
        if (label === -1) {
          heldOutFromLabels.push(idx);
        }
      });
    }

    // Method 3: Find indices not in any fold (fallback)
    const allFoldIndices = new Set<number>();
    folds.folds.forEach(fold => {
      fold.train_indices.forEach(idx => allFoldIndices.add(idx));
      fold.test_indices.forEach(idx => allFoldIndices.add(idx));
    });

    // Determine total samples - prefer fold_labels.length, then y.length, then max index
    const totalSamples = folds.fold_labels?.length ??
      y?.length ??
      Math.max(...folds.folds.flatMap(f => [...f.train_indices, ...f.test_indices])) + 1;

    // Find samples not in any fold's indices
    const heldOutFromIndices: number[] = [];
    for (let i = 0; i < totalSamples; i++) {
      if (!allFoldIndices.has(i)) {
        heldOutFromIndices.push(i);
      }
    }

    // Use metadata method first (user's explicit partition), then fold_labels, then indices
    const heldOutTestIndices = heldOutFromMetadata.length > 0
      ? heldOutFromMetadata
      : heldOutFromLabels.length > 0
        ? heldOutFromLabels
        : heldOutFromIndices;

    // For simple train/test split (n_folds = 1), show Train and Test
    if (nFolds === 1) {
      const fold = folds.folds[0];
      const filteredTrainIndices = filterIndices(fold.train_indices);
      const filteredTestIndices = filterIndices(fold.test_indices);
      const trainSegments = computeSegments(filteredTrainIndices);
      const testSegments = computeSegments(filteredTestIndices);

      // Train bar
      bars.push({
        label: 'Train',
        partitionId: 'train-0',
        partitionType: 'train',
        foldIndex: 0,
        count: filteredTrainIndices.length,
        indices: filteredTrainIndices,
        yMean: fold.y_train_stats?.mean,
        yStd: fold.y_train_stats?.std,
        segments: trainSegments.counts,
        segmentIndices: trainSegments.indices,
      });

      // Test bar
      bars.push({
        label: 'Test',
        partitionId: 'test-0',
        partitionType: 'test',
        foldIndex: 0,
        count: filteredTestIndices.length,
        indices: filteredTestIndices,
        yMean: fold.y_test_stats?.mean,
        yStd: fold.y_test_stats?.std,
        segments: testSegments.counts,
        segmentIndices: testSegments.indices,
      });

      // Add numeric index to each bar for ReferenceArea support
      return bars.map((bar, idx) => ({ ...bar, index: idx }));
    }

    // For k-fold CV (n_folds > 1), show Train i, Val i for each fold
    folds.folds.forEach((fold, i) => {
      const foldNum = i + 1;
      const filteredTrainIndices = filterIndices(fold.train_indices);
      const filteredTestIndices = filterIndices(fold.test_indices);
      const trainSegments = computeSegments(filteredTrainIndices);
      const valSegments = computeSegments(filteredTestIndices);

      // Train bar for this fold
      bars.push({
        label: `Train ${foldNum}`,
        partitionId: `train-${i}`,
        partitionType: 'train',
        foldIndex: i,
        count: filteredTrainIndices.length,
        indices: filteredTrainIndices,
        yMean: fold.y_train_stats?.mean,
        yStd: fold.y_train_stats?.std,
        segments: trainSegments.counts,
        segmentIndices: trainSegments.indices,
      });

      // Validation bar for this fold
      bars.push({
        label: `Val ${foldNum}`,
        partitionId: `val-${i}`,
        partitionType: 'val',
        foldIndex: i,
        count: filteredTestIndices.length,
        indices: filteredTestIndices,
        yMean: fold.y_test_stats?.mean,
        yStd: fold.y_test_stats?.std,
        segments: valSegments.counts,
        segmentIndices: valSegments.indices,
      });
    });

    // Add held-out test bar if present
    const filteredHeldOutIndices = filterIndices(heldOutTestIndices);
    if (filteredHeldOutIndices.length > 0) {
      let yMean: number | undefined;
      let yStd: number | undefined;
      if (y && y.length > 0) {
        const testYValues = filteredHeldOutIndices
          .map(i => y[i])
          .filter(v => v !== undefined);
        if (testYValues.length > 0) {
          yMean = testYValues.reduce((a, b) => a + b, 0) / testYValues.length;
          const variance = testYValues.reduce((sum, v) => sum + Math.pow(v - yMean!, 2), 0) / testYValues.length;
          yStd = Math.sqrt(variance);
        }
      }
      const heldOutSegments = computeSegments(filteredHeldOutIndices);

      bars.push({
        label: 'Test',
        partitionId: 'test-holdout',
        partitionType: 'test',
        foldIndex: null,
        count: filteredHeldOutIndices.length,
        indices: filteredHeldOutIndices,
        yMean,
        yStd,
        segments: heldOutSegments.counts,
        segmentIndices: heldOutSegments.indices,
      });
    }

    // Add numeric index to each bar for ReferenceArea support
    return bars.map((bar, idx) => ({ ...bar, index: idx })) as PartitionBarData[];
  }, [folds, y, metadata, computeSegments, displayFilteredIndices]);

  // Clear clickedPartitionId when selection changes externally (from another chart)
  // This ensures stroke is only shown on the clicked partition when clicking in THIS chart
  React.useEffect(() => {
    if (clickedPartitionId && partitionBarData.length > 0) {
      const clickedPartition = partitionBarData.find(p => p.partitionId === clickedPartitionId);
      if (clickedPartition) {
        // Check if current selection still matches the clicked partition
        const selectionMatchesClickedPartition =
          selectedSamples.size === clickedPartition.indices.length &&
          clickedPartition.indices.every(idx => selectedSamples.has(idx));

        if (!selectionMatchesClickedPartition) {
          // Selection changed (probably from another chart), clear clicked state
          setClickedPartitionId(null);
        }
      }
    }
  }, [selectedSamples, clickedPartitionId, partitionBarData]);

  /**
   * Get segment keys for partition bar mode (different from stacked fold mode)
   */
  const partitionSegmentKeys = useMemo(() => {
    switch (effectiveColorMode) {
      case 'partition':
        // In partition mode with separate bars, just show total per bar
        return ['total'];
      case 'target':
        if (isClassificationMode && classLabels.length > 0) {
          return classLabels.map((_, i) => `class_${i}`);
        }
        return yBins.map((_, i) => `bin_${i}`);
      case 'fold':
        return ['total'];
      case 'outlier':
        return ['normal', 'outlier'];
      case 'selection':
        return ['unselected', 'selected'];
      case 'metadata':
        return [...metadataCategories.map((_, i) => `meta_${i}`), 'other'];
      default:
        return ['total'];
    }
  }, [effectiveColorMode, yBins, metadataCategories, isClassificationMode, classLabels]);

  // Transform fold data for Y distribution visualization
  const yData = useMemo<FoldYData[]>(() => {
    if (!folds || !folds.folds) return [];

    return folds.folds
      .filter(fold => fold.y_train_stats && fold.y_test_stats)
      .map((fold) => {
        const trainStats = fold.y_train_stats!;
        const testStats = fold.y_test_stats!;

        return {
          fold: formatFoldLabel(fold.fold_index),
          foldIndex: fold.fold_index,
          trainMean: trainStats.mean,
          trainStd: trainStats.std,
          trainMin: trainStats.min,
          trainMax: trainStats.max,
          testMean: testStats.mean,
          testStd: testStats.std,
          testMin: testStats.min,
          testMax: testStats.max,
          trainLower: trainStats.std,
          trainUpper: trainStats.std,
          testLower: testStats.std,
          testUpper: testStats.std,
        };
      });
  }, [folds]);

  const hasYStats = yData.length > 0;

  // Y value range for coloring
  const yRange = useMemo(() => {
    if (!y || y.length === 0) return { min: 0, max: 1 };
    return {
      min: Math.min(...y),
      max: Math.max(...y),
    };
  }, [y]);

  // Global mean for reference line
  const globalYMean = useMemo(() => {
    if (!y || y.length === 0) return null;
    return y.reduce((a, b) => a + b, 0) / y.length;
  }, [y]);

  // Get train/test colors from global palette
  const trainColor = PARTITION_COLORS.train;
  const trainColorLight = PARTITION_COLORS.trainLight;
  const testColor = PARTITION_COLORS.test;
  const testColorLight = PARTITION_COLORS.testLight;

  // Get held-out test color from categorical palette (index 4 = purple in default palette)
  const catPalette = globalColorConfig?.categoricalPalette ?? 'default';
  const heldOutTestColor = getCategoricalColor(4, catPalette);
  // Create a lighter version by adjusting the HSL
  const heldOutTestColorLight = useMemo(() => {
    // Parse the HSL color and lighten it
    const match = heldOutTestColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (match) {
      const [, h, s, l] = match;
      return `hsl(${h}, ${Math.max(0, parseInt(s) - 20)}%, ${Math.min(100, parseInt(l) + 20)}%)`;
    }
    // Fallback for hex colors
    return heldOutTestColor;
  }, [heldOutTestColor]);

  /**
   * Get the base bar color for a partition bar based on partition type
   * Uses global color configuration for consistency with other charts
   */
  const getPartitionBarColor = useCallback((entry: PartitionBarData, isHighlighted: boolean): string => {
    switch (entry.partitionType) {
      case 'train':
        return isHighlighted ? trainColor : trainColorLight;
      case 'val':
        // Validation bars use test color (orange)
        return isHighlighted ? testColor : testColorLight;
      case 'test':
        // Held-out test uses color from categorical palette for consistency
        return isHighlighted ? heldOutTestColor : heldOutTestColorLight;
      default:
        return 'hsl(var(--primary))';
    }
  }, [trainColor, trainColorLight, testColor, testColorLight, heldOutTestColor, heldOutTestColorLight]);

  /**
   * Get segment color for a partition bar entry
   * Used when coloring by target, metadata, etc.
   */
  const getPartitionSegmentColor = useCallback((segmentKey: string, entry: PartitionBarData): string => {
    const palette = globalColorConfig?.continuousPalette ?? 'blue_red';
    const catPalette = globalColorConfig?.categoricalPalette ?? 'default';

    switch (effectiveColorMode) {
      case 'partition':
        // In partition mode, color by partition type
        return getPartitionBarColor(entry, selectedFold === entry.foldIndex || selectedFold === null);

      case 'target': {
        if (segmentKey.startsWith('class_')) {
          const classIdx = parseInt(segmentKey.replace('class_', ''), 10);
          return getCategoricalColor(classIdx, catPalette);
        }
        const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
        const t = yBins.length > 1 ? binIdx / (yBins.length - 1) : 0.5;
        return getContinuousColor(t, palette);
      }

      case 'fold':
        // Color by fold index
        if (entry.foldIndex !== null) {
          return getCategoricalColor(entry.foldIndex, catPalette);
        }
        return 'hsl(var(--muted-foreground))';

      case 'outlier':
        if (segmentKey === 'outlier') {
          return 'hsl(0, 70%, 55%)';
        }
        return 'hsl(var(--muted-foreground))';

      case 'selection':
        if (segmentKey === 'selected') {
          return 'hsl(var(--primary))';
        }
        return 'hsl(var(--muted-foreground) / 0.4)';

      case 'metadata': {
        if (segmentKey === 'other') {
          return 'hsl(var(--muted-foreground) / 0.5)';
        }
        const metaIdx = parseInt(segmentKey.replace('meta_', ''), 10);
        return getCategoricalColor(metaIdx, catPalette);
      }

      default:
        return getPartitionBarColor(entry, true);
    }
  }, [effectiveColorMode, globalColorConfig, selectedFold, getPartitionBarColor, yBins]);

  // Get segment label for legend
  const getSegmentLabel = useCallback((segmentKey: string): string => {
    switch (effectiveColorMode) {
      case 'partition':
        return segmentKey === 'train' ? 'Train' : 'Test';
      case 'target': {
        // Phase 5: Classification mode - return class label
        if (segmentKey.startsWith('class_')) {
          const classIdx = parseInt(segmentKey.replace('class_', ''), 10);
          return classLabels[classIdx] ?? `Class ${classIdx + 1}`;
        }
        // Regression mode - Y bin labels with actual range values
        const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
        if (yBins[binIdx]) {
          const bin = yBins[binIdx];
          // Format the range as "min - max" for the label
          const formatVal = (v: number) => v.toFixed(v < 10 ? 2 : 1);
          return `${formatVal(bin.min)} - ${formatVal(bin.max)}`;
        }
        return `Bin ${binIdx + 1}`;
      }
      case 'fold':
        return 'Samples';
      case 'outlier':
        return segmentKey === 'outlier' ? 'Outliers' : 'Normal';
      case 'selection':
        return segmentKey === 'selected' ? 'Selected' : 'Unselected';
      case 'metadata': {
        if (segmentKey === 'other') return 'Other';
        const metaIdx = parseInt(segmentKey.replace('meta_', ''), 10);
        return String(metadataCategories[metaIdx] ?? `Category ${metaIdx + 1}`);
      }
      default:
        return segmentKey;
    }
  }, [effectiveColorMode, metadataCategories, classLabels, yBins]);

  // Handle background click
  const handleChartBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Skip if we just completed a drag selection (click event fires after mouseup)
    if (justCompletedDragRef.current) {
      return;
    }
    const target = e.target as HTMLElement;
    if (target.tagName === 'svg' || target.classList.contains('recharts-surface')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      setClickedPartitionId(null);
      handleSelectFold(null);
    }
  }, [selectionCtx, handleSelectFold]);

  // Export handler
  const handleExport = useCallback(() => {
    if (!folds) return;

    const exportData = folds.folds.map(fold => {
      const row: Record<string, string | number> = {
        fold: formatFoldLabel(fold.fold_index),
        train_count: fold.train_count,
        test_count: fold.test_count,
      };
      if (fold.y_train_stats) {
        row.train_y_mean = fold.y_train_stats.mean;
        row.train_y_std = fold.y_train_stats.std;
      }
      if (fold.y_test_stats) {
        row.test_y_mean = fold.y_test_stats.mean;
        row.test_y_std = fold.y_test_stats.std;
      }
      return row;
    });

    exportDataAsCSV(exportData, 'fold_distribution');
  }, [folds]);

  // Update config
  const updateConfig = useCallback((updates: Partial<ChartConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  // --- Drag Selection Handlers ---

  /** Detect if mouse moved significantly (drag) vs click */
  const isDrag = useCallback((e: MouseEvent | null): boolean => {
    const downEvent = mouseDownEventRef.current;
    if (!e || !downEvent) return false;
    const dx = Math.abs(e.clientX - downEvent.clientX);
    const dy = Math.abs(e.clientY - downEvent.clientY);
    return dx > 5 || dy > 5;
  }, []);

  /**
   * Handle bar selection using unified selection handlers.
   * Used for drag selection to avoid stale closure issues.
   * Pattern copied from YHistogramV2.
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

  /** Handle drag selection and return true if handled, false if it's a click */
  const handleDragSelection = useCallback((e: MouseEvent | null): boolean => {
    if (!e || !rangeSelection.isSelecting) return false;
    if (!isDrag(e)) return false;

    const { start, end } = rangeSelection;
    if (start === null || end === null) {
      setRangeSelection({ start: null, end: null, isSelecting: false });
      return false;
    }

    // Collect all samples in the range (inclusive of both start and end)
    const minIdx = Math.min(start, end);
    const maxIdx = Math.max(start, end);
    const samplesInRange: number[] = [];
    partitionBarData.slice(minIdx, maxIdx + 1).forEach(entry => {
      samplesInRange.push(...entry.indices);
    });

    // Use unified handler for range selection (same pattern as YHistogramV2)
    handleBarSelection(samplesInRange, e, selectionCtx);
    setClickedPartitionId(null);

    // Prevent background click from clearing the selection
    justCompletedDragRef.current = true;
    setTimeout(() => { justCompletedDragRef.current = false; }, 100);

    setRangeSelection({ start: null, end: null, isSelecting: false });
    return true;
  }, [rangeSelection, isDrag, partitionBarData, selectionCtx, handleBarSelection]);

  /** Handle chart mouse down - start potential drag */
  const handleChartMouseDown = useCallback((state: { activeTooltipIndex?: number }) => {
    if (state?.activeTooltipIndex !== undefined && state.activeTooltipIndex >= 0) {
      setRangeSelection({ start: state.activeTooltipIndex, end: state.activeTooltipIndex, isSelecting: true });
    }
  }, []);

  /** Handle chart mouse move - update drag range */
  const handleChartMouseMove = useCallback((state: { activeTooltipIndex?: number }) => {
    if (rangeSelection.isSelecting && state?.activeTooltipIndex !== undefined && state.activeTooltipIndex >= 0) {
      setRangeSelection(prev => ({ ...prev, end: state.activeTooltipIndex! }));
    }
  }, [rangeSelection.isSelecting]);

  /** Handle chart mouse up - finalize drag or handle click with segment detection */
  const handleChartMouseUp = useCallback((state: { activeTooltipIndex?: number }) => {
    const e = lastMouseEventRef.current;

    // 1. Check drag selection first
    if (handleDragSelection(e)) {
      return;
    }
    setRangeSelection({ start: null, end: null, isSelecting: false });

    // 2. Get clicked bar data from Recharts state FIRST (same as YHistogramV2)
    // activeTooltipIndex is populated when clicking anywhere in a bar's column zone,
    // even if not clicking directly on the visible bar rect
    const activeIndex = state?.activeTooltipIndex;
    if (activeIndex === undefined || activeIndex < 0 || activeIndex >= partitionBarData.length) {
      // No valid bar column clicked - clear selection (true background click)
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
      setClickedPartitionId(null);
      return;
    }

    const entry = partitionBarData[activeIndex];
    if (!entry || !selectionCtx) return;

    // 3. Detect which segment was clicked using elementsFromPoint (for stacked bars)
    // Find the actual bar rect at the click position - need to find the topmost one at click coords
    const target = e?.target as SVGElement | null;
    let barRect: Element | null = null;
    if (e && target) {
      // Always use elementsFromPoint to find the rect at the exact click position
      const elements = document.elementsFromPoint(e.clientX, e.clientY);
      // Find the FIRST recharts-rectangle (topmost in visual stacking order at click point)
      barRect = elements.find(el =>
        el.classList.contains('recharts-rectangle') &&
        !el.classList.contains('recharts-reference-area-rect')
      ) || null;
    }

    const clickedFill = barRect?.getAttribute('fill') || '';

    // Find which segment has this color (default to first segment if clicking in column zone above bar)
    let clickedSegmentKey = partitionSegmentKeys[0];
    for (const segKey of partitionSegmentKeys) {
      const segColor = getPartitionSegmentColor(segKey, entry);
      if (segColor === clickedFill) {
        clickedSegmentKey = segKey;
        break;
      }
    }

    // Get samples for the clicked segment
    const barIndices = entry.indices;
    const segmentIndices = entry.segmentIndices[clickedSegmentKey] ?? barIndices;

    // 4. Apply 3-click selection logic
    const modifiers = e ? extractModifiers(e) : { shift: false, ctrl: false };
    const action = computeStackedBarAction(
      { barIndices, segmentIndices },
      selectionCtx.selectedSamples,
      modifiers
    );
    executeSelectionAction(selectionCtx, action);

    // Update clicked partition tracking for visual feedback
    if (action.action === 'clear') {
      setClickedPartitionId(null);
    } else if (!modifiers.shift && !modifiers.ctrl) {
      setClickedPartitionId(entry.partitionId);
    } else {
      setClickedPartitionId(null);
    }
  }, [handleDragSelection, partitionBarData, partitionSegmentKeys, getPartitionSegmentColor, selectionCtx]);

  // Empty state
  if (!folds || folds.n_folds === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <LayoutGrid className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>No splitter in pipeline</p>
          <p className="text-xs mt-1">Add a splitter to see fold distribution</p>
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
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Display Options</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={config.showLegend}
          onCheckedChange={(checked) => updateConfig({ showLegend: checked })}
        >
          Show Color Legend
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showYLegend}
          onCheckedChange={(checked) => updateConfig({ showYLegend: checked })}
          disabled={effectiveColorMode === 'partition' || !y || y.length === 0}
        >
          Show Y Value Legend
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showMeanLine}
          onCheckedChange={(checked) => updateConfig({ showMeanLine: checked })}
          disabled={!hasYStats || config.viewMode === 'counts'}
        >
          Show Global Mean (Y Dist.)
        </DropdownMenuCheckboxItem>

        {/* Only show internal color selector when no global config provided */}
        {!globalColorConfig && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">Color By</DropdownMenuLabel>

            <DropdownMenuRadioGroup
              value={config.colorMode}
              onValueChange={(v) => updateConfig({ colorMode: v as FoldColorMode })}
            >
              <DropdownMenuRadioItem value="partition">Partition (Train/Test)</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="target_mean" disabled={!y || y.length === 0}>
                Target Mean
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Render count bar chart with separate bars per partition
  const renderCountChart = () => (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={partitionBarData}
            margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
            layout={config.barOrientation === 'horizontal' ? 'vertical' : 'horizontal'}
            onMouseDown={(state) => {
              handleChartMouseDown(state as { activeTooltipIndex?: number });
            }}
            onMouseMove={(state) => {
              handleChartMouseMove(state as { activeTooltipIndex?: number });
            }}
            onMouseUp={(state) => {
              handleChartMouseUp(state as { activeTooltipIndex?: number });
            }}
          >
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
              horizontal={config.barOrientation !== 'horizontal'}
              vertical={config.barOrientation === 'horizontal'}
            />

            {config.barOrientation === 'horizontal' ? (
              <>
                <XAxis type="number" stroke={CHART_THEME.axisStroke} fontSize={CHART_THEME.axisFontSize} />
                <YAxis
                  dataKey="index"
                  type="number"
                  stroke={CHART_THEME.axisStroke}
                  fontSize={11}
                  width={70}
                  tickFormatter={(value: number) => partitionBarData[value]?.label ?? ''}
                  tick={{ fill: '#e4e4e7', fontWeight: 500 }}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="index"
                  type="number"
                  hide
                  domain={[-0.5, partitionBarData.length - 0.5]}
                />
                <YAxis stroke={CHART_THEME.axisStroke} fontSize={CHART_THEME.axisFontSize} width={40} />
              </>
            )}

        <Tooltip
          isAnimationActive={false}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload, label }) => {
            if (!payload || payload.length === 0) return null;
            const entry = partitionBarData.find(d => d.label === label);
            if (!entry) return null;

            // Calculate percentage of total samples
            const totalSamples = partitionBarData.reduce((sum, p) => sum + p.count, 0);
            const percentage = totalSamples > 0 ? (entry.count / totalSamples) * 100 : 0;

            // Get partition type label
            const partitionTypeLabel = entry.partitionType === 'train' ? 'Training'
              : entry.partitionType === 'val' ? 'Validation'
              : 'Test (Held-out)';

            // Get fold-level stats from folds data
            const foldData = entry.foldIndex !== null ? folds?.folds[entry.foldIndex] : null;
            const yStats = entry.partitionType === 'train'
              ? foldData?.y_train_stats
              : foldData?.y_test_stats;

            return (
              <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs min-w-[180px]">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: getPartitionBarColor(entry, true) }}
                  />
                  <span className="font-semibold text-foreground">{label}</span>
                </div>

                {/* Fold Properties */}
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium">{partitionTypeLabel}</span>
                  </div>
                  {entry.foldIndex !== null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fold:</span>
                      <span className="font-medium">{entry.foldIndex + 1} of {folds?.n_folds}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Samples:</span>
                    <span className="font-medium">{entry.count} ({percentage.toFixed(1)}%)</span>
                  </div>
                </div>

                {/* Y Statistics */}
                {(yStats || entry.yMean !== undefined) && (
                  <div className="mt-2 pt-1.5 border-t border-border space-y-1">
                    <div className="text-muted-foreground font-medium mb-1">Y Statistics</div>
                    {entry.yMean !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mean:</span>
                        <span>{formatYValue(entry.yMean)}</span>
                      </div>
                    )}
                    {entry.yStd !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Std:</span>
                        <span>{formatYValue(entry.yStd)}</span>
                      </div>
                    )}
                    {yStats?.min !== undefined && yStats?.max !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Range:</span>
                        <span>[{formatYValue(yStats.min)}, {formatYValue(yStats.max)}]</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Segment breakdown for non-partition color modes */}
                {effectiveColorMode !== 'partition' && partitionSegmentKeys.filter(k => (entry.segments[k] ?? 0) > 0).length > 0 && (
                  <div className="mt-2 pt-1.5 border-t border-border space-y-1">
                    <div className="text-muted-foreground font-medium mb-1">Distribution</div>
                    {partitionSegmentKeys.filter(k => (entry.segments[k] ?? 0) > 0).map((segKey) => {
                      const count = entry.segments[segKey] ?? 0;
                      const pct = entry.count > 0 ? (count / entry.count) * 100 : 0;
                      return (
                        <div key={segKey} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1">
                            <span
                              className="w-2 h-2 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: getPartitionSegmentColor(segKey, entry) }}
                            />
                            <span className="text-muted-foreground">{getSegmentLabel(segKey)}:</span>
                          </span>
                          <span>{count} ({pct.toFixed(0)}%)</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Hint for interaction */}
                <div className="mt-2 pt-1 text-[10px] text-muted-foreground/70 text-center">
                  Click to select samples
                </div>
              </div>
            );
          }}
        />

        {/* Render bars based on color mode */}
        {partitionSegmentKeys.map((segKey) => (
          <Bar
            key={segKey}
            dataKey={`segments.${segKey}`}
            name={`segments.${segKey}`}
            stackId="a"
            cursor="pointer"
            {...ANIMATION_CONFIG}
          >
            {partitionBarData.map((entry) => {
              // Check if this SEGMENT contains selected samples (for segment-level highlighting)
              const hasSelection = selectedSamples.size > 0;
              const segmentSamples = entry.segmentIndices[segKey] ?? [];
              const hasSelectedSamplesInSegment = hasSelection && segmentSamples.some(i => selectedSamples.has(i));

              // Check if this partition was the one clicked in THIS chart
              const isThisPartitionClicked = clickedPartitionId === entry.partitionId;
              // Selection came from another chart if there's a selection but no clicked partition in this chart
              const selectionFromOtherChart = hasSelection && clickedPartitionId === null;

              // In partition mode, color by partition type; otherwise by segment
              // Always use full color (isHighlighted = true) - no transparency
              const fillColor = effectiveColorMode === 'partition'
                ? getPartitionBarColor(entry, true)
                : getPartitionSegmentColor(segKey, entry);

              // Show stroke when THIS SEGMENT contains selected samples:
              // - This partition was clicked in THIS chart AND this segment has selected samples, OR
              // - Selection came from ANOTHER chart AND this segment contains selected samples
              const showStroke = hasSelectedSamplesInSegment &&
                (isThisPartitionClicked || selectionFromOtherChart);

              return (
                <Cell
                  key={`${segKey}-${entry.partitionId}`}
                  fill={fillColor}
                  stroke={showStroke ? 'hsl(var(--foreground))' : 'none'}
                  strokeWidth={showStroke ? 2.5 : 0}
                />
              );
            })}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
        {/* Drag selection visual overlay - positioned absolute over the chart */}
        {rangeSelection.isSelecting && rangeSelection.start !== null && rangeSelection.end !== null && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: `${(Math.min(rangeSelection.start, rangeSelection.end) / partitionBarData.length) * 100}%`,
              right: `${((partitionBarData.length - 1 - Math.max(rangeSelection.start, rangeSelection.end)) / partitionBarData.length) * 100}%`,
              top: 0,
              bottom: 0,
              backgroundColor: 'hsl(var(--primary) / 0.15)',
              border: '1px dashed hsl(var(--primary) / 0.5)',
            }}
          />
        )}
      </div>
      {/* HTML labels below chart for vertical orientation */}
      {config.barOrientation !== 'horizontal' && partitionBarData.length > 0 && (
        <div
          className="flex text-[10px] text-foreground mt-1"
          style={{ marginLeft: '10px', marginRight: '10px' }}
        >
          {partitionBarData.map((entry) => (
            <div key={entry.partitionId} style={{ flex: 1, textAlign: 'center' }}>
              {entry.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render distribution chart
  const renderDistributionChart = () => {
    if (!hasYStats) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
          No Y statistics available
        </div>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={yData} margin={CHART_MARGINS.boxplot}>
          <CartesianGrid
            strokeDasharray={CHART_THEME.gridDasharray}
            stroke={CHART_THEME.gridStroke}
            opacity={CHART_THEME.gridOpacity}
          />
          <XAxis
            dataKey="fold"
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
          />
          <YAxis
            stroke={CHART_THEME.axisStroke}
            fontSize={CHART_THEME.axisFontSize}
            width={45}
            label={{
              value: 'Y Value',
              angle: -90,
              position: 'insideLeft',
              fontSize: CHART_THEME.axisLabelFontSize,
            }}
          />

          {config.showMeanLine && globalYMean !== null && (
            <ReferenceLine
              y={globalYMean}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="5 5"
              strokeWidth={1.5}
              label={{
                value: `μ = ${formatYValue(globalYMean)}`,
                position: 'right',
                fontSize: 10,
              }}
            />
          )}

          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              backgroundColor: CHART_THEME.tooltipBg,
              border: `1px solid ${CHART_THEME.tooltipBorder}`,
              borderRadius: CHART_THEME.tooltipBorderRadius,
              fontSize: CHART_THEME.tooltipFontSize,
            }}
            content={({ payload, label }) => {
              if (!payload || payload.length === 0) return null;
              const entry = yData.find(d => d.fold === label);
              if (!entry) return null;

              return (
                <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                  <p className="font-medium mb-1">{label}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-medium" style={{ color: PARTITION_COLORS.train }}>Train</p>
                      <p>Mean: {formatYValue(entry.trainMean)}</p>
                      <p>Std: {formatYValue(entry.trainStd)}</p>
                      <p>Range: [{formatYValue(entry.trainMin)}, {formatYValue(entry.trainMax)}]</p>
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: PARTITION_COLORS.test }}>Test</p>
                      <p>Mean: {formatYValue(entry.testMean)}</p>
                      <p>Std: {formatYValue(entry.testStd)}</p>
                      <p>Range: [{formatYValue(entry.testMin)}, {formatYValue(entry.testMax)}]</p>
                    </div>
                  </div>
                </div>
              );
            }}
          />

          {config.showLegend && (
            <Legend
              verticalAlign="top"
              height={24}
              iconSize={10}
              formatter={(value) => (
                <span className="text-xs">{value.includes('train') ? 'Train' : 'Test'}</span>
              )}
            />
          )}

          <Bar
            dataKey="trainMean"
            fill={PARTITION_COLORS.train}
            barSize={12}
            {...ANIMATION_CONFIG}
          >
            {yData.map((entry) => (
              <Cell
                key={`train-${entry.foldIndex}`}
                fill={PARTITION_COLORS.train}
                opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              />
            ))}
            <ErrorBar
              dataKey="trainUpper"
              direction="y"
              stroke={PARTITION_COLORS.train}
              strokeWidth={1.5}
            />
          </Bar>

          <Bar
            dataKey="testMean"
            fill={PARTITION_COLORS.test}
            barSize={12}
            {...ANIMATION_CONFIG}
          >
            {yData.map((entry) => (
              <Cell
                key={`test-${entry.foldIndex}`}
                fill={PARTITION_COLORS.test}
                opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              />
            ))}
            <ErrorBar
              dataKey="testUpper"
              direction="y"
              stroke={PARTITION_COLORS.test}
              strokeWidth={1.5}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="h-full flex flex-col" ref={chartRef} onClick={handleChartBackgroundClick}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-primary" />
          {folds.splitter_name} ({folds.n_folds} folds)
        </h3>

        <div className="flex items-center gap-1.5">
          {/* View mode selector */}
          <Select
            value={config.viewMode}
            onValueChange={(v) => updateConfig({ viewMode: v as FoldViewMode })}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="counts">Sample Counts</SelectItem>
              {hasYStats && <SelectItem value="distribution">Y Distribution</SelectItem>}
              {hasYStats && <SelectItem value="both">Both</SelectItem>}
            </SelectContent>
          </Select>

          {/* Clear fold selection */}
          {selectedFold !== null && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                handleSelectFold(null);
              }}
            >
              Clear
            </Button>
          )}

          {/* Settings */}
          {renderSettingsDropdown()}

          {/* Export */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">Export data</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart content */}
      <div className="flex-1 min-h-0">
        {config.viewMode === 'counts' && renderCountChart()}
        {config.viewMode === 'distribution' && renderDistributionChart()}
        {config.viewMode === 'both' && hasYStats && (
          <div className="h-full grid grid-rows-2 gap-2">
            {renderCountChart()}
            {renderDistributionChart()}
          </div>
        )}
      </div>

      {/* Footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {/* Partition type legend (always shown for partition mode when showLegend is true) */}
            {config.showLegend && effectiveColorMode === 'partition' && partitionBarData.length > 0 && (
              <>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: trainColor }} />
                  Train
                </span>
                {partitionBarData.some(p => p.partitionType === 'val') && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: testColor }} />
                    Val
                  </span>
                )}
                {partitionBarData.some(p => p.partitionType === 'test') && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: heldOutTestColor }} />
                    Test
                  </span>
                )}
              </>
            )}
            {/* Dynamic legend for fold mode - show each fold with its color */}
            {config.showLegend && effectiveColorMode === 'fold' && partitionBarData.length > 0 && (
              <>
                {[...new Set(partitionBarData.map(p => p.foldIndex))].filter(f => f !== null).map((foldIdx) => (
                  <span key={`fold-${foldIdx}`} className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-sm"
                      style={{ backgroundColor: getCategoricalColor(foldIdx!, globalColorConfig?.categoricalPalette ?? 'default') }}
                    />
                    Fold {(foldIdx ?? 0) + 1}
                  </span>
                ))}
              </>
            )}
            {/* Dynamic legend for other color modes (when showLegend is true) */}
            {config.showLegend && effectiveColorMode !== 'partition' && effectiveColorMode !== 'fold' && partitionBarData.length > 0 && partitionSegmentKeys.map((segKey) => (
              <span key={segKey} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: getPartitionSegmentColor(segKey, partitionBarData[0]) }}
                />
                {getSegmentLabel(segKey)}
              </span>
            ))}
          </div>

          {selectedFold !== null && (
            <span>
              Fold {selectedFold + 1} selected
            </span>
          )}

          {selectedSamples.size > 0 && (
            <span className="text-primary font-medium">
              {selectedSamples.size} selected
            </span>
          )}
        </div>
      )}

      {/* Color mode legend for target mode (optional via showYLegend) */}
      {config.showYLegend && effectiveColorMode === 'target' && y && y.length > 0 && !compact && (
        isClassificationMode ? (
          // Phase 5: Classification mode - show class swatches
          <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px]">
            <span className="text-muted-foreground">Class:</span>
            {classLabels.map((label, idx) => (
              <div key={label} className="flex items-center gap-0.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ backgroundColor: getCategoricalColor(idx, globalColorConfig?.categoricalPalette ?? 'default') }}
                />
                <span className="truncate max-w-[50px]">{label}</span>
              </div>
            ))}
          </div>
        ) : (
          // Regression mode - gradient legend
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className="text-muted-foreground">Y Value:</span>
            <div className="flex items-center gap-0.5">
              <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: getContinuousColor(0, globalColorConfig?.continuousPalette ?? 'blue_red') }} />
              <span>Low</span>
            </div>
            <div className="w-12 h-2 rounded-sm bg-gradient-to-r from-blue-500 via-cyan-500 to-red-500" />
            <div className="flex items-center gap-0.5">
              <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: getContinuousColor(1, globalColorConfig?.continuousPalette ?? 'blue_red') }} />
              <span>High</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default React.memo(FoldDistributionChartV2);
