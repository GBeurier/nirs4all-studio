import { useEffect, useState, useMemo } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSampleExplanation } from '@/api/shap';
import {
  buildShapWaterfallBars,
  getShapWaterfallBarStyle,
  getShapWaterfallNextSample,
  getShapWaterfallPreviousSample,
  parseShapWaterfallSampleInput,
} from '@/lib/shapWaterfallData';
import type { ShapWaterfallBarData } from '@/lib/shapWaterfallData';
import type { SampleExplanationResponse } from '@/types/shap';

interface WaterfallChartProps {
  jobId: string;
  sampleIdx: number;
  totalSamples: number;
  onSampleChange: (idx: number) => void;
}

export function WaterfallChart({
  jobId,
  sampleIdx,
  totalSamples,
  onSampleChange,
}: WaterfallChartProps) {
  const [data, setData] = useState<SampleExplanationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    getSampleExplanation(jobId, sampleIdx, 12)
      .then((response) => {
        setData(response);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Failed to load sample explanation');
        setLoading(false);
      });
  }, [jobId, sampleIdx]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return buildShapWaterfallBars(data);
  }, [data]);

  const handlePrevSample = () => {
    const previousSample = getShapWaterfallPreviousSample(sampleIdx);
    if (previousSample != null) onSampleChange(previousSample);
  };

  const handleNextSample = () => {
    const nextSample = getShapWaterfallNextSample(sampleIdx, totalSamples);
    if (nextSample != null) onSampleChange(nextSample);
  };

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

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No explanation data available
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sample selector */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sample:</Label>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handlePrevSample}
            disabled={sampleIdx === 0}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="number"
            value={sampleIdx}
            onChange={(e) => {
              const nextSample = parseShapWaterfallSampleInput(e.target.value, totalSamples);
              if (nextSample != null) onSampleChange(nextSample);
            }}
            className="w-20 h-8 text-center"
            min={0}
            max={totalSamples - 1}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={handleNextSample}
            disabled={sampleIdx === totalSamples - 1}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">of {totalSamples}</span>
        </div>
        <div className="text-sm">
          <span className="text-muted-foreground">Predicted: </span>
          <span className="font-medium">{data.predicted_value.toFixed(4)}</span>
        </div>
      </div>

      {/* Waterfall chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 120, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
            <XAxis
              type="number"
              domain={['auto', 'auto']}
              tickFormatter={(value) => value.toFixed(2)}
              className="text-xs"
            />
            <YAxis
              type="category"
              dataKey="name"
              width={110}
              tick={{ fontSize: 11 }}
              className="text-xs"
            />
            <ReferenceLine x={data.base_value} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const bar = payload[0].payload as ShapWaterfallBarData;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-2 text-sm">
                    <p className="font-medium">{bar.name}</p>
                    {bar.isBase ? (
                      <p>Expected value: {bar.value.toFixed(4)}</p>
                    ) : bar.isFinal ? (
                      <p>Final prediction: {bar.value.toFixed(4)}</p>
                    ) : (
                      <p>
                        Contribution: {bar.value >= 0 ? '+' : ''}
                        {bar.value.toFixed(4)}
                      </p>
                    )}
                  </div>
                );
              }}
            />
            {/* Invisible bars for positioning */}
            <Bar dataKey="start" stackId="stack" fill="transparent" />
            {/* Visible contribution bars */}
            <Bar dataKey="value" stackId="stack" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => {
                const style = getShapWaterfallBarStyle(entry);
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={style.fill}
                    fillOpacity={style.fillOpacity}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-gray-400" />
          <span>Base value</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-500" />
          <span>Increases prediction</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span>Decreases prediction</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(var(--primary))' }} />
          <span>Final prediction</span>
        </div>
      </div>
    </div>
  );
}
