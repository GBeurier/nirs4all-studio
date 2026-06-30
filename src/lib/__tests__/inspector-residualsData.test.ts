import { describe, expect, it } from 'vitest';

import {
  buildResidualCanvasPoints,
  buildResidualDots,
  buildResidualReferenceLines,
  createResidualXTickFormatter,
  createResidualYTickFormatter,
  getResidualPointStyle,
  getResidualSelectionMode,
} from '@/lib/inspector/residualsData';
import type { ScatterPoint, ScatterResponse } from '@/types/inspector';

function point(overrides: Partial<ScatterPoint> = {}): ScatterPoint {
  return {
    chain_id: 'chain-a',
    model_class: 'PLS',
    model_name: 'PLS',
    preprocessings: 'SNV',
    y_true: [1, 2],
    y_pred: [1.1, 1.8],
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

describe('inspector residual data helpers', () => {
  it('flattens predictions to residual dots and computes residual stats', () => {
    const data = buildResidualDots(response([
      point(),
      point({
        chain_id: 'chain-b',
        model_class: 'Ridge',
        y_true: [3, 4, 5],
        y_pred: [2.5, 4.5],
      }),
    ]));

    expect(data.dots).toEqual([
      { x: 1.1, y: 0.10000000000000009, yTrue: 1, chainId: 'chain-a', modelClass: 'PLS' },
      { x: 1.8, y: -0.19999999999999996, yTrue: 2, chainId: 'chain-a', modelClass: 'PLS' },
      { x: 2.5, y: -0.5, yTrue: 3, chainId: 'chain-b', modelClass: 'Ridge' },
      { x: 4.5, y: 0.5, yTrue: 4, chainId: 'chain-b', modelClass: 'Ridge' },
    ]);
    expect(data.meanResidual).toBeCloseTo(-0.025);
    expect(data.stdResidual).toBeCloseTo(0.3699662146737185);
    expect(buildResidualDots(null)).toEqual({ dots: [], meanResidual: 0, stdResidual: 0 });
  });

  it('builds tick formatters and reference/annotation payloads', () => {
    expect(createResidualXTickFormatter([{ x: 1 }, { x: 1.005 }])(1.00234)).toBe('1.0023');
    expect(createResidualXTickFormatter([{ x: 1 }, { x: 1.05 }])(1.0234)).toBe('1.023');
    expect(createResidualXTickFormatter([])(1.234)).toBe('1.23');
    expect(createResidualYTickFormatter(0)(0.123456)).toBe('0.1235');
    expect(createResidualYTickFormatter(0.2)(0.123456)).toBe('0.12');

    expect(buildResidualReferenceLines(0)).toEqual([
      { type: 'horizontal', value: 0, color: '#94a3b8', width: 1.5 },
    ]);
    expect(buildResidualReferenceLines(0.5)).toEqual([
      { type: 'horizontal', value: 0, color: '#94a3b8', width: 1.5 },
      { type: 'horizontal', value: 1, color: '#f59e0b', dash: [4, 4], width: 1 },
      { type: 'horizontal', value: -1, color: '#f59e0b', dash: [4, 4], width: 1 },
    ]);
  });

  it('builds canvas points, cell styles, and click modes', () => {
    const dots = [
      { x: 1.1, y: 0.1, yTrue: 1, chainId: 'chain-a', modelClass: 'PLS' },
      { x: 1.8, y: -0.2, yTrue: 2, chainId: 'chain-b', modelClass: 'Ridge' },
    ];
    const getChainColor = (chainId: string) => chainId === 'chain-a' ? '#123456' : '#654321';
    const getChainOpacity = (chainId: string) => chainId === 'chain-a' ? 0.8 : 0.25;

    expect(buildResidualCanvasPoints({
      dots,
      getChainColor,
      getChainOpacity,
      hoveredChain: 'chain-b',
      hasSelection: true,
      selectedChains: new Set(['chain-a']),
    })).toEqual([
      {
        x: 1.1,
        y: 0.1,
        color: '#123456',
        opacity: 0.8,
        radius: 4,
        chainId: 'chain-a',
        meta: { modelClass: 'PLS', yTrue: 1 },
      },
      {
        x: 1.8,
        y: -0.2,
        color: '#654321',
        opacity: 1,
        radius: 5,
        chainId: 'chain-b',
        meta: { modelClass: 'Ridge', yTrue: 2 },
      },
    ]);
    expect(getResidualPointStyle({
      dot: dots[0],
      getChainColor,
      getChainOpacity,
      hoveredChain: null,
      hasSelection: true,
      selectedChains: new Set(['chain-a']),
    })).toEqual({
      color: '#123456',
      opacity: 0.8,
      radius: 3,
      stroke: '#123456',
      strokeWidth: 1.5,
    });
    expect(getResidualSelectionMode({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe('add');
    expect(getResidualSelectionMode({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe('toggle');
    expect(getResidualSelectionMode({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe('toggle');
  });
});
