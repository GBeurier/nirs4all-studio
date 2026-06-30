import { ArrowDownRight, ArrowUpRight, MousePointerClick } from 'lucide-react';
import type { HyperparameterTrend } from '@/lib/inspector/hyperparameterSensitivityData';
import {
  formatHyperparameterTrendCorrelation,
  formatHyperparameterTrendSlope,
  getHyperparameterSelectionSummary,
} from '@/lib/inspector/hyperparameterSensitivityPresentation';

interface HyperparameterTrendSummaryProps {
  trend: HyperparameterTrend;
  hasSelection: boolean;
  selectedCount: number;
}

export function HyperparameterTrendSummary({
  trend,
  hasSelection,
  selectedCount,
}: HyperparameterTrendSummaryProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
        <ArrowUpRight className="h-3 w-3" />
        {formatHyperparameterTrendSlope(trend)}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
        <ArrowDownRight className="h-3 w-3" />
        {formatHyperparameterTrendCorrelation(trend)}
      </span>
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
        <MousePointerClick className="h-3 w-3" />
        {getHyperparameterSelectionSummary(hasSelection, selectedCount)}
      </span>
    </div>
  );
}
