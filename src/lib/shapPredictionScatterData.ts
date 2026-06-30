import type { ScatterData } from '@/types/shap';

export interface ShapPredictionScatterPoint {
  yTrue: number;
  yPred: number;
  sampleIdx: number;
  residual: number;
  absResidual: number;
}

export interface ShapPredictionScatterBounds {
  min: number;
  max: number;
}

export interface ShapPredictionScatterPointStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  radius: number;
}

export const SHAP_PREDICTION_SELECTED_COLOR = '#f59e0b';

export function buildShapPredictionScatterPoints(
  data: Pick<ScatterData, 'y_true' | 'y_pred' | 'sample_indices' | 'residuals'>,
): ShapPredictionScatterPoint[] {
  return data.y_true.map((yTrue, index) => {
    const residual = data.residuals[index];
    return {
      yTrue,
      yPred: data.y_pred[index],
      sampleIdx: data.sample_indices[index],
      residual,
      absResidual: Math.abs(residual),
    };
  });
}

export function getShapPredictionMaxAbsResidual(points: ShapPredictionScatterPoint[]): number {
  if (points.length === 0) return 1;
  return Math.max(...points.map((point) => point.absResidual), 1e-9);
}

export function getShapPredictionScatterBounds(points: ShapPredictionScatterPoint[]): ShapPredictionScatterBounds {
  if (points.length === 0) return { min: 0, max: 1 };
  const values = points.flatMap((point) => [point.yTrue, point.yPred]);
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

export function getShapPredictionPointColor(absResidual: number, maxAbsResidual: number, isSelected: boolean): string {
  if (isSelected) return SHAP_PREDICTION_SELECTED_COLOR;

  const ratio = absResidual / maxAbsResidual;
  if (ratio > 0.7) return '#ef4444';
  if (ratio > 0.4) return '#f97316';
  if (ratio > 0.2) return '#84cc16';
  return '#22c55e';
}

export function getShapPredictionPointStyle(
  absResidual: number,
  maxAbsResidual: number,
  isSelected: boolean,
): ShapPredictionScatterPointStyle {
  return {
    fill: getShapPredictionPointColor(absResidual, maxAbsResidual, isSelected),
    fillOpacity: isSelected ? 1 : 0.7,
    stroke: isSelected ? SHAP_PREDICTION_SELECTED_COLOR : 'none',
    strokeWidth: isSelected ? 2 : 0,
    radius: isSelected ? 5 : 3,
  };
}

export function toggleShapPredictionSelectedSample(selectedSamples: number[], sampleIndex: number): number[] {
  const next = new Set(selectedSamples);
  if (next.has(sampleIndex)) {
    next.delete(sampleIndex);
  } else {
    next.add(sampleIndex);
  }
  return Array.from(next).sort((left, right) => left - right);
}
