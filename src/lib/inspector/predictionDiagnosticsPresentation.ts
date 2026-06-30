import type { CanvasAnnotation } from '@/lib/inspector/canvasScatterData';
import type { PredVsObsMetrics } from '@/lib/inspector/predVsObsData';
import type { ResidualStats } from '@/lib/inspector/residualsData';

export const PREDICTION_DIAGNOSTICS_EMPTY_MESSAGE = 'No prediction data available. Select chains to visualize.';

export function getPredictionDiagnosticsEmptyMessage(): string {
  return PREDICTION_DIAGNOSTICS_EMPTY_MESSAGE;
}

export function formatPredictionDiagnosticValue(value: number): string {
  return value.toFixed(4);
}

export function formatPredictionDiagnosticResidual({
  observed,
  predicted,
}: {
  observed: number;
  predicted: number;
}): string {
  return formatPredictionDiagnosticValue(predicted - observed);
}

export function formatPredVsObsSummary({
  r2,
  rmse,
  pointCount,
}: PredVsObsMetrics & { pointCount: number }): string | null {
  if (r2 === null || rmse === null) return null;
  return `R² = ${formatPredictionDiagnosticValue(r2)} | RMSE = ${formatPredictionDiagnosticValue(rmse)} | n = ${pointCount}`;
}

export function buildPredVsObsCanvasAnnotations(
  metrics: PredVsObsMetrics,
  pointCount: number,
): CanvasAnnotation[] {
  const summary = formatPredVsObsSummary({ ...metrics, pointCount });
  return summary ? [{ text: summary, position: 'top-left' }] : [];
}

export function formatResidualSummary({
  meanResidual,
  stdResidual,
  pointCount,
}: ResidualStats & { pointCount: number }): string {
  return `Mean = ${formatPredictionDiagnosticValue(meanResidual)} | Std = ${formatPredictionDiagnosticValue(stdResidual)} | n = ${pointCount}`;
}

export function buildResidualCanvasAnnotations({
  meanResidual,
  stdResidual,
  pointCount,
}: ResidualStats & { pointCount: number }): CanvasAnnotation[] {
  return [{
    text: formatResidualSummary({ meanResidual, stdResidual, pointCount }),
    position: 'top-left',
  }];
}

export function formatStandardizedResidual(residual: number, stdResidual: number): string | null {
  return stdResidual > 0 ? `${(residual / stdResidual).toFixed(2)}σ` : null;
}
