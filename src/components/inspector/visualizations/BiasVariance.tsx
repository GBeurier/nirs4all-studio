import { useMemo } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import {
  buildBiasVarianceBars,
  getBiasVarianceSelectionMode,
  sumBiasVarianceTotals,
  type BiasVarianceBarData,
} from '@/lib/inspector/biasVarianceData';
import { getBiasVarianceEmptyDescription } from '@/lib/inspector/biasVariancePresentation';
import type { BiasVarianceResponse } from '@/types/inspector';
import { BiasVarianceBarChart } from './BiasVarianceBarChart';
import { BiasVarianceFooter } from './BiasVarianceFooter';
import { BiasVarianceHeader } from './BiasVarianceHeader';
import { BiasVarianceStateCard } from './BiasVarianceStateCard';

interface BiasVarianceProps {
  data: BiasVarianceResponse | null | undefined;
  isLoading: boolean;
}

export function BiasVariance({ data, isLoading }: BiasVarianceProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const chartData = data;
  const reason = chartData?.reason?.trim() || null;

  const bars = useMemo(() => buildBiasVarianceBars(chartData), [chartData]);
  const totals = useMemo(() => sumBiasVarianceTotals(bars), [bars]);
  const chainCount = useMemo(() => bars.reduce((sum, bar) => sum + bar.n_chains, 0), [bars]);

  const handleBarClick = (bar: BiasVarianceBarData | undefined) => {
    const mode = getBiasVarianceSelectionMode(bar, selectedChains);
    if (!bar || !mode) return;
    select(bar.chain_ids, mode);
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
      <BiasVarianceStateCard
        icon={AlertCircle}
        title="No bias-variance signal"
        description={getBiasVarianceEmptyDescription(reason)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <BiasVarianceHeader
        groupBy={chartData.group_by}
        groupCount={bars.length}
        chainCount={chainCount}
        totals={totals}
      />

      {reason && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {reason}
        </div>
      )}

      <BiasVarianceBarChart
        bars={bars}
        hasSelection={hasSelection}
        onBarClick={handleBarClick}
      />

      <BiasVarianceFooter
        hasSelection={hasSelection}
        selectedCount={selectedChains.size}
      />
    </div>
  );
}
