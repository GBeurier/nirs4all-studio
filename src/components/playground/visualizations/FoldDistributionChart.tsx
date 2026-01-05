/**
 * FoldDistributionChart - Comprehensive fold visualization for splitter analysis
 *
 * Features:
 * - FoldCountBar: Train/test sample counts per fold
 * - FoldYBoxplot: Target distribution per fold
 * - FoldSelector: UI to highlight specific fold
 * - Integrates with ExecuteResponse.folds data
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
} from 'recharts';
import { LayoutGrid, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportChart, exportDataAsCSV } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  TRAIN_TEST_COLORS,
  FOLD_COLORS,
  getFoldColor,
  formatFoldLabel,
  formatYValue,
} from './chartConfig';
import type { FoldsInfo, FoldData, YStats } from '@/types/playground';

// ============= Types =============

interface FoldDistributionChartProps {
  /** Fold information from backend */
  folds: FoldsInfo | null;
  /** Currently selected fold (null = all folds) */
  selectedFold?: number | null;
  /** Callback when fold is selected */
  onSelectFold?: (foldIndex: number | null) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
}

type ViewMode = 'counts' | 'distribution' | 'both';

interface FoldCountData {
  fold: string;
  foldIndex: number;
  train: number;
  test: number;
  total: number;
  trainPct: number;
  testPct: number;
}

interface FoldYData {
  fold: string;
  foldIndex: number;
  // Train statistics
  trainMean: number;
  trainStd: number;
  trainMin: number;
  trainMax: number;
  // Test statistics
  testMean: number;
  testStd: number;
  testMin: number;
  testMax: number;
  // For error bars (IQR simulation from mean±std)
  trainLower: number;
  trainUpper: number;
  testLower: number;
  testUpper: number;
}

// ============= Sub-Components =============

interface FoldCountBarProps {
  data: FoldCountData[];
  selectedFold: number | null;
  onSelectFold?: (foldIndex: number | null) => void;
}

function FoldCountBar({ data, selectedFold, onSelectFold }: FoldCountBarProps) {
  const handleClick = (entry: FoldCountData) => {
    if (onSelectFold) {
      // Toggle selection
      onSelectFold(selectedFold === entry.foldIndex ? null : entry.foldIndex);
    }
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={CHART_MARGINS.folds} layout="vertical">
        <CartesianGrid
          strokeDasharray={CHART_THEME.gridDasharray}
          stroke={CHART_THEME.gridStroke}
          opacity={CHART_THEME.gridOpacity}
          horizontal={true}
          vertical={false}
        />
        <XAxis
          type="number"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
        />
        <YAxis
          dataKey="fold"
          type="category"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={55}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          formatter={(value: number, name: string) => {
            const label = name === 'train' ? 'Train' : 'Test';
            return [value, label];
          }}
        />
        <Legend
          verticalAlign="top"
          height={24}
          iconSize={10}
          formatter={(value) => <span className="text-xs">{value === 'train' ? 'Train' : 'Test'}</span>}
        />

        <Bar
          dataKey="train"
          stackId="a"
          fill={TRAIN_TEST_COLORS.train}
          cursor="pointer"
          onClick={(_, index) => handleClick(data[index])}
          {...ANIMATION_CONFIG}
        >
          {data.map((entry) => (
            <Cell
              key={`train-${entry.foldIndex}`}
              fill={selectedFold === entry.foldIndex ? TRAIN_TEST_COLORS.train : TRAIN_TEST_COLORS.trainLight}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
            />
          ))}
        </Bar>
        <Bar
          dataKey="test"
          stackId="a"
          fill={TRAIN_TEST_COLORS.test}
          cursor="pointer"
          onClick={(_, index) => handleClick(data[index])}
          {...ANIMATION_CONFIG}
        >
          {data.map((entry) => (
            <Cell
              key={`test-${entry.foldIndex}`}
              fill={selectedFold === entry.foldIndex ? TRAIN_TEST_COLORS.test : TRAIN_TEST_COLORS.testLight}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

interface FoldYBoxplotProps {
  data: FoldYData[];
  selectedFold: number | null;
  onSelectFold?: (foldIndex: number | null) => void;
}

function FoldYBoxplot({ data, selectedFold, onSelectFold }: FoldYBoxplotProps) {
  const handleClick = (entry: FoldYData) => {
    if (onSelectFold) {
      onSelectFold(selectedFold === entry.foldIndex ? null : entry.foldIndex);
    }
  };

  // Transform data for side-by-side bars
  const chartData = data.flatMap(d => [
    {
      fold: d.fold,
      foldIndex: d.foldIndex,
      type: 'train',
      mean: d.trainMean,
      lower: d.trainLower,
      upper: d.trainUpper,
      min: d.trainMin,
      max: d.trainMax,
    },
    {
      fold: d.fold,
      foldIndex: d.foldIndex,
      type: 'test',
      mean: d.testMean,
      lower: d.testLower,
      upper: d.testUpper,
      min: d.testMin,
      max: d.testMax,
    },
  ]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={CHART_MARGINS.boxplot}>
        <CartesianGrid
          strokeDasharray={CHART_THEME.gridDasharray}
          stroke={CHART_THEME.gridStroke}
          opacity={CHART_THEME.gridOpacity}
        />
        <XAxis
          dataKey="fold"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          angle={-45}
          textAnchor="end"
          height={50}
        />
        <YAxis
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={40}
          label={{
            value: 'Y Value',
            angle: -90,
            position: 'insideLeft',
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload, label }) => {
            if (!payload || payload.length === 0) return null;
            const entry = data.find(d => d.fold === label);
            if (!entry) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium mb-1">{label}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-muted-foreground font-medium" style={{ color: TRAIN_TEST_COLORS.train }}>Train</p>
                    <p>Mean: {formatYValue(entry.trainMean)}</p>
                    <p>±Std: {formatYValue(entry.trainStd)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium" style={{ color: TRAIN_TEST_COLORS.test }}>Test</p>
                    <p>Mean: {formatYValue(entry.testMean)}</p>
                    <p>±Std: {formatYValue(entry.testStd)}</p>
                  </div>
                </div>
              </div>
            );
          }}
        />

        {/* Train bars with error bars */}
        <Bar
          dataKey="trainMean"
          fill={TRAIN_TEST_COLORS.train}
          barSize={15}
          cursor="pointer"
          onClick={(_, index) => handleClick(data[index])}
          {...ANIMATION_CONFIG}
        >
          {data.map((entry) => (
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

        {/* Test bars with error bars */}
        <Bar
          dataKey="testMean"
          fill={TRAIN_TEST_COLORS.test}
          barSize={15}
          cursor="pointer"
          onClick={(_, index) => handleClick(data[index])}
          {...ANIMATION_CONFIG}
        >
          {data.map((entry) => (
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
}

// ============= Main Component =============

export function FoldDistributionChart({
  folds,
  selectedFold: externalSelectedFold,
  onSelectFold,
  isLoading = false,
}: FoldDistributionChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('counts');
  const [internalSelectedFold, setInternalSelectedFold] = useState<number | null>(null);

  // Use external selection if provided
  const selectedFold = externalSelectedFold ?? internalSelectedFold;
  const handleSelectFold = onSelectFold ?? setInternalSelectedFold;

  // Transform fold data for count visualization
  const countData = useMemo<FoldCountData[]>(() => {
    if (!folds || !folds.folds) return [];

    return folds.folds.map((fold, i) => {
      const total = fold.train_count + fold.test_count;
      return {
        fold: formatFoldLabel(fold.fold_index),
        foldIndex: fold.fold_index,
        train: fold.train_count,
        test: fold.test_count,
        total,
        trainPct: (fold.train_count / total) * 100,
        testPct: (fold.test_count / total) * 100,
      };
    });
  }, [folds]);

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

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <LayoutGrid className="w-4 h-4 text-primary" />
          {folds.splitter_name} ({folds.n_folds} folds)
        </h3>

        <div className="flex items-center gap-1.5">
          {/* View mode selector */}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
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
              onClick={() => handleSelectFold(null)}
            >
              Clear
            </Button>
          )}

          {/* Export */}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Chart content */}
      <div className="flex-1 min-h-0">
        {viewMode === 'counts' && (
          <FoldCountBar
            data={countData}
            selectedFold={selectedFold}
            onSelectFold={handleSelectFold}
          />
        )}
        {viewMode === 'distribution' && hasYStats && (
          <FoldYBoxplot
            data={yData}
            selectedFold={selectedFold}
            onSelectFold={handleSelectFold}
          />
        )}
        {viewMode === 'both' && hasYStats && (
          <div className="h-full grid grid-rows-2 gap-2">
            <FoldCountBar
              data={countData}
              selectedFold={selectedFold}
              onSelectFold={handleSelectFold}
            />
            <FoldYBoxplot
              data={yData}
              selectedFold={selectedFold}
              onSelectFold={handleSelectFold}
            />
          </div>
        )}
      </div>

      {/* Footer: Summary stats */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: TRAIN_TEST_COLORS.train }}
            />
            Train
          </span>
          <span className="flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: TRAIN_TEST_COLORS.test }}
            />
            Test
          </span>
        </div>

        {selectedFold !== null && countData[selectedFold] && (
          <span>
            {countData[selectedFold].fold}: {countData[selectedFold].train} train, {countData[selectedFold].test} test
            ({countData[selectedFold].trainPct.toFixed(0)}% / {countData[selectedFold].testPct.toFixed(0)}%)
          </span>
        )}
      </div>
    </div>
  );
}

export default FoldDistributionChart;
