import { useMemo, useEffect, useState } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { getSpectralDetail } from '@/api/shap';
import type { ShapResultsResponse, BinnedImportanceData } from '@/types/shap';

interface SpectralImportanceChartProps {
  jobId: string;
  results: ShapResultsResponse;
  binnedData?: BinnedImportanceData;
  selectedSamples?: number[];
}

export function SpectralImportanceChart({
  jobId,
  results,
  binnedData,
  selectedSamples,
}: SpectralImportanceChartProps) {
  // Filtered SHAP data when samples are selected
  const [filteredShap, setFilteredShap] = useState<number[] | null>(null);
  const [filteredSpectrum, setFilteredSpectrum] = useState<number[] | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Fetch sample-filtered spectral detail when selection changes
  useEffect(() => {
    if (!selectedSamples || selectedSamples.length === 0) {
      setFilteredShap(null);
      setFilteredSpectrum(null);
      return;
    }

    setLoadingDetail(true);
    getSpectralDetail(jobId, selectedSamples)
      .then((detail) => {
        setFilteredShap(detail.mean_abs_shap);
        setFilteredSpectrum(detail.mean_spectrum);
        setLoadingDetail(false);
      })
      .catch(() => {
        setFilteredShap(null);
        setFilteredSpectrum(null);
        setLoadingDetail(false);
      });
  }, [jobId, selectedSamples]);

  // Use active binned data (from rebin or results)
  const activeBinned = binnedData || results.binned_importance;

  // Choose active SHAP and spectrum data
  const activeShap = filteredShap || results.mean_abs_shap;
  const activeSpectrum = filteredSpectrum || results.mean_spectrum;

  // Prepare data for the chart: importance line + mean spectrum as secondary
  const chartData = useMemo(() => {
    const { wavelengths } = results;
    return wavelengths.map((wavelength, idx) => ({
      wavelength,
      importance: activeShap[idx] ?? 0,
      absorbance: activeSpectrum[idx] ?? 0,
    }));
  }, [results, activeShap, activeSpectrum]);

  // Prepare binned regions for highlighting
  const binnedRegions = useMemo(() => {
    const maxImportance = Math.max(...activeBinned.bin_values, 1e-9);
    return activeBinned.bin_ranges.map((range, idx) => ({
      start: range[0],
      end: range[1],
      importance: activeBinned.bin_values[idx],
      normalized: activeBinned.bin_values[idx] / maxImportance,
    }));
  }, [activeBinned]);

  // Get color for importance level
  const getImportanceColor = (normalized: number): string => {
    if (normalized > 0.8) return 'rgba(13, 148, 136, 0.7)';
    if (normalized > 0.6) return 'rgba(20, 184, 166, 0.5)';
    if (normalized > 0.4) return 'rgba(45, 212, 191, 0.35)';
    if (normalized > 0.2) return 'rgba(94, 234, 212, 0.25)';
    return 'rgba(153, 246, 228, 0.15)';
  };

  const significantRegions = binnedRegions.filter((r) => r.normalized > 0.2);

  // Binned bar chart data
  const binnedBarData = useMemo(() => {
    return activeBinned.bin_centers.map((center, idx) => ({
      center,
      importance: activeBinned.bin_values[idx],
      label: `${activeBinned.bin_ranges[idx][0].toFixed(0)}-${activeBinned.bin_ranges[idx][1].toFixed(0)}`,
    }));
  }, [activeBinned]);

  const hasSpectrum = activeSpectrum.some((v) => v !== 0);

  return (
    <div className="h-full flex flex-col gap-4">
      {loadingDetail && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading sample detail...
        </div>
      )}

      {selectedSamples && selectedSamples.length > 0 && !loadingDetail && (
        <div className="text-xs text-muted-foreground">
          Showing SHAP for {selectedSamples.length} selected sample{selectedSamples.length > 1 ? 's' : ''}
        </div>
      )}

      {/* Top chart: Importance line + mean spectrum + highlighted regions */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: hasSpectrum ? 60 : 30, left: 10, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="wavelength"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => value.toFixed(0)}
              label={{
                value: 'Wavelength (cm\u207B\u00B9)',
                position: 'bottom',
                offset: 15,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
            />
            <YAxis
              yAxisId="importance"
              label={{
                value: 'Importance',
                angle: -90,
                position: 'insideLeft',
                offset: 10,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
              tickFormatter={(value) => value.toFixed(3)}
            />
            {hasSpectrum && (
              <YAxis
                yAxisId="absorbance"
                orientation="right"
                label={{
                  value: 'Absorbance',
                  angle: 90,
                  position: 'insideRight',
                  offset: 10,
                  className: 'fill-muted-foreground text-xs',
                }}
                className="text-xs"
                tickFormatter={(value) => value.toFixed(2)}
              />
            )}

            {/* Highlighted importance regions */}
            {significantRegions.map((region, idx) => (
              <ReferenceArea
                key={idx}
                yAxisId="importance"
                x1={region.start}
                x2={region.end}
                fill={getImportanceColor(region.normalized)}
                fillOpacity={1}
              />
            ))}

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">&lambda; {d.wavelength.toFixed(1)} cm&sup1;</p>
                    <p className="text-muted-foreground">
                      Importance: {d.importance.toFixed(4)}
                    </p>
                    {hasSpectrum && (
                      <p className="text-muted-foreground">
                        Absorbance: {d.absorbance.toFixed(4)}
                      </p>
                    )}
                  </div>
                );
              }}
            />

            {/* Mean spectrum as dashed gray background line */}
            {hasSpectrum && (
              <Line
                yAxisId="absorbance"
                type="monotone"
                dataKey="absorbance"
                stroke="hsl(var(--muted-foreground))"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                name="Mean Spectrum"
                opacity={0.5}
              />
            )}

            {/* SHAP importance as solid primary line */}
            <Line
              yAxisId="importance"
              type="monotone"
              dataKey="importance"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              name="SHAP Importance"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom chart: Binned importance bars */}
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={binnedBarData}
            margin={{ top: 10, right: 30, left: 10, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="center"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => value.toFixed(0)}
              label={{
                value: 'Wavelength (cm\u207B\u00B9)',
                position: 'bottom',
                offset: 20,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
            />
            <YAxis
              label={{
                value: 'Binned Importance',
                angle: -90,
                position: 'insideLeft',
                offset: 10,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const d = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">{d.label} cm&sup1;</p>
                    <p className="text-muted-foreground">
                      Importance: {d.importance.toFixed(4)}
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="importance"
              fill="hsl(var(--primary))"
              fillOpacity={0.8}
              radius={[2, 2, 0, 0]}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-8 h-0.5 bg-primary" />
          <span>SHAP importance</span>
        </div>
        {hasSpectrum && (
          <div className="flex items-center gap-1">
            <div className="w-8 h-0.5 border-t-2 border-dashed border-muted-foreground" />
            <span>Mean spectrum</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(13, 148, 136, 0.7)' }}
          />
          <span>High</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(45, 212, 191, 0.35)' }}
          />
          <span>Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(153, 246, 228, 0.15)' }}
          />
          <span>Low</span>
        </div>
      </div>
    </div>
  );
}
