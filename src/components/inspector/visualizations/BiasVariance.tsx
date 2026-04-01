/**
 * BiasVariance — Stacked bar chart of bias² + variance per group.
 *
 * The panel now explains what it can and cannot say, highlights the
 * contribution of each component, and supports click-to-select on bars.
 */

import { useMemo, type ComponentType } from 'react';
import { AlertCircle, Loader2, MousePointerClick } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend, LabelList,
} from 'recharts';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import type { BiasVarianceResponse } from '@/types/inspector';

interface BiasVarianceProps {
  data: BiasVarianceResponse | null | undefined;
  isLoading: boolean;
}

type BiasVarianceData = BiasVarianceResponse & { reason?: string | null };

interface BarData {
  group_label: string;
  bias_squared: number;
  variance: number;
  total_error: number;
  n_chains: number;
  n_folds: number;
  n_samples: number;
  chain_ids: string[];
  bias_share: number;
  variance_share: number;
}

function StateCard({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-border/60 bg-card/70 p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BarData }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const total = Math.max(d.total_error, 1e-12);
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="mb-1 font-medium">{d.group_label}</div>
      <div>Bias²: {d.bias_squared.toFixed(6)} ({(d.bias_share * 100).toFixed(1)}%)</div>
      <div>Variance: {d.variance.toFixed(6)} ({(d.variance_share * 100).toFixed(1)}%)</div>
      <div>Total error: {total.toFixed(6)}</div>
      <div className="mt-1 text-muted-foreground">
        {d.n_chains} chains, {d.n_folds} folds, {d.n_samples} samples
      </div>
    </div>
  );
}

function formatTotal(value: number): string {
  if (value >= 10) return value.toFixed(2);
  if (value >= 1) return value.toFixed(3);
  return value.toFixed(4);
}

export function BiasVariance({ data, isLoading }: BiasVarianceProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const chartData = data as BiasVarianceData | null | undefined;
  const reason = chartData?.reason?.trim() || null;

  const bars = useMemo<BarData[]>(() => {
    if (!chartData?.entries) return [];
    return chartData.entries.map(entry => {
      const bias = entry.bias_squared ?? 0;
      const variance = entry.variance ?? 0;
      const total = entry.total_error ?? bias + variance;
      return {
        group_label: entry.group_label,
        bias_squared: bias,
        variance,
        total_error: total,
        n_chains: entry.n_chains,
        n_folds: entry.n_folds,
        n_samples: entry.n_samples,
        chain_ids: entry.chain_ids ?? [],
        bias_share: total > 0 ? bias / total : 0,
        variance_share: total > 0 ? variance / total : 0,
      };
    });
  }, [chartData]);

  const totals = useMemo(() => {
    const totalBias = bars.reduce((sum, bar) => sum + bar.bias_squared, 0);
    const totalVariance = bars.reduce((sum, bar) => sum + bar.variance, 0);
    const totalError = bars.reduce((sum, bar) => sum + bar.total_error, 0);
    return { totalBias, totalVariance, totalError };
  }, [bars]);

  const handleBarClick = (bar: BarData | undefined) => {
    if (!bar || bar.chain_ids.length === 0) return;
    const allSelected = bar.chain_ids.every(id => selectedChains.has(id));
    if (allSelected) select(bar.chain_ids, 'remove');
    else select(bar.chain_ids, 'add');
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading bias-variance data...</span>
      </div>
    );
  }

  if (!chartData || bars.length === 0) {
    return (
      <StateCard
        icon={AlertCircle}
        title="No bias-variance signal"
        description={reason ?? 'This view needs chains with repeated fold-level predictions for the same samples.'}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Bias-variance decomposition</span>
            <span>{chartData.group_by}</span>
            <span>•</span>
            <span>{bars.length} groups</span>
            <span>•</span>
            <span>{bars.reduce((sum, bar) => sum + bar.n_chains, 0)} chains</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Click a bar to select all chains in that group. This is descriptive, not causal.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
            bias² {formatTotal(totals.totalBias)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
            variance {formatTotal(totals.totalVariance)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
            total {formatTotal(totals.totalError)}
          </span>
        </div>
      </div>

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <div className="min-h-0 flex-1 rounded-lg border border-border/60 bg-card/40 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bars} margin={{ top: 20, right: 20, left: 10, bottom: 44 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis
              dataKey="group_label"
              tick={{ fontSize: 10, fill: 'currentColor' }}
              angle={-25}
              textAnchor="end"
              height={56}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'currentColor' }}
              tickFormatter={value => formatTotal(Number(value))}
              label={{ value: 'Error', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
            />
            <RechartsTooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <Bar
              dataKey="bias_squared"
              stackId="error"
              fill="#3b82f6"
              name="Bias²"
              cursor="pointer"
              onClick={(_entry: unknown, index: number) => handleBarClick(bars[index])}
              opacity={hasSelection ? 0.95 : 1}
            >
              <LabelList
                dataKey="bias_squared"
                position="top"
                formatter={(value: number) => formatTotal(value)}
                style={{ fill: 'currentColor', fontSize: 10 }}
              />
            </Bar>
            <Bar
              dataKey="variance"
              stackId="error"
              fill="#f97316"
              name="Variance"
              cursor="pointer"
              onClick={(_entry: unknown, index: number) => handleBarClick(bars[index])}
            >
              <LabelList
                dataKey="variance"
                position="top"
                formatter={(value: number) => formatTotal(value)}
                style={{ fill: 'currentColor', fontSize: 10 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
          <MousePointerClick className="h-3 w-3" />
          {hasSelection ? `${selectedChains.size} selected` : 'No selection'}
        </span>
        <span>Needs the same sample to appear in multiple folds or repeated validation predictions.</span>
      </div>
    </div>
  );
}
