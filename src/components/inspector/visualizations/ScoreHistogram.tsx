/**
 * ScoreHistogram — Score distribution histogram for Inspector.
 *
 * Displays a bar chart of score distribution with clickable bars
 * that select the chains in each bin.
 */

import { useMemo, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import type { HistogramResponse, InspectorGroup } from '@/types/inspector';

interface ScoreHistogramProps {
  data: HistogramResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

interface BarData {
  label: string;
  count: number;
  binStart: number;
  binEnd: number;
  chainIds: string[];
  hasSelected: boolean;
}

export function ScoreHistogram({ data, groups, isLoading }: ScoreHistogramProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();

  // Build chain→group color lookup
  const chainColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const cid of group.chain_ids) map.set(cid, group.color);
    }
    return map;
  }, [groups]);

  // Format bins for the bar chart
  const bars = useMemo((): BarData[] => {
    if (!data?.bins?.length) return [];

    return data.bins.map(bin => {
      const hasSelected = hasSelection && bin.chain_ids.some(id => selectedChains.has(id));
      return {
        label: `${bin.bin_start.toFixed(3)}`,
        count: bin.count,
        binStart: bin.bin_start,
        binEnd: bin.bin_end,
        chainIds: bin.chain_ids,
        hasSelected,
      };
    });
  }, [data, hasSelection, selectedChains]);

  // Determine dominant color per bar from chain groups
  const barColors = useMemo(() => {
    return bars.map(bar => {
      if (bar.chainIds.length === 0) return '#64748b';
      // Use the most common group color in the bin
      const colorCounts = new Map<string, number>();
      for (const cid of bar.chainIds) {
        const c = chainColorMap.get(cid) ?? '#64748b';
        colorCounts.set(c, (colorCounts.get(c) ?? 0) + 1);
      }
      let maxColor = '#64748b';
      let maxCount = 0;
      for (const [c, n] of colorCounts) {
        if (n > maxCount) { maxCount = n; maxColor = c; }
      }
      return maxColor;
    });
  }, [bars, chainColorMap]);

  const handleBarClick = useCallback((barData: BarData) => {
    if (barData.chainIds.length === 0) return;
    const allSelected = barData.chainIds.every(id => selectedChains.has(id));
    if (allSelected) {
      select(barData.chainIds, 'remove');
    } else {
      select(barData.chainIds, 'add');
    }
  }, [select, selectedChains]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading histogram...</span>
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No score data available.
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {/* Stats header */}
      {data && (
        <div className="absolute top-1 left-10 z-10 text-xs text-muted-foreground bg-card/80 px-2 py-1 rounded">
          {data.min_score != null && <>min: {data.min_score.toFixed(4)}</>}
          {data.mean_score != null && <> | mean: {data.mean_score.toFixed(4)}</>}
          {data.max_score != null && <> | max: {data.max_score.toFixed(4)}</>}
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bars}
          margin={{ top: 20, right: 20, bottom: 30, left: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9 }}
            label={{ value: data?.score_column ?? 'Score', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <RechartsTooltip
            content={({ payload }) => {
              if (!payload?.[0]?.payload) return null;
              const d = payload[0].payload as BarData;
              return (
                <div className="bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border">
                  <div>Range: [{d.binStart.toFixed(4)}, {d.binEnd.toFixed(4)})</div>
                  <div>Count: {d.count}</div>
                  <div>{((d.count / (data?.total_chains ?? 1)) * 100).toFixed(1)}% of total</div>
                </div>
              );
            }}
          />

          {/* Mean reference line */}
          {data?.mean_score != null && (
            <ReferenceLine
              x={data.mean_score.toFixed(3)}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}

          <Bar
            dataKey="count"
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(_data: unknown, index: number) => {
              handleBarClick(bars[index]);
            }}
          >
            {bars.map((bar, idx) => (
              <Cell
                key={idx}
                fill={barColors[idx]}
                fillOpacity={hasSelection && !bar.hasSelected ? 0.3 : 0.8}
                stroke={bar.hasSelected ? barColors[idx] : 'none'}
                strokeWidth={bar.hasSelected ? 2 : 0}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
