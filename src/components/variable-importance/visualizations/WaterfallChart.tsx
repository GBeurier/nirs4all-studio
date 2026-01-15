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
import type { SampleExplanationResponse } from '@/types/shap';

interface WaterfallChartProps {
  jobId: string;
  sampleIdx: number;
  totalSamples: number;
  onSampleChange: (idx: number) => void;
}

interface WaterfallBarData {
  name: string;
  start: number;
  end: number;
  value: number;
  isPositive: boolean;
  isBase: boolean;
  isFinal: boolean;
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

  // Prepare waterfall chart data
  const chartData = useMemo(() => {
    if (!data) return [];

    const bars: WaterfallBarData[] = [];

    // Base value bar
    bars.push({
      name: 'Base Value',
      start: 0,
      end: data.base_value,
      value: data.base_value,
      isPositive: true,
      isBase: true,
      isFinal: false,
    });

    // Contribution bars (sorted by absolute value, positive first)
    const sortedContributions = [...data.contributions].sort((a, b) => {
      // Sort by sign first (positive before negative), then by absolute value
      if (a.shap_value >= 0 && b.shap_value < 0) return -1;
      if (a.shap_value < 0 && b.shap_value >= 0) return 1;
      return Math.abs(b.shap_value) - Math.abs(a.shap_value);
    });

    let cumulative = data.base_value;
    sortedContributions.forEach((contrib) => {
      const start = cumulative;
      const end = cumulative + contrib.shap_value;
      bars.push({
        name: contrib.feature_name,
        start,
        end,
        value: contrib.shap_value,
        isPositive: contrib.shap_value >= 0,
        isBase: false,
        isFinal: false,
      });
      cumulative = end;
    });

    // Final prediction bar
    bars.push({
      name: 'Prediction',
      start: 0,
      end: data.predicted_value,
      value: data.predicted_value,
      isPositive: true,
      isBase: false,
      isFinal: true,
    });

    return bars;
  }, [data]);

  const handlePrevSample = () => {
    if (sampleIdx > 0) {
      onSampleChange(sampleIdx - 1);
    }
  };

  const handleNextSample = () => {
    if (sampleIdx < totalSamples - 1) {
      onSampleChange(sampleIdx + 1);
    }
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
              const val = parseInt(e.target.value, 10);
              if (!isNaN(val) && val >= 0 && val < totalSamples) {
                onSampleChange(val);
              }
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
                const bar = payload[0].payload as WaterfallBarData;
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
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    entry.isBase
                      ? 'hsl(var(--muted-foreground))'
                      : entry.isFinal
                        ? 'hsl(var(--primary))'
                        : entry.isPositive
                          ? '#22c55e' // green-500
                          : '#ef4444' // red-500
                  }
                  fillOpacity={entry.isBase || entry.isFinal ? 0.8 : 0.7}
                />
              ))}
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
