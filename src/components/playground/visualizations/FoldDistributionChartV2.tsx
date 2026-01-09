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

import React, { useMemo, useState, useCallback, useRef } from 'react';
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
  TRAIN_TEST_COLORS,
  getFoldColor,
  formatFoldLabel,
  formatYValue,
} from './chartConfig';
import {
  type GlobalColorConfig,
  type ColorContext,
  getContinuousColor,
  getCategoricalColor,
  PARTITION_COLORS,
  HIGHLIGHT_COLORS,
  normalizeValue,
  computeYBins,
  getYBinIndex,
} from '@/lib/playground/colorConfig';
import { isCategoricalTarget } from '@/lib/playground/targetTypeDetection';
import { useSelection } from '@/context/SelectionContext';
import type { FoldsInfo, FoldData, YStats } from '@/types/playground';
import { cn } from '@/lib/utils';

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
  barOrientation: 'horizontal' | 'vertical';
}

interface FoldCountData {
  fold: string;
  foldIndex: number;
  train: number;
  test: number;
  total: number;
  trainPct: number;
  testPct: number;
  trainIndices: number[];
  testIndices: number[];
  trainYMean?: number;
  testYMean?: number;
  // Stacked segment counts for different color modes
  segments?: Record<string, number>;
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

// ============= Default Configuration =============

const DEFAULT_CONFIG: ChartConfig = {
  viewMode: 'counts',
  colorMode: 'partition',
  showMeanLine: false,
  showLegend: true,
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

  // Compute Y bins for target mode (regression)
  const yBins = useMemo(() => {
    if (!y || y.length === 0 || isClassificationMode) return [];
    return computeYBins(y, 3); // Low, Medium, High
  }, [y, isClassificationMode]);

  // Get unique metadata values for metadata mode
  const metadataCategories = useMemo(() => {
    if (!globalColorConfig?.metadataKey || !colorContext?.metadata) return [];
    const values = colorContext.metadata[globalColorConfig.metadataKey];
    if (!values) return [];
    return [...new Set(values.filter(v => v !== null && v !== undefined))].slice(0, 10) as string[];
  }, [globalColorConfig?.metadataKey, colorContext?.metadata]);

  // Transform fold data for count visualization with stacked segments
  const countData = useMemo<FoldCountData[]>(() => {
    if (!folds || !folds.folds) return [];

    return folds.folds.map((fold) => {
      const allIndices = [...fold.train_indices, ...fold.test_indices];
      const total = allIndices.length;

      // Calculate Y means for coloring
      let trainYMean: number | undefined;
      let testYMean: number | undefined;

      if (y && y.length > 0) {
        const trainYValues = fold.train_indices
          .map(i => y[i])
          .filter(v => v !== undefined);
        const testYValues = fold.test_indices
          .map(i => y[i])
          .filter(v => v !== undefined);

        if (trainYValues.length > 0) {
          trainYMean = trainYValues.reduce((a, b) => a + b, 0) / trainYValues.length;
        }
        if (testYValues.length > 0) {
          testYMean = testYValues.reduce((a, b) => a + b, 0) / testYValues.length;
        }
      }

      // Compute stacked segments based on color mode
      const segments: Record<string, number> = {};

      switch (effectiveColorMode) {
        case 'partition':
          segments.train = fold.train_count;
          segments.test = fold.test_count;
          break;

        case 'target':
          // Phase 5: Classification mode - count by class
          if (isClassificationMode && classLabels.length > 0 && y) {
            classLabels.forEach((label, i) => {
              segments[`class_${i}`] = allIndices.filter(idx => {
                const yVal = y[idx];
                return yVal !== undefined && String(yVal) === label;
              }).length;
            });
          } else if (y && yBins.length > 0) {
            // Regression mode - count samples in each Y bin
            yBins.forEach((bin, i) => {
              segments[`bin_${i}`] = allIndices.filter(idx => {
                const yVal = y[idx];
                return yVal !== undefined && getYBinIndex(yVal, yBins) === i;
              }).length;
            });
          }
          break;

        case 'fold':
          // Just the total count (single color per fold)
          segments.total = total;
          break;

        case 'outlier':
          // Count outliers vs non-outliers
          if (colorContext?.outlierIndices) {
            segments.outlier = allIndices.filter(idx => colorContext.outlierIndices!.has(idx)).length;
            segments.normal = total - segments.outlier;
          } else {
            segments.normal = total;
          }
          break;

        case 'selection':
          // Count selected vs unselected
          segments.selected = allIndices.filter(idx => selectedSamples.has(idx)).length;
          segments.unselected = total - segments.selected;
          break;

        case 'metadata':
          // Count by metadata category
          if (globalColorConfig?.metadataKey && colorContext?.metadata) {
            const values = colorContext.metadata[globalColorConfig.metadataKey];
            if (values) {
              metadataCategories.forEach((cat, i) => {
                segments[`meta_${i}`] = allIndices.filter(idx => values[idx] === cat).length;
              });
              // Count uncategorized
              const categorized = Object.values(segments).reduce((a, b) => a + b, 0);
              if (categorized < total) {
                segments.other = total - categorized;
              }
            }
          }
          break;

        default:
          segments.train = fold.train_count;
          segments.test = fold.test_count;
      }

      return {
        fold: formatFoldLabel(fold.fold_index),
        foldIndex: fold.fold_index,
        train: fold.train_count,
        test: fold.test_count,
        total,
        trainPct: (fold.train_count / total) * 100,
        testPct: (fold.test_count / total) * 100,
        trainIndices: fold.train_indices,
        testIndices: fold.test_indices,
        trainYMean,
        testYMean,
        segments,
      };
    });
  }, [folds, y, effectiveColorMode, yBins, colorContext, selectedSamples, globalColorConfig?.metadataKey, metadataCategories, isClassificationMode, classLabels]);

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

  // Get train/test colors from unified config or fallback to legacy colors
  const trainColor = globalColorConfig ? PARTITION_COLORS.train : TRAIN_TEST_COLORS.train;
  const trainColorLight = globalColorConfig ? PARTITION_COLORS.trainLight : TRAIN_TEST_COLORS.trainLight;
  const testColor = globalColorConfig ? PARTITION_COLORS.test : TRAIN_TEST_COLORS.test;
  const testColorLight = globalColorConfig ? PARTITION_COLORS.testLight : TRAIN_TEST_COLORS.testLight;

  // Get segment keys for current color mode
  const segmentKeys = useMemo(() => {
    switch (effectiveColorMode) {
      case 'partition':
        return ['train', 'test'];
      case 'target':
        // Phase 5: Classification mode uses class keys
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
        return ['train', 'test'];
    }
  }, [effectiveColorMode, yBins, metadataCategories, isClassificationMode, classLabels]);

  // Get color for a segment based on color mode
  const getSegmentColor = useCallback((segmentKey: string, entry: FoldCountData): string => {
    const palette = globalColorConfig?.continuousPalette ?? 'blue_red';
    const catPalette = globalColorConfig?.categoricalPalette ?? 'default';
    const isSelected = selectedFold === entry.foldIndex;
    const opacity = isSelected ? '' : '99'; // Slightly transparent when not selected

    switch (effectiveColorMode) {
      case 'partition':
        if (segmentKey === 'train') {
          return isSelected ? trainColor : trainColorLight;
        }
        return isSelected ? testColor : testColorLight;

      case 'target': {
        // Phase 5: Classification mode - use categorical palette
        if (segmentKey.startsWith('class_')) {
          const classIdx = parseInt(segmentKey.replace('class_', ''), 10);
          return getCategoricalColor(classIdx, catPalette);
        }
        // Regression mode - color by Y bin using continuous palette
        const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
        const t = yBins.length > 1 ? binIdx / (yBins.length - 1) : 0.5;
        return getContinuousColor(t, palette);
      }

      case 'fold':
        // Each fold gets its categorical color
        return getCategoricalColor(entry.foldIndex, catPalette);

      case 'outlier':
        if (segmentKey === 'outlier') {
          return 'hsl(0, 70%, 55%)'; // Red for outliers
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
        return 'hsl(var(--primary))';
    }
  }, [effectiveColorMode, globalColorConfig, selectedFold, trainColor, trainColorLight, testColor, testColorLight, yBins]);

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
        // Regression mode - Y bin labels
        const binIdx = parseInt(segmentKey.replace('bin_', ''), 10);
        const labels = ['Low Y', 'Medium Y', 'High Y'];
        return labels[binIdx] ?? `Bin ${binIdx + 1}`;
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
  }, [effectiveColorMode, metadataCategories, classLabels]);

  // Legacy color functions for backward compatibility
  const getTrainColor = useCallback((entry: FoldCountData) => {
    return getSegmentColor('train', entry);
  }, [getSegmentColor]);

  const getTestColor = useCallback((entry: FoldCountData) => {
    return getSegmentColor('test', entry);
  }, [getSegmentColor]);

  // Handle bar click - select samples in partition via SelectionContext
  const handleBarClick = useCallback((entry: FoldCountData, partition: 'train' | 'test', event?: React.MouseEvent) => {
    const indices = partition === 'train' ? entry.trainIndices : entry.testIndices;

    if (selectionCtx) {
      if (event?.shiftKey) {
        selectionCtx.select(indices, 'add');
      } else if (event?.ctrlKey || event?.metaKey) {
        selectionCtx.toggle(indices);
      } else {
        selectionCtx.select(indices, 'replace');
      }
    }

    // Also update fold selection
    handleSelectFold(selectedFold === entry.foldIndex ? null : entry.foldIndex);
  }, [selectionCtx, handleSelectFold, selectedFold]);

  // Handle background click
  const handleChartBackgroundClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'svg' || target.classList.contains('recharts-surface')) {
      if (selectionCtx && selectionCtx.selectedSamples.size > 0) {
        selectionCtx.clear();
      }
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

  // Check if any samples in a partition are selected
  const getPartitionSelectedCount = useCallback((entry: FoldCountData, partition: 'train' | 'test') => {
    const indices = partition === 'train' ? entry.trainIndices : entry.testIndices;
    return indices.filter(i => selectedSamples.has(i)).length;
  }, [selectedSamples]);

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
          Show Legend
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={config.showMeanLine}
          onCheckedChange={(checked) => updateConfig({ showMeanLine: checked })}
          disabled={!hasYStats}
        >
          Show Global Mean
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

  // Render count bar chart
  const renderCountChart = () => (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={countData}
        margin={CHART_MARGINS.folds}
        layout={config.barOrientation === 'horizontal' ? 'vertical' : 'horizontal'}
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
              dataKey="fold"
              type="category"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              width={55}
            />
          </>
        ) : (
          <>
            <XAxis dataKey="fold" stroke={CHART_THEME.axisStroke} fontSize={CHART_THEME.axisFontSize} />
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
            const entry = countData.find(d => d.fold === label);
            if (!entry) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium mb-1">{label} ({entry.total} samples)</p>
                <div className="space-y-1">
                  {segmentKeys.filter(k => (entry.segments?.[k] ?? 0) > 0).map((segKey) => {
                    const count = entry.segments?.[segKey] ?? 0;
                    const pct = entry.total > 0 ? (count / entry.total) * 100 : 0;
                    return (
                      <p key={segKey} className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-sm"
                          style={{ backgroundColor: getSegmentColor(segKey, entry) }}
                        />
                        {getSegmentLabel(segKey)}: {count} ({pct.toFixed(0)}%)
                      </p>
                    );
                  })}
                  {entry.trainYMean !== undefined && effectiveColorMode === 'partition' && (
                    <p className="text-muted-foreground mt-1">
                      Y Mean: Train {formatYValue(entry.trainYMean)}, Test {formatYValue(entry.testYMean ?? 0)}
                    </p>
                  )}
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
            formatter={(value) => {
              // Extract segment key from dataKey like "segments.train" or just "train"
              const segKey = value.startsWith('segments.') ? value.replace('segments.', '') : value;
              return <span className="text-xs">{getSegmentLabel(segKey)}</span>;
            }}
          />
        )}

        {/* Dynamic stacked bars based on color mode */}
        {segmentKeys.map((segKey) => (
          <Bar
            key={segKey}
            dataKey={`segments.${segKey}`}
            name={`segments.${segKey}`}
            stackId="a"
            cursor="pointer"
            onClick={(data, index, event) => {
              // Use train/test click behavior for partition mode, otherwise general select
              if (effectiveColorMode === 'partition') {
                handleBarClick(countData[index], segKey as 'train' | 'test', event as React.MouseEvent);
              } else {
                // For other modes, select all samples in the fold
                const entry = countData[index];
                const indices = [...entry.trainIndices, ...entry.testIndices];
                if (selectionCtx) {
                  if (event && (event as React.MouseEvent).shiftKey) {
                    selectionCtx.select(indices, 'add');
                  } else {
                    selectionCtx.select(indices, 'replace');
                  }
                }
                handleSelectFold(selectedFold === entry.foldIndex ? null : entry.foldIndex);
              }
            }}
            {...ANIMATION_CONFIG}
          >
            {countData.map((entry) => (
              <Cell
                key={`${segKey}-${entry.foldIndex}`}
                fill={getSegmentColor(segKey, entry)}
                opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
                stroke={selectedFold === entry.foldIndex ? 'hsl(var(--foreground))' : 'none'}
                strokeWidth={selectedFold === entry.foldIndex ? 1 : 0}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
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
                      <p className="font-medium" style={{ color: TRAIN_TEST_COLORS.train }}>Train</p>
                      <p>Mean: {formatYValue(entry.trainMean)}</p>
                      <p>Std: {formatYValue(entry.trainStd)}</p>
                      <p>Range: [{formatYValue(entry.trainMin)}, {formatYValue(entry.trainMax)}]</p>
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: TRAIN_TEST_COLORS.test }}>Test</p>
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
            fill={TRAIN_TEST_COLORS.train}
            barSize={12}
            {...ANIMATION_CONFIG}
          >
            {yData.map((entry) => (
              <Cell
                key={`train-${entry.foldIndex}`}
                fill={TRAIN_TEST_COLORS.train}
                opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              />
            ))}
            <ErrorBar
              dataKey="trainUpper"
              direction="y"
              stroke={TRAIN_TEST_COLORS.train}
              strokeWidth={1.5}
            />
          </Bar>

          <Bar
            dataKey="testMean"
            fill={TRAIN_TEST_COLORS.test}
            barSize={12}
            {...ANIMATION_CONFIG}
          >
            {yData.map((entry) => (
              <Cell
                key={`test-${entry.foldIndex}`}
                fill={TRAIN_TEST_COLORS.test}
                opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              />
            ))}
            <ErrorBar
              dataKey="testUpper"
              direction="y"
              stroke={TRAIN_TEST_COLORS.test}
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
          <div className="flex items-center gap-4">
            {/* Dynamic legend based on color mode */}
            {countData.length > 0 && segmentKeys.slice(0, 6).map((segKey) => (
              <span key={segKey} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: getSegmentColor(segKey, countData[0]) }}
                />
                {getSegmentLabel(segKey)}
              </span>
            ))}
          </div>

          {selectedFold !== null && countData[selectedFold] && (
            <span>
              {countData[selectedFold].fold}: {countData[selectedFold].total} samples
            </span>
          )}

          {selectedSamples.size > 0 && (
            <span className="text-primary font-medium">
              {selectedSamples.size} selected
            </span>
          )}
        </div>
      )}

      {/* Color mode legend for target mode */}
      {effectiveColorMode === 'target' && y && y.length > 0 && !compact && (
        isClassificationMode ? (
          // Phase 5: Classification mode - show class swatches
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className="text-muted-foreground">Class:</span>
            {classLabels.slice(0, 6).map((label, idx) => (
              <div key={label} className="flex items-center gap-0.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ backgroundColor: getCategoricalColor(idx, globalColorConfig?.categoricalPalette ?? 'default') }}
                />
                <span className="truncate max-w-[50px]">{label}</span>
              </div>
            ))}
            {classLabels.length > 6 && (
              <span className="text-muted-foreground">+{classLabels.length - 6} more</span>
            )}
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
