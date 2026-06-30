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
      <div>Min: {formatCandlestickScore(category.min)}</div>
      <div>Q25: {formatCandlestickScore(category.q25)}</div>
      <div>Median: {formatCandlestickScore(category.median)}</div>
      <div>Mean: {formatCandlestickScore(category.mean)}</div>
      <div>Q75: {formatCandlestickScore(category.q75)}</div>
      <div>Max: {formatCandlestickScore(category.max)}</div>
      <div>IQR: {formatCandlestickIqr(category.q25, category.q75)}</div>
      <div>{formatCandlestickCount(category.count)}</div>
    </div>
  );
}
