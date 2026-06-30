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
import {
  buildShapBeeswarmPoints,
  buildShapBeeswarmYTicks,
  getShapBeeswarmPointStyle,
} from '@/lib/shapBeeswarmData';
import type { BeeswarmDataResponse } from '@/types/shap';

interface BeeswarmChartProps {
  jobId: string;
  onSampleSelect?: (sampleIdx: number) => void;
  selectedSamples?: number[];
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
    return buildShapBeeswarmPoints(data.bins);
  }, [data]);

  const yTickLabels = useMemo(() => {
    if (!data) return [];
    return buildShapBeeswarmYTicks(data.bins);
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
              const style = getShapBeeswarmPointStyle(entry.color, isSelected);
              return (
                <Cell
                  key={index}
                  fill={style.fill}
                  fillOpacity={style.fillOpacity}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
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
