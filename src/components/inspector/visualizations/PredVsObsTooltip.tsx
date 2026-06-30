import {
  formatPredictionDiagnosticResidual,
  formatPredictionDiagnosticValue,
} from '@/lib/inspector/predictionDiagnosticsPresentation';
import type { PredVsObsDot } from '@/lib/inspector/predVsObsData';
import type { CanvasScatterPoint } from './CanvasScatter';

interface PredVsObsTooltipContentProps {
  modelClass: string;
  observed: number;
  predicted: number;
}

function PredVsObsTooltipContent({
  modelClass,
  observed,
  predicted,
}: PredVsObsTooltipContentProps) {
  return (
    <div className="rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{modelClass}</div>
      <div>Observed: {formatPredictionDiagnosticValue(observed)}</div>
      <div>Predicted: {formatPredictionDiagnosticValue(predicted)}</div>
      <div>Residual: {formatPredictionDiagnosticResidual({ observed, predicted })}</div>
    </div>
  );
}

interface PredVsObsTooltipPayloadEntry {
  payload?: PredVsObsDot;
}

interface PredVsObsRechartsTooltipProps {
  payload?: PredVsObsTooltipPayloadEntry[];
}

export function PredVsObsRechartsTooltip({ payload }: PredVsObsRechartsTooltipProps) {
  const dot = payload?.[0]?.payload;
  if (!dot) {
    return null;
  }

  return (
    <PredVsObsTooltipContent
      modelClass={dot.modelClass}
      observed={dot.x}
      predicted={dot.y}
    />
  );
}

interface PredVsObsCanvasTooltipProps {
  point: CanvasScatterPoint;
}

export function PredVsObsCanvasTooltip({ point }: PredVsObsCanvasTooltipProps) {
  return (
    <PredVsObsTooltipContent
      modelClass={String(point.meta?.modelClass ?? '')}
      observed={point.x}
      predicted={point.y}
    />
  );
}
