import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ErrorBar,
  Cell,
} from 'recharts';
import { ProcessedData } from '@/types/spectral';
import { LayoutGrid } from 'lucide-react';

interface FoldBoxPlotsProps {
  data: ProcessedData;
  numFolds?: number;
}

export function FoldBoxPlots({ data, numFolds = 5 }: FoldBoxPlotsProps) {
  const foldStats = useMemo(() => {
    const foldSize = Math.ceil(data.y.length / numFolds);
    const folds: number[][] = [];

    // Stratified split by Y value
    const sortedIndices = data.y
      .map((y, i) => ({ y, i }))
      .sort((a, b) => a.y - b.y)
      .map(item => item.i);

    for (let i = 0; i < numFolds; i++) {
      folds[i] = [];
    }

    sortedIndices.forEach((idx, i) => {
      folds[i % numFolds].push(data.y[idx]);
    });

    return folds.map((fold, i) => {
      const sorted = [...fold].sort((a, b) => a - b);
      const n = sorted.length;

      const q1 = sorted[Math.floor(n * 0.25)];
      const median = sorted[Math.floor(n * 0.5)];
      const q3 = sorted[Math.floor(n * 0.75)];
      const min = sorted[0];
      const max = sorted[n - 1];
      const mean = fold.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(fold.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / n);

      return {
        fold: `Fold ${i + 1}`,
        min,
        q1,
        median,
        q3,
        max,
        mean,
        std,
        count: n,
        iqr: q3 - q1,
        lowerError: median - q1,
        upperError: q3 - median,
      };
    });
  }, [data.y, numFolds]);

  const colors = [
    'hsl(173, 80%, 45%)',
    'hsl(217, 70%, 50%)',
    'hsl(142, 76%, 45%)',
    'hsl(38, 92%, 50%)',
    'hsl(280, 65%, 55%)',
  ];

  return (
    <div className="h-full flex flex-col">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-2">
        <LayoutGrid className="w-4 h-4 text-primary" />
        Cross-Validation Folds ({numFolds})
      </h3>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={foldStats} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
            <XAxis
              dataKey="fold"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              label={{ value: 'Y Value', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  median: 'Median',
                  min: 'Min',
                  max: 'Max',
                  q1: 'Q1',
                  q3: 'Q3',
                  mean: 'Mean',
                  std: 'Std Dev',
                  count: 'Samples',
                };
                return [typeof value === 'number' ? value.toFixed(2) : value, labels[name] || name];
              }}
            />
            <Bar
              dataKey="median"
              fill="hsl(var(--primary))"
              radius={[4, 4, 0, 0]}
              barSize={40}
            >
              {foldStats.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
              <ErrorBar
                dataKey="lowerError"
                direction="y"
                stroke="hsl(var(--foreground))"
                strokeWidth={2}
              />
              <ErrorBar
                dataKey="upperError"
                direction="y"
                stroke="hsl(var(--foreground))"
                strokeWidth={2}
              />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-5 gap-1 mt-2 text-xs">
        {foldStats.map((fold, i) => (
          <div key={i} className="text-center p-1 rounded bg-muted">
            <div className="font-medium" style={{ color: colors[i % colors.length] }}>
              {fold.count}
            </div>
            <div className="text-muted-foreground text-[10px]">samples</div>
          </div>
        ))}
      </div>
    </div>
  );
}
