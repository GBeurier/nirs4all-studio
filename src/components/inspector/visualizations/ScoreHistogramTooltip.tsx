import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const bar = payload?.[0]?.payload;
  if (!bar) {
    return null;
  }

  const tooltip = buildScoreHistogramTooltipData(bar, totalChains, t);

  return (
    <div className="rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div>{t('inspector.charts.tooltip.range', { value: tooltip.rangeLabel })}</div>
      <div>{t('inspector.charts.tooltip.count', { value: tooltip.countLabel })}</div>
      <div>{tooltip.percentageLabel}</div>
    </div>
  );
}
