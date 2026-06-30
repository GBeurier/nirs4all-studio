import {
  formatPredictionDiagnosticValue,
  formatStandardizedResidual,
} from '@/lib/inspector/predictionDiagnosticsPresentation';
import type { ResidualDot } from '@/lib/inspector/residualsData';
import type { CanvasScatterPoint } from './CanvasScatter';

interface ResidualsTooltipContentProps {
  modelClass: string;
  observed: number;
  predicted: number;
  residual: number;
  stdResidual: number;
}

function ResidualsTooltipContent({
  modelClass,
  observed,
  predicted,
  residual,
  stdResidual,
}: ResidualsTooltipContentProps) {
  const standardizedResidual = formatStandardizedResidual(residual, stdResidual);

  return (
    <div className="rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{modelClass}</div>
      <div>Observed: {formatPredictionDiagnosticValue(observed)}</div>
      <div>Predicted: {formatPredictionDiagnosticValue(predicted)}</div>
      <div>Residual: {formatPredictionDiagnosticValue(residual)}</div>
      {standardizedResidual && <div>Std. Residual: {standardizedResidual}</div>}
    </div>
  );
}

interface ResidualsTooltipPayloadEntry {
  payload?: ResidualDot;
}

interface ResidualsRechartsTooltipProps {
  payload?: ResidualsTooltipPayloadEntry[];
  stdResidual: number;
}

export function ResidualsRechartsTooltip({
  payload,
  stdResidual,
}: ResidualsRechartsTooltipProps) {
  const dot = payload?.[0]?.payload;
  if (!dot) {
    return null;
  }

  return (
    <ResidualsTooltipContent
      modelClass={dot.modelClass}
      observed={dot.yTrue}
      predicted={dot.x}
      residual={dot.y}
      stdResidual={stdResidual}
    />
  );
}

interface ResidualsCanvasTooltipProps {
  point: CanvasScatterPoint;
  stdResidual: number;
}

export function ResidualsCanvasTooltip({
  point,
  stdResidual,
}: ResidualsCanvasTooltipProps) {
  return (
    <ResidualsTooltipContent
      modelClass={String(point.meta?.modelClass ?? '')}
      observed={Number(point.meta?.yTrue ?? 0)}
      predicted={point.x}
      residual={point.y}
      stdResidual={stdResidual}
    />
  );
}
