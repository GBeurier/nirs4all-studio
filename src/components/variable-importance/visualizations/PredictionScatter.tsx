import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
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
import { getScatterData } from '@/api/shap';
import type { ScatterData } from '@/types/shap';

interface PredictionScatterProps {
  jobId: string;
  selectedSamples: number[];
  onSamplesChange: (samples: number[]) => void;
}

export function PredictionScatter({
  jobId,
  selectedSamples,
  onSamplesChange,
}: PredictionScatterProps) {
  const [data, setData] = useState<ScatterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedSet = useRef(new Set<number>());

  // Keep ref in sync
  selectedSet.current = new Set(selectedSamples);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getScatterData(jobId)
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load scatter data');
        setLoading(false);
      });
  }, [jobId]);

  const chartPoints = useMemo(() => {
    if (!data) return [];
    return data.y_true.map((yt, idx) => ({
      yTrue: yt,
      yPred: data.y_pred[idx],
      sampleIdx: data.sample_indices[idx],
      residual: data.residuals[idx],
      absResidual: Math.abs(data.residuals[idx]),
    }));
  }, [data]);

  // Compute color based on absolute residual
  const maxAbsRes = useMemo(() => {
    if (chartPoints.length === 0) return 1;
    return Math.max(...chartPoints.map((p) => p.absResidual), 1e-9);
  }, [chartPoints]);

  // Diagonal bounds for reference line
  const bounds = useMemo(() => {
    if (chartPoints.length === 0) return { min: 0, max: 1 };
    const allVals = chartPoints.flatMap((p) => [p.yTrue, p.yPred]);
    return { min: Math.min(...allVals), max: Math.max(...allVals) };
  }, [chartPoints]);

  const getPointColor = useCallback(
    (absResidual: number, isSelected: boolean): string => {
      if (isSelected) return '#f59e0b'; // amber-500 for selected
      const ratio = absResidual / maxAbsRes;
      // Green (well predicted) → red (outlier)
      if (ratio > 0.7) return '#ef4444'; // red-500
      if (ratio > 0.4) return '#f97316'; // orange-500
      if (ratio > 0.2) return '#84cc16'; // lime-500
      return '#22c55e'; // green-500
    },
    [maxAbsRes],
  );

  const handlePointClick = useCallback(
    (point: { sampleIdx: number }) => {
      const idx = point.sampleIdx;
      const current = new Set(selectedSet.current);
      if (current.has(idx)) {
        current.delete(idx);
      } else {
        current.add(idx);
      }
      onSamplesChange(Array.from(current).sort((a, b) => a - b));
    },
    [onSamplesChange],
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        {error || 'No data'}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-medium text-muted-foreground">
          y<sub>pred</sub> vs y<sub>true</sub>
        </h4>
        {selectedSamples.length > 0 && (
          <button
            className="text-xs text-primary hover:underline"
            onClick={() => onSamplesChange([])}
          >
            Clear ({selectedSamples.length})
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 5, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              type="number"
              dataKey="yTrue"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              label={{
                value: 'True',
                position: 'bottom',
                offset: 5,
                fontSize: 10,
                className: 'fill-muted-foreground',
              }}
            />
            <YAxis
              type="number"
              dataKey="yPred"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              width={40}
              label={{
                value: 'Pred',
                angle: -90,
                position: 'insideLeft',
                offset: 5,
                fontSize: 10,
                className: 'fill-muted-foreground',
              }}
            />
            <ReferenceLine
              segment={[
                { x: bounds.min, y: bounds.min },
                { x: bounds.max, y: bounds.max },
              ]}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const p = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-xs">
                    <p className="font-medium">Sample #{p.sampleIdx}</p>
                    <p>True: {p.yTrue.toFixed(3)}</p>
                    <p>Pred: {p.yPred.toFixed(3)}</p>
                    <p className="text-muted-foreground">
                      Residual: {p.residual.toFixed(3)}
                    </p>
                  </div>
                );
              }}
            />
            <Scatter
              data={chartPoints}
              onClick={(data) => {
                if (data?.sampleIdx !== undefined) handlePointClick(data);
              }}
            >
              {chartPoints.map((entry, index) => {
                const isSelected = selectedSet.current.has(entry.sampleIdx);
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={getPointColor(entry.absResidual, isSelected)}
                    fillOpacity={isSelected ? 1 : 0.7}
                    stroke={isSelected ? '#f59e0b' : 'none'}
                    strokeWidth={isSelected ? 2 : 0}
                    r={isSelected ? 5 : 3}
                    cursor="pointer"
                  />
                );
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-3 pt-1 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span>Good</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span>Outlier</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span>Selected</span>
        </div>
      </div>
    </div>
  );
}
