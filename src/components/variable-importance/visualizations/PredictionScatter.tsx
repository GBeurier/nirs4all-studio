import { useEffect, useState, useMemo, useCallback, useRef, memo } from 'react';
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

export const PredictionScatter = memo(function PredictionScatter({
  jobId,
  selectedSamples,
  onSamplesChange,
}: PredictionScatterProps) {
  const [data, setData] = useState<ScatterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onSamplesChangeRef = useRef(onSamplesChange);
  onSamplesChangeRef.current = onSamplesChange;

  const selectedSet = useMemo(() => new Set(selectedSamples), [selectedSamples]);

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

  const maxAbsRes = useMemo(() => {
    if (chartPoints.length === 0) return 1;
    return Math.max(...chartPoints.map((p) => p.absResidual), 1e-9);
  }, [chartPoints]);

  const bounds = useMemo(() => {
    if (chartPoints.length === 0) return { min: 0, max: 1 };
    const allVals = chartPoints.flatMap((p) => [p.yTrue, p.yPred]);
    return { min: Math.min(...allVals), max: Math.max(...allVals) };
  }, [chartPoints]);

  const getPointColor = useCallback(
    (absResidual: number, isSelected: boolean): string => {
      if (isSelected) return '#f59e0b';
      const ratio = absResidual / maxAbsRes;
      if (ratio > 0.7) return '#ef4444';
      if (ratio > 0.4) return '#f97316';
      if (ratio > 0.2) return '#84cc16';
      return '#22c55e';
    },
    [maxAbsRes],
  );

  // Stable click handler using ref to avoid re-renders
  const handlePointClick = useCallback(
    (point: { sampleIdx: number }) => {
      const idx = point.sampleIdx;
      onSamplesChangeRef.current((prev: number[]) => {
        const set = new Set(prev);
        if (set.has(idx)) set.delete(idx);
        else set.add(idx);
        return Array.from(set).sort((a, b) => a - b);
      });
    },
    [],
  );

  const handleClear = useCallback(() => {
    onSamplesChangeRef.current([]);
  }, []);

  // Memoize tooltip to avoid re-creating on every render
  const tooltipContent = useCallback(
    ({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof chartPoints[0] }> }) => {
      if (!active || !payload || !payload.length) return null;
      const p = payload[0].payload;
      return (
        <div className="bg-popover border rounded-lg shadow-lg p-2 text-xs">
          <p className="font-medium">Sample #{p.sampleIdx}</p>
          <p>True: {p.yTrue.toFixed(3)}</p>
          <p>Pred: {p.yPred.toFixed(3)}</p>
          <p className="text-muted-foreground">Residual: {p.residual.toFixed(3)}</p>
        </div>
      );
    },
    [],
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data || data.y_true.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        {error || 'No prediction data available'}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-xs font-medium text-muted-foreground">
          Predicted vs True — click points to select samples
        </h4>
        <div className="flex items-center gap-3">
          {selectedSamples.length > 0 && (
            <button
              className="text-xs text-primary hover:underline"
              onClick={handleClear}
            >
              Clear ({selectedSamples.length} selected)
            </button>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />Good</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />Outlier</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-500" />Selected</span>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 20, left: 10, bottom: 25 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              type="number"
              dataKey="yTrue"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              label={{ value: 'True', position: 'bottom', offset: 10, fontSize: 10, className: 'fill-muted-foreground' }}
            />
            <YAxis
              type="number"
              dataKey="yPred"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10 }}
              width={50}
              label={{ value: 'Predicted', angle: -90, position: 'insideLeft', offset: 5, fontSize: 10, className: 'fill-muted-foreground' }}
            />
            <ReferenceLine
              segment={[{ x: bounds.min, y: bounds.min }, { x: bounds.max, y: bounds.max }]}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="4 4"
              strokeOpacity={0.5}
            />
            <Tooltip content={tooltipContent} />
            <Scatter
              data={chartPoints}
              isAnimationActive={false}
              onClick={(data) => {
                if (data?.sampleIdx !== undefined) handlePointClick(data);
              }}
            >
              {chartPoints.map((entry, index) => {
                const isSelected = selectedSet.has(entry.sampleIdx);
                return (
                  <Cell
                    key={index}
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
    </div>
  );
});
