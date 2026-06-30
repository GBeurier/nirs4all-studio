import { describe, expect, it } from 'vitest';

import {
  buildPredVsObsCanvasPoints,
  buildPredVsObsCanvasReferenceLines,
  buildPredVsObsChainColorMap,
  buildPredVsObsDots,
  computePredVsObsMetrics,
  createPredVsObsTickFormatter,
  getPredVsObsSelectionMode,
  PRED_VS_OBS_FALLBACK_COLOR,
} from '@/lib/inspector/predVsObsData';
import type { InspectorGroup, ScatterPoint, ScatterResponse } from '@/types/inspector';

function point(overrides: Partial<ScatterPoint> = {}): ScatterPoint {
  return {
    chain_id: 'chain-a',
    model_class: 'PLS',
    model_name: 'PLS',
    preprocessings: 'SNV',
    y_true: [1, 2],
    y_pred: [1.1, 1.9],
    sample_indices: [0, 1],
    fold_id: '0',
    score: 0.1,
    ...overrides,
  };
}

function response(points: ScatterPoint[]): ScatterResponse {
  return {
    points,
    partition: 'test',
    total_samples: points.reduce((sum, entry) => sum + entry.y_true.length, 0),
  };
}

describe('inspector predicted-vs-observed data helpers', () => {
  it('builds chain color maps and flattens scatter points with padded common domain', () => {
    const groups: InspectorGroup[] = [{
      id: 'group-a',
      label: 'Group A',
      color: '#123456',
      chain_ids: ['chain-a'],
    }];
    const colorMap = buildPredVsObsChainColorMap(groups);
    expect(colorMap.get('chain-a')).toBe('#123456');

    const data = buildPredVsObsDots(response([
      point(),
      point({
        chain_id: 'chain-b',
        model_class: 'Ridge',
        y_true: [3, 4, 5],
        y_pred: [2.5, 4.5],
      }),
    ]), colorMap);

    expect(data.dots).toEqual([
      { x: 1, y: 1.1, chainId: 'chain-a', modelClass: 'PLS', color: '#123456' },
      { x: 2, y: 1.9, chainId: 'chain-a', modelClass: 'PLS', color: '#123456' },
      { x: 3, y: 2.5, chainId: 'chain-b', modelClass: 'Ridge', color: PRED_VS_OBS_FALLBACK_COLOR },
      { x: 4, y: 4.5, chainId: 'chain-b', modelClass: 'Ridge', color: PRED_VS_OBS_FALLBACK_COLOR },
    ]);
    expect(data.minVal).toBeCloseTo(0.825);
    expect(data.maxVal).toBeCloseTo(4.675);
  });

  it('computes R2/RMSE metrics and tick precision', () => {
    const metrics = computePredVsObsMetrics([
      { x: 1, y: 1 },
      { x: 2, y: 2.5 },
      { x: 3, y: 2.5 },
    ]);

    expect(metrics.r2).toBeCloseTo(0.75);
    expect(metrics.rmse).toBeCloseTo(Math.sqrt(0.5 / 3));
    expect(computePredVsObsMetrics([])).toEqual({ r2: null, rmse: null });
    expect(createPredVsObsTickFormatter(0, 1000)(12.345)).toBe('12.3');
    expect(createPredVsObsTickFormatter(0, 0.05)(0.012345)).toBe('0.01');
    expect(createPredVsObsTickFormatter(1, 1)(1.2345)).toBe('1.23');
  });

  it('builds canvas projections, annotations, reference lines, and click modes', () => {
    const dots = [
      { x: 1, y: 1.1, chainId: 'chain-a', modelClass: 'PLS', color: '#123456' },
      { x: 2, y: 1.9, chainId: 'chain-b', modelClass: 'Ridge', color: '#654321' },
    ];

    expect(buildPredVsObsCanvasPoints({
      dots,
      hasSelection: true,
      selectedChains: new Set(['chain-a']),
      hoveredChain: 'chain-b',
    })).toEqual([
      {
        x: 1,
        y: 1.1,
        color: '#123456',
        opacity: 0.7,
        radius: 4,
        chainId: 'chain-a',
        meta: { modelClass: 'PLS' },
      },
      {
        x: 2,
        y: 1.9,
        color: '#654321',
        opacity: 0.15,
        radius: 5,
        chainId: 'chain-b',
        meta: { modelClass: 'Ridge' },
      },
    ]);
    expect(buildPredVsObsCanvasReferenceLines()).toEqual([{
      type: 'y-equals-x',
      color: '#94a3b8',
      dash: [4, 4],
      width: 1,
    }]);
    expect(getPredVsObsSelectionMode({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('add');
    expect(getPredVsObsSelectionMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle');
    expect(getPredVsObsSelectionMode({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('toggle');
  });
});
