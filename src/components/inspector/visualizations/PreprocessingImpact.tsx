/**
 * PreprocessingImpact — Bar chart showing impact of each preprocessing step.
 *
 * Positive impact (green) = step improves score, negative (red) = worsens score.
 * Uses Recharts BarChart with Cell-based coloring.
 */

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { PreprocessingImpactResponse } from '@/types/inspector';

interface PreprocessingImpactProps {
  data: PreprocessingImpactResponse | null | undefined;
  isLoading: boolean;
}

interface BarData {
  name: string;
  impact: number;
  mean_with: number;
  mean_without: number;
  count_with: number;
  count_without: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BarData }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
      <div className="font-medium mb-1">{d.name}</div>
      <div>Impact: {d.impact >= 0 ? '+' : ''}{d.impact.toFixed(4)}</div>
      <div>Mean with: {d.mean_with.toFixed(4)} ({d.count_with} chains)</div>
      <div>Mean without: {d.mean_without.toFixed(4)} ({d.count_without} chains)</div>
    </div>
  );
}

export function PreprocessingImpact({ data, isLoading }: PreprocessingImpactProps) {
  const bars = useMemo<BarData[]>(() => {
    if (!data?.entries) return [];
    return data.entries.map(e => ({
      name: e.step_name,
      impact: e.impact ?? 0,
      mean_with: e.mean_with ?? 0,
      mean_without: e.mean_without ?? 0,
      count_with: e.count_with,
      count_without: e.count_without,
    }));
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading preprocessing impact...</span>
      </div>
    );
  }

  if (!data || bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No preprocessing impact data available.
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: 'currentColor' }}
            angle={-35}
            textAnchor="end"
            height={60}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'currentColor' }}
            label={{ value: 'Impact', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
          />
          <RechartsTooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
          <Bar dataKey="impact" radius={[2, 2, 0, 0]}>
            {bars.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.impact >= 0 ? '#059669' : '#e11d48'}
                opacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
