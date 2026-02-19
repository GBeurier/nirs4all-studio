import { useEffect, useState, useMemo, memo } from 'react';
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
  selectedSamples?: number[];
}

// Generate jittered y-positions for points within each bin
function jitterPoints(bin: BeeswarmBin, binIndex: number): Array<{
  x: number;
  y: number;
  color: number;
  sampleIdx: number;
  binLabel: string;
}> {
  return bin.points.map((point) => {
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
  if (featureValue > 0.8) return '#ef4444';
  if (featureValue > 0.6) return '#f97316';
  if (featureValue > 0.4) return '#eab308';
  if (featureValue > 0.2) return '#22c55e';
  return '#3b82f6';
}

export const BeeswarmChart = memo(function BeeswarmChart({
  jobId,
  onSampleSelect,
  selectedSamples = [],
}: BeeswarmChartProps) {
  const selectedSet = useMemo(() => new Set(selectedSamples), [selectedSamples]);
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
      allPoints.push(...jitterPoints(bin, binIndex));
    });
    return allPoints;
  }, [data]);

  const yTickLabels = useMemo(() => {
    if (!data) return [];
    return data.bins.map((bin, idx) => ({ value: idx, label: bin.label }));
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
            label={{ value: 'SHAP value (impact on prediction)', position: 'bottom', offset: 20, className: 'fill-muted-foreground text-xs' }}
            className="text-xs"
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-0.5, data.bins.length - 0.5]}
            ticks={yTickLabels.map((t) => t.value)}
            tickFormatter={(value: number) => {
              const tick = yTickLabels.find((t) => t.value === value);
              return tick?.label || '';
            }}
            label={{ value: 'Wavelength Region (cm\u207B\u00B9)', angle: -90, position: 'insideLeft', offset: -80, className: 'fill-muted-foreground text-xs' }}
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
                  <p className="text-muted-foreground">Feature value: {(point.color * 100).toFixed(0)}%</p>
                  <p className="text-xs text-muted-foreground">Sample #{point.sampleIdx}</p>
                </div>
              );
            }}
          />
          <Scatter
            data={chartData}
            isAnimationActive={false}
            onClick={(data) => {
              if (onSampleSelect && data?.sampleIdx !== undefined) {
                onSampleSelect(data.sampleIdx);
              }
            }}
          >
            {chartData.map((entry, index) => {
              const isSelected = selectedSet.has(entry.sampleIdx);
              return (
                <Cell
                  key={index}
                  fill={isSelected ? '#f59e0b' : getPointColor(entry.color)}
                  fillOpacity={isSelected ? 1 : 0.7}
                  stroke={isSelected ? '#f59e0b' : 'none'}
                  strokeWidth={isSelected ? 2 : 0}
                  cursor="pointer"
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-center gap-6 py-2 text-xs text-muted-foreground shrink-0">
        <span>Feature value:</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-blue-500" />Low</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-green-500" />Med-Low</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />Med</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-orange-500" />Med-High</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-red-500" />High</span>
      </div>
    </div>
  );
});
