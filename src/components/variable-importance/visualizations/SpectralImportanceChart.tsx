import { useMemo } from 'react';
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
  Legend,
} from 'recharts';
import type { ShapResultsResponse } from '@/types/shap';

interface SpectralImportanceChartProps {
  jobId: string;
  results: ShapResultsResponse;
}

export function SpectralImportanceChart({ results }: SpectralImportanceChartProps) {
  // Prepare data for the chart
  const chartData = useMemo(() => {
    const { wavelengths, mean_abs_shap } = results;

    // Get mean spectrum from the first feature importance or use zeros
    // Note: We'd need to fetch spectral data from the API, for now use importance as proxy
    return wavelengths.map((wavelength, idx) => ({
      wavelength,
      importance: mean_abs_shap[idx],
    }));
  }, [results]);

  // Prepare binned regions for highlighting
  const binnedRegions = useMemo(() => {
    const { binned_importance } = results;
    const maxImportance = Math.max(...binned_importance.bin_values);

    return binned_importance.bin_ranges.map((range, idx) => ({
      start: range[0],
      end: range[1],
      importance: binned_importance.bin_values[idx],
      normalized: binned_importance.bin_values[idx] / maxImportance,
    }));
  }, [results]);

  // Get color for importance level
  const getImportanceColor = (normalized: number): string => {
    // Teal/cyan gradient matching the app theme
    if (normalized > 0.8) return 'rgba(13, 148, 136, 0.7)'; // teal-600
    if (normalized > 0.6) return 'rgba(20, 184, 166, 0.5)'; // teal-500
    if (normalized > 0.4) return 'rgba(45, 212, 191, 0.35)'; // teal-400
    if (normalized > 0.2) return 'rgba(94, 234, 212, 0.25)'; // teal-300
    return 'rgba(153, 246, 228, 0.15)'; // teal-200
  };

  // Filter regions with significant importance
  const significantRegions = binnedRegions.filter((r) => r.normalized > 0.2);

  // Binned bar chart data
  const binnedData = useMemo(() => {
    const { binned_importance } = results;
    return binned_importance.bin_centers.map((center, idx) => ({
      center,
      importance: binned_importance.bin_values[idx],
      label: `${binned_importance.bin_ranges[idx][0].toFixed(0)}-${binned_importance.bin_ranges[idx][1].toFixed(0)}`,
    }));
  }, [results]);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Top chart: Importance line with highlighted regions */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 30, left: 10, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="wavelength"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => value.toFixed(0)}
              label={{
                value: 'Wavelength (cm⁻¹)',
                position: 'bottom',
                offset: 15,
                className: 'fill-muted-foreground text-xs',
              }}
              className="text-xs"
            />
            <YAxis
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

            {/* Highlighted importance regions */}
            {significantRegions.map((region, idx) => (
              <ReferenceArea
                key={idx}
                x1={region.start}
                x2={region.end}
                fill={getImportanceColor(region.normalized)}
                fillOpacity={1}
              />
            ))}

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">λ {data.wavelength.toFixed(1)} cm⁻¹</p>
                    <p className="text-muted-foreground">
                      Importance: {data.importance.toFixed(4)}
                    </p>
                  </div>
                );
              }}
            />

            <Line
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
            data={binnedData}
            margin={{ top: 10, right: 30, left: 10, bottom: 40 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="center"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(value) => value.toFixed(0)}
              label={{
                value: 'Wavelength (cm⁻¹)',
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
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">{data.label} cm⁻¹</p>
                    <p className="text-muted-foreground">
                      Importance: {data.importance.toFixed(4)}
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
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(13, 148, 136, 0.7)' }}
          />
          <span>High importance</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(45, 212, 191, 0.35)' }}
          />
          <span>Medium importance</span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className="w-3 h-3 rounded"
            style={{ backgroundColor: 'rgba(153, 246, 228, 0.15)' }}
          />
          <span>Low importance</span>
        </div>
      </div>
    </div>
  );
}
