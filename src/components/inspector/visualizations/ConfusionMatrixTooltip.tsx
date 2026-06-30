import { createPortal } from 'react-dom';
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
  if (!hovered) return null;

  return createPortal(
    <div
      className="fixed z-50 pointer-events-none rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 52 }}
    >
      <div className="font-medium">{getConfusionMatrixTooltipTitle(hovered.true_label, hovered.pred_label)}</div>
      <div>Count: {hovered.count}</div>
      {hovered.normalized != null && <div>Normalized: {formatConfusionMatrixNormalizedPercent(hovered.normalized)}</div>}
      <div className="mt-1 text-muted-foreground">{getConfusionMatrixTotalSamplesLabel(totalSamples)}</div>
    </div>,
    document.body,
  );
}
