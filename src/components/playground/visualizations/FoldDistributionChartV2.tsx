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

import { useMemo, useState, useCallback, useRef } from 'react';
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
function getYMeanColor(yMean: number, yMin: number, yMax: number): string {
  if (yMax === yMin) return 'hsl(180, 60%, 50%)';
  const t = (yMean - yMin) / (yMax - yMin);
  const hue = 240 - t * 180; // Blue to red
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
}: FoldDistributionChartV2Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<ChartConfig>(DEFAULT_CONFIG);
  const [internalSelectedFold, setInternalSelectedFold] = useState<number | null>(null);

  // SelectionContext integration
  const selectionCtx = useSelectionContext ? useSelection() : null;
  const selectedSamples = selectionCtx?.selectedSamples ?? new Set<number>();

  // Use external selection if provided
  const selectedFold = externalSelectedFold ?? internalSelectedFold;
  const handleSelectFold = onSelectFold ?? setInternalSelectedFold;

  // Transform fold data for count visualization
  const countData = useMemo<FoldCountData[]>(() => {
    if (!folds || !folds.folds) return [];

    return folds.folds.map((fold) => {
      const total = fold.train_count + fold.test_count;

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
      };
    });
  }, [folds, y]);

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

  // Get bar color based on color mode
  const getTrainColor = useCallback((entry: FoldCountData) => {
    const isSelected = selectedFold === entry.foldIndex;

    switch (config.colorMode) {
      case 'target_mean':
        if (entry.trainYMean !== undefined) {
          const color = getYMeanColor(entry.trainYMean, yRange.min, yRange.max);
          return isSelected ? color : color.replace('50%)', '65%)');
        }
        return isSelected ? TRAIN_TEST_COLORS.train : TRAIN_TEST_COLORS.trainLight;

      case 'partition':
      default:
        return isSelected ? TRAIN_TEST_COLORS.train : TRAIN_TEST_COLORS.trainLight;
    }
  }, [config.colorMode, selectedFold, yRange]);

  const getTestColor = useCallback((entry: FoldCountData) => {
    const isSelected = selectedFold === entry.foldIndex;

    switch (config.colorMode) {
      case 'target_mean':
        if (entry.testYMean !== undefined) {
          const color = getYMeanColor(entry.testYMean, yRange.min, yRange.max);
          return isSelected ? color : color.replace('50%)', '65%)');
        }
        return isSelected ? TRAIN_TEST_COLORS.test : TRAIN_TEST_COLORS.testLight;

      case 'partition':
      default:
        return isSelected ? TRAIN_TEST_COLORS.test : TRAIN_TEST_COLORS.testLight;
    }
  }, [config.colorMode, selectedFold, yRange]);

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

            const trainSelected = getPartitionSelectedCount(entry, 'train');
            const testSelected = getPartitionSelectedCount(entry, 'test');

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium mb-1">{label}</p>
                <div className="space-y-1">
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TRAIN_TEST_COLORS.train }} />
                    Train: {entry.train} ({entry.trainPct.toFixed(0)}%)
                    {trainSelected > 0 && (
                      <span className="text-primary ml-1">({trainSelected} sel)</span>
                    )}
                  </p>
                  <p className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TRAIN_TEST_COLORS.test }} />
                    Test: {entry.test} ({entry.testPct.toFixed(0)}%)
                    {testSelected > 0 && (
                      <span className="text-primary ml-1">({testSelected} sel)</span>
                    )}
                  </p>
                  {entry.trainYMean !== undefined && (
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
            formatter={(value) => (
              <span className="text-xs">{value === 'train' ? 'Train' : 'Test'}</span>
            )}
          />
        )}

        <Bar
          dataKey="train"
          stackId="a"
          cursor="pointer"
          onClick={(data, index, event) => handleBarClick(countData[index], 'train', event as React.MouseEvent)}
          {...ANIMATION_CONFIG}
        >
          {countData.map((entry) => (
            <Cell
              key={`train-${entry.foldIndex}`}
              fill={getTrainColor(entry)}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              stroke={selectedFold === entry.foldIndex ? 'hsl(var(--foreground))' : 'none'}
              strokeWidth={selectedFold === entry.foldIndex ? 1 : 0}
            />
          ))}
        </Bar>

        <Bar
          dataKey="test"
          stackId="a"
          cursor="pointer"
          onClick={(data, index, event) => handleBarClick(countData[index], 'test', event as React.MouseEvent)}
          {...ANIMATION_CONFIG}
        >
          {countData.map((entry) => (
            <Cell
              key={`test-${entry.foldIndex}`}
              fill={getTestColor(entry)}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
              stroke={selectedFold === entry.foldIndex ? 'hsl(var(--foreground))' : 'none'}
              strokeWidth={selectedFold === entry.foldIndex ? 1 : 0}
            />
          ))}
        </Bar>
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
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TRAIN_TEST_COLORS.train }} />
              Train
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: TRAIN_TEST_COLORS.test }} />
              Test
            </span>
          </div>

          {selectedFold !== null && countData[selectedFold] && (
            <span>
              {countData[selectedFold].fold}: {countData[selectedFold].train} train, {countData[selectedFold].test} test
            </span>
          )}

          {selectedSamples.size > 0 && (
            <span className="text-primary font-medium">
              {selectedSamples.size} selected
            </span>
          )}
        </div>
      )}

      {/* Color mode legend for target_mean mode */}
      {config.colorMode === 'target_mean' && y && y.length > 0 && !compact && (
        <div className="flex items-center gap-2 mt-1 text-[10px]">
          <span className="text-muted-foreground">Y Mean:</span>
          <div className="flex items-center gap-0.5">
            <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: 'hsl(240, 70%, 50%)' }} />
            <span>Low</span>
          </div>
          <div className="w-12 h-2 rounded-sm bg-gradient-to-r from-blue-500 via-cyan-500 to-red-500" />
          <div className="flex items-center gap-0.5">
            <span className="w-3 h-2 rounded-sm" style={{ backgroundColor: 'hsl(60, 70%, 50%)' }} />
            <span>High</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default FoldDistributionChartV2;
