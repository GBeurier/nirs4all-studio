import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatConfusionMatrixNormalizedPercent } from '@/lib/inspector/confusionMatrixData';
import {
  getConfusionMatrixTooltipTitle,
  getConfusionMatrixTotalSamplesLabel,
} from '@/lib/inspector/confusionMatrixPresentation';

export interface ConfusionMatrixHoveredCell {
  true_label: string;
  pred_label: string;
  count: number;
  normalized: number | null;
  mouseX: number;
  mouseY: number;
}

interface ConfusionMatrixTooltipProps {
  hovered: ConfusionMatrixHoveredCell | null;
  totalSamples: number;
}

export function ConfusionMatrixTooltip({
  hovered,
  totalSamples,
}: ConfusionMatrixTooltipProps) {
  const { t } = useTranslation();

  if (!hovered) return null;

  return createPortal(
    <div
      className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 52 }}
    >
      <div className="font-medium">{getConfusionMatrixTooltipTitle(hovered.true_label, hovered.pred_label)}</div>
      <div>{t('inspector.charts.tooltip.count', { value: hovered.count })}</div>
      {hovered.normalized != null && <div>{t('inspector.charts.tooltip.normalized', { value: formatConfusionMatrixNormalizedPercent(hovered.normalized) })}</div>}
      <div className="mt-1 text-muted-foreground">{getConfusionMatrixTotalSamplesLabel(totalSamples, t)}</div>
    </div>,
    document.body,
  );
}
