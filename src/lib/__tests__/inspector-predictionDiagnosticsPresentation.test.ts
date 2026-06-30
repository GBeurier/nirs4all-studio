import { describe, expect, it } from 'vitest';

import {
  buildPredVsObsCanvasAnnotations,
  buildResidualCanvasAnnotations,
  formatPredictionDiagnosticResidual,
  formatPredictionDiagnosticValue,
  formatPredVsObsSummary,
  formatResidualSummary,
  formatStandardizedResidual,
  getPredictionDiagnosticsEmptyMessage,
} from '@/lib/inspector/predictionDiagnosticsPresentation';

describe('inspector prediction diagnostics presentation helpers', () => {
  it('formats shared prediction diagnostic copy and values', () => {
    expect(getPredictionDiagnosticsEmptyMessage()).toBe('No prediction data available. Select chains to visualize.');
    expect(formatPredictionDiagnosticValue(0.123456)).toBe('0.1235');
    expect(formatPredictionDiagnosticResidual({ observed: 1, predicted: 1.23456 })).toBe('0.2346');
    expect(formatStandardizedResidual(0.5, 0.25)).toBe('2.00σ');
    expect(formatStandardizedResidual(0.5, 0)).toBeNull();
  });

  it('builds predicted-vs-observed summary and canvas annotation copy', () => {
    expect(formatPredVsObsSummary({ r2: 0.9, rmse: 0.12, pointCount: 2 })).toBe('R² = 0.9000 | RMSE = 0.1200 | n = 2');
    expect(formatPredVsObsSummary({ r2: null, rmse: 0.12, pointCount: 2 })).toBeNull();
    expect(buildPredVsObsCanvasAnnotations({ r2: 0.9, rmse: 0.12 }, 2)).toEqual([{
      text: 'R² = 0.9000 | RMSE = 0.1200 | n = 2',
      position: 'top-left',
    }]);
    expect(buildPredVsObsCanvasAnnotations({ r2: null, rmse: 0.12 }, 2)).toEqual([]);
  });

  it('builds residual summary and canvas annotation copy', () => {
    expect(formatResidualSummary({
      meanResidual: -0.025,
      stdResidual: 0.3774,
      pointCount: 4,
    })).toBe('Mean = -0.0250 | Std = 0.3774 | n = 4');
    expect(buildResidualCanvasAnnotations({
      meanResidual: -0.025,
      stdResidual: 0.3774,
      pointCount: 4,
    })).toEqual([{
      text: 'Mean = -0.0250 | Std = 0.3774 | n = 4',
      position: 'top-left',
    }]);
  });
});
