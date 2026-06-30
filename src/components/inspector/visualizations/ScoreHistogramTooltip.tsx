import { buildScoreHistogramTooltipData } from '@/lib/inspector/scoreHistogramPresentation';
import type { ScoreHistogramBarData } from '@/lib/inspector/scoreHistogramData';

interface ScoreHistogramTooltipPayloadEntry {
  payload?: ScoreHistogramBarData;
}

interface ScoreHistogramTooltipProps {
  payload?: ScoreHistogramTooltipPayloadEntry[];
  totalChains: number | null | undefined;
}

export function ScoreHistogramTooltip({
  payload,
  totalChains,
}: ScoreHistogramTooltipProps) {
  const bar = payload?.[0]?.payload;
  if (!bar) {
    return null;
  }

  const tooltip = buildScoreHistogramTooltipData(bar, totalChains);

  return (
    <div className="rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div>Range: {tooltip.rangeLabel}</div>
      <div>Count: {tooltip.countLabel}</div>
      <div>{tooltip.percentageLabel}</div>
    </div>
  );
}
