import { useTranslation } from 'react-i18next';
import {
  formatCandlestickCount,
  formatCandlestickIqr,
  formatCandlestickScore,
} from '@/lib/inspector/candlestickPresentation';
import type { CandlestickCategory } from '@/types/inspector';

export interface CandlestickHoveredBox {
  category: CandlestickCategory;
  mouseX: number;
  mouseY: number;
}

interface CandlestickTooltipProps {
  hovered: CandlestickHoveredBox | null;
}

export function CandlestickTooltip({ hovered }: CandlestickTooltipProps) {
  const { t } = useTranslation();

  if (!hovered) {
    return null;
  }

  const { category } = hovered;

  return (
    <div
      className="fixed z-50 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md pointer-events-none"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 60 }}
    >
      <div className="font-medium">{category.label}</div>
      <div>{t('inspector.charts.tooltip.min', { value: formatCandlestickScore(category.min) })}</div>
      <div>Q25: {formatCandlestickScore(category.q25)}</div>
      <div>{t('inspector.charts.tooltip.median', { value: formatCandlestickScore(category.median) })}</div>
      <div>{t('inspector.charts.tooltip.mean', { value: formatCandlestickScore(category.mean) })}</div>
      <div>Q75: {formatCandlestickScore(category.q75)}</div>
      <div>{t('inspector.charts.tooltip.max', { value: formatCandlestickScore(category.max) })}</div>
      <div>{t('inspector.charts.tooltip.iqr', { value: formatCandlestickIqr(category.q25, category.q75) })}</div>
      <div>{formatCandlestickCount(category.count)}</div>
    </div>
  );
}
