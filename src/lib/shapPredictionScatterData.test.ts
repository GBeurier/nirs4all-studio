import { describe, expect, it } from 'vitest';

import type { ScatterData } from '@/types/shap';
import {
  SHAP_PREDICTION_SELECTED_COLOR,
  buildShapPredictionScatterPoints,
  getShapPredictionMaxAbsResidual,
  getShapPredictionPointColor,
  getShapPredictionPointStyle,
  getShapPredictionScatterBounds,
  toggleShapPredictionSelectedSample,
} from './shapPredictionScatterData';

function scatterData(overrides: Partial<ScatterData> = {}): ScatterData {
  return {
    y_true: [1, 2, 3],
    y_pred: [1.2, 1.5, 3.9],
    sample_indices: [10, 11, 12],
    residuals: [0.2, -0.5, 0.9],
    ...overrides,
  };
}

describe('shapPredictionScatterData', () => {
  it('builds aligned prediction scatter points', () => {
    expect(buildShapPredictionScatterPoints(scatterData())).toEqual([
      { yTrue: 1, yPred: 1.2, sampleIdx: 10, residual: 0.2, absResidual: 0.2 },
      { yTrue: 2, yPred: 1.5, sampleIdx: 11, residual: -0.5, absResidual: 0.5 },
      { yTrue: 3, yPred: 3.9, sampleIdx: 12, residual: 0.9, absResidual: 0.9 },
    ]);
  });

  it('computes residual scale and y=x reference bounds', () => {
    const points = buildShapPredictionScatterPoints(scatterData());

    expect(getShapPredictionMaxAbsResidual([])).toBe(1);
    expect(getShapPredictionMaxAbsResidual(points)).toBe(0.9);
    expect(getShapPredictionMaxAbsResidual([{ ...points[0], absResidual: 0 }])).toBe(1e-9);
    expect(getShapPredictionScatterBounds([])).toEqual({ min: 0, max: 1 });
    expect(getShapPredictionScatterBounds(points)).toEqual({ min: 1, max: 3.9 });
  });

  it('maps residual ratios to existing point color buckets', () => {
    expect(getShapPredictionPointColor(0.8, 1, false)).toBe('#ef4444');
    expect(getShapPredictionPointColor(0.7, 1, false)).toBe('#f97316');
    expect(getShapPredictionPointColor(0.4, 1, false)).toBe('#84cc16');
    expect(getShapPredictionPointColor(0.2, 1, false)).toBe('#22c55e');
    expect(getShapPredictionPointColor(0.2, 1, true)).toBe(SHAP_PREDICTION_SELECTED_COLOR);
  });

  it('builds selected and unselected point styles', () => {
    expect(getShapPredictionPointStyle(0.8, 1, false)).toEqual({
      fill: '#ef4444',
      fillOpacity: 0.7,
      stroke: 'none',
      strokeWidth: 0,
      radius: 3,
    });
    expect(getShapPredictionPointStyle(0.1, 1, true)).toEqual({
      fill: SHAP_PREDICTION_SELECTED_COLOR,
      fillOpacity: 1,
      stroke: SHAP_PREDICTION_SELECTED_COLOR,
      strokeWidth: 2,
      radius: 5,
    });
  });

  it('toggles selected samples in stable ascending order', () => {
    expect(toggleShapPredictionSelectedSample([5, 1], 3)).toEqual([1, 3, 5]);
    expect(toggleShapPredictionSelectedSample([1, 3, 5], 3)).toEqual([1, 5]);
    expect(toggleShapPredictionSelectedSample([2, 2, 1], 2)).toEqual([1]);
  });
});
