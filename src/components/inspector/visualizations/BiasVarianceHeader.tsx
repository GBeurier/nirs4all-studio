import { formatBiasVarianceTotal } from '@/lib/inspector/biasVariancePresentation';
import type { BiasVarianceTotals } from '@/lib/inspector/biasVarianceData';

interface BiasVarianceHeaderProps {
  groupBy: string;
  groupCount: number;
  chainCount: number;
  totals: BiasVarianceTotals;
}

export function BiasVarianceHeader({
  groupBy,
  groupCount,
  chainCount,
  totals,
}: BiasVarianceHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Bias-variance decomposition</span>
          <span>{groupBy}</span>
          <span>•</span>
          <span>{groupCount} groups</span>
          <span>•</span>
          <span>{chainCount} chains</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Click a bar to select all chains in that group. This is descriptive, not causal.
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
          bias² {formatBiasVarianceTotal(totals.totalBias)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
          variance {formatBiasVarianceTotal(totals.totalVariance)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5">
          total {formatBiasVarianceTotal(totals.totalError)}
        </span>
      </div>
    </div>
  );
}
