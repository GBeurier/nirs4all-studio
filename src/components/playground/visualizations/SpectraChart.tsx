/**
 * SpectraChart - Refactored spectra visualization for backend data
 *
 * Features:
 * - Uses backend-computed data from ExecuteResponse
 * - Mean ± std band visualization
 * - Wavelength zoom brush
 * - Original/Processed toggle
 * - Sample selection and highlighting
 * - Chart export (PNG/CSV)
 * - Performance optimized (no animations, data sampling)
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
  ReferenceArea,
  Tooltip,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Layers, Download, BarChart3 } from 'lucide-react';
import { exportChart } from '@/lib/chartExport';
import {
  CHART_THEME,
  STATISTICS_COLORS,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  getExtendedSampleColor,
  formatWavelength,
  type ExtendedColorConfig,
} from './chartConfig';
import type { DataSection, SpectrumStats, FoldsInfo } from '@/types/playground';

// ============= Types =============

interface SpectraChartProps {
  /** Original data section from backend */
  original: DataSection;
  /** Processed data section from backend */
  processed: DataSection;
  /** Optional Y values for coloring */
  y?: number[];
  /** Sample IDs for labels */
  sampleIds?: string[];
  /** Fold information for fold coloring */
  folds?: FoldsInfo;
  /** Color configuration */
  colorConfig?: ExtendedColorConfig;
  /** Currently selected sample */
  selectedSample?: number | null;
  /** Callback when sample is selected */
  onSelectSample?: (index: number) => void;
  /** Max samples to display (for performance) */
  maxSamples?: number;
  /** Whether chart is in loading state */
  isLoading?: boolean;
}

type ViewMode = 'both' | 'original' | 'processed';
type StatisticsMode = 'none' | 'mean' | 'std' | 'range';

// ============= Component =============

export function SpectraChart({
  original,
  processed,
  y,
  sampleIds,
  folds,
  colorConfig,
  selectedSample,
  onSelectSample,
  maxSamples = 50,
  isLoading = false,
}: SpectraChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('processed');
  const [statisticsMode, setStatisticsMode] = useState<StatisticsMode>('none');
  const [brushDomain, setBrushDomain] = useState<[number, number] | null>(null);

  // Get wavelengths (prefer processed, fallback to original)
  const wavelengths = processed.wavelengths.length > 0
    ? processed.wavelengths
    : original.wavelengths;

  // Determine which sample indices to show
  const displayIndices = useMemo(() => {
    const spectraCount = processed.spectra.length || original.spectra.length;
    if (spectraCount <= maxSamples) {
      return Array.from({ length: spectraCount }, (_, i) => i);
    }
    // Use sample_indices from backend if available, otherwise subsample
    if (processed.sample_indices && processed.sample_indices.length <= maxSamples) {
      return processed.sample_indices.slice(0, maxSamples);
    }
    // Uniform subsampling
    const step = Math.ceil(spectraCount / maxSamples);
    return Array.from({ length: Math.ceil(spectraCount / step) }, (_, i) => i * step)
      .filter(i => i < spectraCount);
  }, [processed, original, maxSamples]);

  // Build chart data
  const chartData = useMemo(() => {
    const showOriginal = viewMode === 'both' || viewMode === 'original';
    const showProcessed = viewMode === 'both' || viewMode === 'processed';

    return wavelengths.map((wavelength, wIdx) => {
      const point: Record<string, number> = { wavelength };

      // Add spectrum lines
      displayIndices.forEach((sIdx, displayIdx) => {
        if (showProcessed && processed.spectra[sIdx]) {
          point[`p${displayIdx}`] = processed.spectra[sIdx][wIdx];
        }
        if (showOriginal && original.spectra[sIdx]) {
          point[`o${displayIdx}`] = original.spectra[sIdx][wIdx];
        }
      });

      // Add statistics if requested
      const stats = viewMode === 'original' ? original.statistics : processed.statistics;
      if (stats && statisticsMode !== 'none') {
        point.mean = stats.mean[wIdx];
        if (statisticsMode === 'std' || statisticsMode === 'range') {
          point.stdUpper = stats.mean[wIdx] + stats.std[wIdx];
          point.stdLower = stats.mean[wIdx] - stats.std[wIdx];
        }
        if (statisticsMode === 'range') {
          point.p5 = stats.p5?.[wIdx] ?? stats.min[wIdx];
          point.p95 = stats.p95?.[wIdx] ?? stats.max[wIdx];
        }
      }

      return point;
    });
  }, [wavelengths, displayIndices, viewMode, statisticsMode, processed, original]);

  // Filter data by brush domain
  const filteredData = useMemo(() => {
    if (!brushDomain) return chartData;
    return chartData.filter(
      d => d.wavelength >= brushDomain[0] && d.wavelength <= brushDomain[1]
    );
  }, [chartData, brushDomain]);

  // Get color for a sample
  const getColor = useCallback((displayIdx: number, isOriginal: boolean) => {
    const sampleIdx = displayIndices[displayIdx];
    const yValues = y ?? [];
    const foldLabels = folds?.fold_labels;

    const baseColor = getExtendedSampleColor(
      sampleIdx,
      yValues,
      foldLabels,
      colorConfig,
      selectedSample,
      undefined
    );

    // Desaturate original spectra slightly when showing both
    if (isOriginal && viewMode === 'both' && selectedSample !== sampleIdx) {
      return baseColor.replace(/50%\)/, '60%)').replace(/70%/, '50%');
    }
    return baseColor;
  }, [displayIndices, y, folds, colorConfig, selectedSample, viewMode]);

  // Handle click on chart
  const handleClick = useCallback((e: unknown) => {
    const event = e as { activePayload?: Array<{ dataKey: string }> };
    if (event?.activePayload?.[0]?.dataKey && onSelectSample) {
      const key = event.activePayload[0].dataKey as string;
      const match = key.match(/[po](\d+)/);
      if (match) {
        const displayIdx = parseInt(match[1], 10);
        const sampleIdx = displayIndices[displayIdx];
        onSelectSample(sampleIdx);
      }
    }
  }, [onSelectSample, displayIndices]);

  // Handle brush change
  const handleBrushChange = useCallback((domain: { startIndex?: number; endIndex?: number }) => {
    if (domain.startIndex !== undefined && domain.endIndex !== undefined) {
      const startWl = chartData[domain.startIndex]?.wavelength;
      const endWl = chartData[domain.endIndex]?.wavelength;
      if (startWl !== undefined && endWl !== undefined) {
        setBrushDomain([startWl, endWl]);
      }
    }
  }, [chartData]);

  // Reset brush
  const handleResetBrush = useCallback(() => {
    setBrushDomain(null);
  }, []);

  // Export chart
  const handleExport = useCallback(() => {
    const exportData = wavelengths.map((wl, i) => {
      const row: Record<string, number | string> = { wavelength: wl };
      displayIndices.forEach((sIdx, displayIdx) => {
        const id = sampleIds?.[sIdx] ?? `sample_${sIdx}`;
        if (processed.spectra[sIdx]) {
          row[`${id}_processed`] = processed.spectra[sIdx][i];
        }
        if (original.spectra[sIdx]) {
          row[`${id}_original`] = original.spectra[sIdx][i];
        }
      });
      return row;
    });
    exportChart(chartRef.current, exportData, 'spectra');
  }, [wavelengths, displayIndices, sampleIds, processed, original]);

  const totalSamples = processed.spectra.length || original.spectra.length;
  const showOriginal = viewMode === 'both' || viewMode === 'original';
  const showProcessed = viewMode === 'both' || viewMode === 'processed';

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Spectra ({displayIndices.length}/{totalSamples})
        </h3>

        <div className="flex items-center gap-1.5">
          {/* View mode selector */}
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="processed">Processed</SelectItem>
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="both">Both</SelectItem>
            </SelectContent>
          </Select>

          {/* Statistics mode */}
          <Button
            variant={statisticsMode !== 'none' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 px-2"
            title="Show mean ± std"
            onClick={() => setStatisticsMode(statisticsMode !== 'none' ? 'none' : 'std')}
          >
            <BarChart3 className="w-3 h-3" />
          </Button>

          {/* Reset zoom */}
          {brushDomain && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleResetBrush}
            >
              Reset
            </Button>
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
          <ComposedChart
            data={chartData}
            margin={CHART_MARGINS.spectra}
            onClick={handleClick}
          >
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
            />
            <XAxis
              dataKey="wavelength"
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={formatWavelength}
            />
            <YAxis
              stroke={CHART_THEME.axisStroke}
              fontSize={CHART_THEME.axisFontSize}
              tickFormatter={(v) => v.toFixed(2)}
              width={45}
            />

            {/* Brush for zooming */}
            <Brush
              dataKey="wavelength"
              height={15}
              stroke="hsl(var(--primary))"
              fill="hsl(var(--muted))"
              onChange={handleBrushChange}
            />

            {/* Statistics bands */}
            {statisticsMode === 'range' && (
              <Area
                dataKey="p95"
                stroke="none"
                fill={STATISTICS_COLORS.p5p95}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                {...ANIMATION_CONFIG}
              />
            )}
            {statisticsMode === 'range' && (
              <Area
                dataKey="p5"
                stroke="none"
                fill="hsl(var(--background))"
                {...ANIMATION_CONFIG}
              />
            )}
            {(statisticsMode === 'std' || statisticsMode === 'range') && (
              <Area
                dataKey="stdUpper"
                stroke="none"
                fill={STATISTICS_COLORS.std}
                fillOpacity={CHART_THEME.statisticsBandOpacity}
                {...ANIMATION_CONFIG}
              />
            )}
            {(statisticsMode === 'std' || statisticsMode === 'range') && (
              <Area
                dataKey="stdLower"
                stroke="none"
                fill="hsl(var(--background))"
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Mean line */}
            {statisticsMode !== 'none' && (
              <Line
                type="monotone"
                dataKey="mean"
                stroke={STATISTICS_COLORS.mean}
                strokeWidth={2}
                dot={false}
                {...ANIMATION_CONFIG}
              />
            )}

            {/* Original spectra (dashed) */}
            {showOriginal && displayIndices.map((_, displayIdx) => (
              <Line
                key={`orig-${displayIdx}`}
                type="monotone"
                dataKey={`o${displayIdx}`}
                stroke={getColor(displayIdx, true)}
                strokeWidth={
                  selectedSample === displayIndices[displayIdx]
                    ? CHART_THEME.selectedLineStrokeWidth
                    : CHART_THEME.lineStrokeWidth
                }
                strokeDasharray={viewMode === 'both' ? '4 2' : undefined}
                dot={false}
                {...ANIMATION_CONFIG}
              />
            ))}

            {/* Processed spectra (solid) */}
            {showProcessed && displayIndices.map((_, displayIdx) => (
              <Line
                key={`proc-${displayIdx}`}
                type="monotone"
                dataKey={`p${displayIdx}`}
                stroke={getColor(displayIdx, false)}
                strokeWidth={
                  selectedSample === displayIndices[displayIdx]
                    ? CHART_THEME.selectedLineStrokeWidth
                    : CHART_THEME.lineStrokeWidth
                }
                dot={false}
                {...ANIMATION_CONFIG}
              />
            ))}

            <Tooltip
              contentStyle={{
                backgroundColor: CHART_THEME.tooltipBg,
                border: `1px solid ${CHART_THEME.tooltipBorder}`,
                borderRadius: CHART_THEME.tooltipBorderRadius,
                fontSize: CHART_THEME.tooltipFontSize,
              }}
              formatter={(value: number, name: string) => {
                if (name === 'mean') return [value.toFixed(4), 'Mean'];
                const match = name.match(/([po])(\d+)/);
                if (match) {
                  const displayIdx = parseInt(match[2], 10);
                  const sampleIdx = displayIndices[displayIdx];
                  const id = sampleIds?.[sampleIdx] ?? `Sample ${sampleIdx + 1}`;
                  const type = match[1] === 'o' ? 'Orig' : 'Proc';
                  return [value.toFixed(4), `${id} (${type})`];
                }
                return [value.toFixed(4), name];
              }}
              labelFormatter={(label) => `λ = ${label} nm`}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {showProcessed && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-primary" />
              Processed
            </span>
          )}
          {showOriginal && viewMode === 'both' && (
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 border-t border-dashed border-primary" />
              Original
            </span>
          )}
          {statisticsMode !== 'none' && (
            <span className="flex items-center gap-1">
              <span
                className="w-3 h-2 opacity-30"
                style={{ backgroundColor: STATISTICS_COLORS.std }}
              />
              ±1 Std
            </span>
          )}
        </div>
        {brushDomain && (
          <span>
            Zoom: {brushDomain[0].toFixed(0)} - {brushDomain[1].toFixed(0)} nm
          </span>
        )}
      </div>
    </div>
  );
}

export default SpectraChart;
