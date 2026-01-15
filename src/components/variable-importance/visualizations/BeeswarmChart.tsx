import { useEffect, useState, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { getBeeswarmData } from '@/api/shap';
import type { BeeswarmDataResponse, BeeswarmBin } from '@/types/shap';

interface BeeswarmChartProps {
  jobId: string;
  onSampleSelect?: (sampleIdx: number) => void;
}

// Generate jittered y-positions for points within each bin
function jitterPoints(bin: BeeswarmBin, binIndex: number): Array<{
  x: number;
  y: number;
  color: number;
  sampleIdx: number;
  binLabel: string;
}> {
  return bin.points.map((point, pointIdx) => {
    // Jitter within the bin's y-range
    const jitter = (Math.random() - 0.5) * 0.6;
    return {
      x: point.shap_value,
      y: binIndex + jitter,
      color: point.feature_value,
      sampleIdx: point.sample_idx,
      binLabel: bin.label,
    };
  });
}

// Get color based on feature value (0-1)
function getPointColor(featureValue: number): string {
  // Low values = blue, high values = red (standard SHAP coloring)
  if (featureValue > 0.8) return '#ef4444'; // red-500
  if (featureValue > 0.6) return '#f97316'; // orange-500
  if (featureValue > 0.4) return '#eab308'; // yellow-500
  if (featureValue > 0.2) return '#22c55e'; // green-500
  return '#3b82f6'; // blue-500
}

export function BeeswarmChart({ jobId, onSampleSelect }: BeeswarmChartProps) {
  const [data, setData] = useState<BeeswarmDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    getBeeswarmData(jobId, 200)
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load beeswarm data');
        setLoading(false);
      });
  }, [jobId]);

  // Prepare chart data with jittered positions
  const chartData = useMemo(() => {
    if (!data) return [];

    const allPoints: Array<{
      x: number;
      y: number;
      color: number;
      sampleIdx: number;
      binLabel: string;
    }> = [];

    data.bins.forEach((bin, binIndex) => {
      const jitteredPoints = jitterPoints(bin, binIndex);
      allPoints.push(...jitteredPoints);
    });

    return allPoints;
  }, [data]);

  // Y-axis tick labels (bin labels)
  const yTickLabels = useMemo(() => {
    if (!data) return [];
    return data.bins.map((bin, idx) => ({
      value: idx,
      label: bin.label,
    }));
  }, [data]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-destructive">
        {error}
      </div>
    );
  }

  if (!data || data.bins.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No beeswarm data available
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 30, left: 100, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            type="number"
            dataKey="x"
            domain={['auto', 'auto']}
            label={{
              value: 'SHAP value (impact on prediction)',
              position: 'bottom',
              offset: 20,
              className: 'fill-muted-foreground text-xs',
            }}
            className="text-xs"
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-0.5, data.bins.length - 0.5]}
            ticks={yTickLabels.map((t) => t.value)}
            tickFormatter={(value) => {
              const tick = yTickLabels.find((t) => t.value === value);
              return tick?.label || '';
            }}
            label={{
              value: 'Wavelength Region (cm⁻¹)',
              angle: -90,
              position: 'insideLeft',
              offset: -80,
              className: 'fill-muted-foreground text-xs',
            }}
            className="text-xs"
            width={90}
          />
          <ReferenceLine x={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const point = payload[0].payload;
              return (
                <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                  <p className="font-medium">{point.binLabel} cm⁻¹</p>
                  <p>SHAP: {point.x.toFixed(4)}</p>
                  <p className="text-muted-foreground">
                    Feature value: {(point.color * 100).toFixed(0)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Sample #{point.sampleIdx}
                  </p>
                </div>
              );
            }}
          />
          <Scatter
            data={chartData}
            onClick={(data) => {
              if (onSampleSelect && data?.sampleIdx !== undefined) {
                onSampleSelect(data.sampleIdx);
              }
            }}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={getPointColor(entry.color)}
                fillOpacity={0.7}
                cursor="pointer"
              />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      {/* Color legend */}
      <div className="flex items-center justify-center gap-6 py-2 text-xs text-muted-foreground">
        <span>Feature value:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span>Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>Medium-Low</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-yellow-500" />
          <span>Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-orange-500" />
          <span>Medium-High</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>High</span>
        </div>
      </div>
    </div>
  );
}
