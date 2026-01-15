import { useMemo } from 'react';
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
import type { MetricConvergenceItem } from '@/types/transfer';

interface MetricConvergenceChartProps {
  convergenceData: MetricConvergenceItem[];
}

// Define metrics to display
const METRICS = ['EVR', 'CKA', 'RV', 'Procrustes', 'Trustworthiness', 'Grassmann'];

export function MetricConvergenceChart({ convergenceData }: MetricConvergenceChartProps) {
  // Group by metric
  const dataByMetric = useMemo(() => {
    const grouped: Record<string, { preproc: string; convergence: number }[]> = {};
    for (const metric of METRICS) {
      grouped[metric] = [];
    }

    for (const item of convergenceData) {
      if (grouped[item.metric]) {
        grouped[item.metric].push({
          preproc: item.preproc,
          convergence: item.convergence,
        });
      }
    }

    // Sort each metric's data by convergence (descending)
    for (const metric of METRICS) {
      grouped[metric].sort((a, b) => b.convergence - a.convergence);
    }

    return grouped;
  }, [convergenceData]);

  if (convergenceData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No convergence data available
      </div>
    );
  }

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: { value: number }[];
    label?: string;
  }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg shadow-lg p-2 text-sm">
          <p className="font-medium">{label}</p>
          <p className={payload[0].value > 0 ? 'text-green-600' : 'text-red-600'}>
            Convergence: {(payload[0].value * 100).toFixed(1)}%
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {METRICS.map((metric) => {
          const data = dataByMetric[metric];
          if (!data || data.length === 0) return null;

          const isInverted = metric === 'Procrustes' || metric === 'Grassmann';

          return (
            <div key={metric} className="space-y-1">
              <div className="text-sm font-medium flex items-center gap-1">
                {metric}
                {isInverted && <span className="text-xs text-muted-foreground">*</span>}
              </div>
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.slice(0, 5)}
                    layout="vertical"
                    margin={{ top: 0, right: 10, left: 60, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[-1, 1]}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="preproc"
                      width={55}
                      tick={{ fontSize: 9 }}
                      tickFormatter={(v) => (v.length > 8 ? v.slice(0, 7) + '...' : v)}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine x={0} stroke="#666" strokeDasharray="3 3" />
                    <Bar dataKey="convergence" radius={[0, 4, 4, 0]}>
                      {data.slice(0, 5).map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.convergence > 0 ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'}
                          fillOpacity={0.7}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
        <p>
          <strong>Convergence:</strong> Positive values indicate preprocessing reduces variance across
          datasets (datasets become more similar).
        </p>
        <p>
          <strong>*</strong> Procrustes and Grassmann are inverted so that positive = better quality.
        </p>
      </div>
    </div>
  );
}
