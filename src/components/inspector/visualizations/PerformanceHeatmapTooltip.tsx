import { useTranslation } from 'react-i18next';
import { formatPerformanceHeatmapTooltipValue } from '@/lib/inspector/performanceHeatmapPresentation';
import type { PerformanceHeatmapHoverPayload } from '@/lib/inspector/performanceHeatmapData';

export type PerformanceHeatmapHoveredCell = PerformanceHeatmapHoverPayload & {
  mouseX: number;
  mouseY: number;
};

interface PerformanceHeatmapTooltipProps {
  hovered: PerformanceHeatmapHoveredCell | null;
  xVariable: string;
  yVariable: string;
}

export function PerformanceHeatmapTooltip({
  hovered,
  xVariable,
  yVariable,
}: PerformanceHeatmapTooltipProps) {
  const { t } = useTranslation();

  if (!hovered) {
    return null;
  }

  return (
    <div
      className="fixed z-50 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md pointer-events-none"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 40 }}
    >
      <div className="font-medium">{xVariable}: {hovered.x_label}</div>
      <div>{yVariable}: {hovered.y_label}</div>
      <div>{t('inspector.charts.tooltip.score', { value: formatPerformanceHeatmapTooltipValue(hovered.value, t) })}</div>
      <div>{t('inspector.charts.tooltip.chains', { value: hovered.count })}</div>
    </div>
  );
}
