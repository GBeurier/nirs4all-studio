/**
 * BiasVariance — Stacked bar chart of bias² + variance per group.
 *
 * Uses Recharts BarChart with two stacked Bar components.
 * Blue = bias², orange = variance.
 */

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { BiasVarianceResponse } from '@/types/inspector';

interface BiasVarianceProps {
  data: BiasVarianceResponse | null | undefined;
  isLoading: boolean;
}

interface BarData {
  group_label: string;
  bias_squared: number;
  variance: number;
  total_error: number;
  n_chains: number;
  n_folds: number;
  n_samples: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BarData }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
      <div className="font-medium mb-1">{d.group_label}</div>
      <div>Bias²: {d.bias_squared.toFixed(6)}</div>
      <div>Variance: {d.variance.toFixed(6)}</div>
      <div>Total Error: {d.total_error.toFixed(6)}</div>
      <div className="mt-1 text-muted-foreground">
        {d.n_chains} chains, {d.n_folds} folds, {d.n_samples} samples
      </div>
    </div>
  );
}

export function BiasVariance({ data, isLoading }: BiasVarianceProps) {
  const bars = useMemo<BarData[]>(() => {
    if (!data?.entries) return [];
    return data.entries.map(e => ({
      group_label: e.group_label,
      bias_squared: e.bias_squared ?? 0,
      variance: e.variance ?? 0,
      total_error: e.total_error ?? 0,
      n_chains: e.n_chains,
      n_folds: e.n_folds,
      n_samples: e.n_samples,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading bias-variance data...</span>
      </div>
    );
  }

  if (!data || bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No bias-variance data. Need chains with fold-level predictions (2+ folds per sample).
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis
            dataKey="group_label"
            tick={{ fontSize: 10, fill: 'currentColor' }}
            angle={-25}
            textAnchor="end"
            height={50}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'currentColor' }}
            label={{ value: 'Error', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
          />
          <RechartsTooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 10 }}
            iconSize={8}
          />
          <Bar
            dataKey="bias_squared"
            stackId="error"
            fill="#3b82f6"
            name="Bias²"
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="variance"
            stackId="error"
            fill="#f97316"
            name="Variance"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
