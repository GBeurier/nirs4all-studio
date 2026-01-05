/**
 * PCAPlotNew - Refactored PCA visualization for backend-computed data
 *
 * Features:
 * - Uses backend-computed PCA from ExecuteResponse.pca
 * - Fold coloring option when folds are available
 * - Variance explained display
 * - Sample selection and highlighting
 * - Chart export (PNG/CSV)
 * - Color by Y value, fold, or metadata
 */

import { useMemo, useRef, useCallback, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ZAxis,
  Cell,
  Tooltip,
  Legend,
} from 'recharts';
import { Orbit, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  getFoldColor,
  getExtendedSampleColor,
  formatPercentage,
  formatFoldLabel,
  type ExtendedColorConfig,
  type ExtendedColorMode,
} from './chartConfig';
import type { PCAResult, FoldsInfo } from '@/types/playground';

// ============= Types =============

interface PCAPlotNewProps {
  /** PCA result from backend */
  pca: PCAResult | null;
  /** Y values for coloring */
  y?: number[];
  /** Fold information for fold coloring */
  folds?: FoldsInfo;
  /** Sample IDs for labels */
  sampleIds?: string[];
  /** Color configuration */
  colorConfig?: ExtendedColorConfig;
  /** Currently selected sample */
  selectedSample?: number | null;
  /** Callback when sample is selected */
  onSelectSample?: (index: number) => void;
  /** Whether chart is in loading state */
  isLoading?: boolean;
}

interface PCADataPoint {
  pc1: number;
  pc2: number;
  pc3?: number;
  index: number;
  name: string;
  y?: number;
  foldLabel?: number;
}

type PCAxis = 'pc1' | 'pc2' | 'pc3';

// ============= Component =============

export function PCAPlotNew({
  pca,
  y,
  folds,
  sampleIds,
  colorConfig: externalColorConfig,
  selectedSample,
  onSelectSample,
  isLoading = false,
}: PCAPlotNewProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // Local color mode state
  const [localColorMode, setLocalColorMode] = useState<ExtendedColorMode>(
    externalColorConfig?.mode ?? 'target'
  );
  const colorConfig: ExtendedColorConfig = {
    mode: localColorMode,
    ...externalColorConfig,
  };

  // Axis selection state
  const [xAxis, setXAxis] = useState<PCAxis>('pc1');
  const [yAxisSelected, setYAxisSelected] = useState<PCAxis>('pc2');

  // Build chart data from backend PCA result
  const chartData = useMemo<PCADataPoint[]>(() => {
    if (!pca || !pca.coordinates || pca.coordinates.length === 0) {
      return [];
    }

    return pca.coordinates.map((coords, i) => ({
      pc1: coords[0] ?? 0,
      pc2: coords[1] ?? 0,
      pc3: coords[2],
      index: i,
      name: sampleIds?.[i] ?? `Sample ${i + 1}`,
      y: y?.[i] ?? pca.y?.[i],
      foldLabel: folds?.fold_labels?.[i] ?? pca.fold_labels?.[i],
    }));
  }, [pca, y, folds, sampleIds]);

  // Variance explained for each PC
  const varianceExplained = useMemo(() => {
    if (!pca || !pca.explained_variance_ratio) {
      return { pc1: 0, pc2: 0, pc3: 0 };
    }
    return {
      pc1: (pca.explained_variance_ratio[0] ?? 0) * 100,
      pc2: (pca.explained_variance_ratio[1] ?? 0) * 100,
      pc3: (pca.explained_variance_ratio[2] ?? 0) * 100,
    };
  }, [pca]);

  // Get unique fold labels for legend
  const uniqueFolds = useMemo(() => {
    if (!folds || !folds.fold_labels) return [];
    return [...new Set(folds.fold_labels.filter(f => f >= 0))].sort((a, b) => a - b);
  }, [folds]);

  // Get color for a point
  const getPointColor = useCallback((point: PCADataPoint) => {
    if (selectedSample === point.index) {
      return 'hsl(var(--primary))';
    }

    const yValues = chartData.map(d => d.y ?? 0);

    // Handle fold coloring mode
    if (localColorMode === 'fold' && point.foldLabel !== undefined && point.foldLabel >= 0) {
      return getFoldColor(point.foldLabel);
    }

    return getExtendedSampleColor(
      point.index,
      yValues,
      chartData.map(d => d.foldLabel).filter((f): f is number => f !== undefined),
      colorConfig,
      selectedSample
    );
  }, [chartData, localColorMode, colorConfig, selectedSample]);

  // Handle click on point
  const handleClick = useCallback((data: unknown) => {
    const point = data as { index?: number; payload?: PCADataPoint };
    const idx = point?.payload?.index ?? point?.index;
    if (idx !== undefined && onSelectSample) {
      onSelectSample(idx);
    }
  }, [onSelectSample]);

  // Export chart
  const handleExport = useCallback(() => {
    const exportData = chartData.map(d => {
      const row: Record<string, string | number> = {
        sample: d.name,
        pc1: d.pc1,
        pc2: d.pc2,
      };
      if (d.pc3 !== undefined) row.pc3 = d.pc3;
      if (d.y !== undefined) row.y = d.y;
      if (d.foldLabel !== undefined && d.foldLabel >= 0) {
        row.fold = formatFoldLabel(d.foldLabel);
      }
      return row;
    });
    exportChart(chartRef.current, exportData, 'pca_scores');
  }, [chartData]);

  // Get axis value based on selection
  const getAxisValue = (point: PCADataPoint, axis: PCAxis): number => {
    if (axis === 'pc1') return point.pc1;
    if (axis === 'pc2') return point.pc2;
    return point.pc3 ?? 0;
  };

  // Error state
  if (pca?.error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Orbit className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>PCA Error</p>
          <p className="text-xs mt-1">{pca.error}</p>
        </div>
      </div>
    );
  }

  // Empty state
  if (!pca || chartData.length < 3) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Orbit className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>Need at least 3 samples for PCA</p>
        </div>
      </div>
    );
  }

  const hasPC3 = pca.n_components >= 3 && chartData.some(d => d.pc3 !== undefined);

  // Transform data for selected axes
  const transformedData = chartData.map(d => ({
    ...d,
    x: getAxisValue(d, xAxis),
    y: getAxisValue(d, yAxisSelected),
  }));

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Orbit className="w-4 h-4 text-primary" />
          PCA Scores
        </h3>

        <div className="flex items-center gap-1.5">
          {/* Color mode selector */}
          <Select value={localColorMode} onValueChange={(v) => setLocalColorMode(v as ExtendedColorMode)}>
            <SelectTrigger className="h-7 w-20 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="target">By Y</SelectItem>
              {folds && folds.n_folds > 0 && (
                <SelectItem value="fold">By Fold</SelectItem>
              )}
              <SelectItem value="dataset">By Dataset</SelectItem>
            </SelectContent>
          </Select>

          {/* Axis selectors (only if PC3 available) */}
          {hasPC3 && (
            <>
              <Select value={xAxis} onValueChange={(v) => setXAxis(v as PCAxis)}>
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pc1">PC1</SelectItem>
                  <SelectItem value="pc2">PC2</SelectItem>
                  <SelectItem value="pc3">PC3</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">vs</span>
              <Select value={yAxisSelected} onValueChange={(v) => setYAxisSelected(v as PCAxis)}>
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pc1">PC1</SelectItem>
                  <SelectItem value="pc2">PC2</SelectItem>
                  <SelectItem value="pc3">PC3</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}

          {/* Export */}
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={CHART_MARGINS.pca}>
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />
            <XAxis
              dataKey="x"
              type="number"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              name={xAxis.toUpperCase()}
              label={{
                value: `${xAxis.toUpperCase()} (${formatPercentage(varianceExplained[xAxis])})`,
                position: 'bottom',
                offset: -5,
                fontSize: CHART_THEME.axisLabelFontSize,
              }}
            />
            <YAxis
              dataKey="y"
              type="number"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              width={40}
              name={yAxisSelected.toUpperCase()}
              label={{
                value: `${yAxisSelected.toUpperCase()} (${formatPercentage(varianceExplained[yAxisSelected])})`,
                angle: -90,
                position: 'insideLeft',
                fontSize: CHART_THEME.axisLabelFontSize,
              }}
            />
            <ZAxis range={[40, 60]} />

            <Tooltip
              contentStyle={{
                backgroundColor: CHART_THEME.tooltipBg,
                border: `1px solid ${CHART_THEME.tooltipBorder}`,
                borderRadius: CHART_THEME.tooltipBorderRadius,
                fontSize: CHART_THEME.tooltipFontSize,
              }}
              formatter={(value: number, name: string) => [value.toFixed(3), name]}
              content={({ payload }) => {
                if (!payload || payload.length === 0) return null;
                const data = payload[0]?.payload as PCADataPoint | undefined;
                if (!data) return null;

                return (
                  <div
                    className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs"
                  >
                    <p className="font-medium">{data.name}</p>
                    <p className="text-muted-foreground">
                      {xAxis.toUpperCase()}: {getAxisValue(data, xAxis).toFixed(3)}
                    </p>
                    <p className="text-muted-foreground">
                      {yAxisSelected.toUpperCase()}: {getAxisValue(data, yAxisSelected).toFixed(3)}
                    </p>
                    {data.y !== undefined && (
                      <p className="text-muted-foreground">Y: {data.y.toFixed(2)}</p>
                    )}
                    {data.foldLabel !== undefined && data.foldLabel >= 0 && (
                      <p className="text-muted-foreground">{formatFoldLabel(data.foldLabel)}</p>
                    )}
                  </div>
                );
              }}
            />

            <Scatter
              data={transformedData}
              onClick={handleClick}
              cursor="pointer"
              {...ANIMATION_CONFIG}
            >
              {transformedData.map((entry) => (
                <Cell
                  key={`cell-${entry.index}`}
                  fill={getPointColor(entry)}
                  stroke={selectedSample === entry.index ? CHART_THEME.selectedStroke : 'none'}
                  strokeWidth={selectedSample === entry.index ? CHART_THEME.selectedStrokeWidth : 0}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Footer: Variance explained & Legend */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>
            Variance: PC1={formatPercentage(varianceExplained.pc1)},
            PC2={formatPercentage(varianceExplained.pc2)}
            {hasPC3 && `, PC3=${formatPercentage(varianceExplained.pc3)}`}
          </span>
        </div>

        {/* Fold legend when coloring by fold */}
        {localColorMode === 'fold' && uniqueFolds.length > 0 && (
          <div className="flex items-center gap-2">
            {uniqueFolds.slice(0, 5).map(foldIdx => (
              <span key={foldIdx} className="flex items-center gap-1">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: getFoldColor(foldIdx) }}
                />
                <span>{formatFoldLabel(foldIdx)}</span>
              </span>
            ))}
            {uniqueFolds.length > 5 && (
              <span>+{uniqueFolds.length - 5} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default PCAPlotNew;
