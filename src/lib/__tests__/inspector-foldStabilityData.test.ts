import { describe, expect, it } from 'vitest';

import {
  buildFoldStabilityBandPath,
  buildFoldStabilityChainColorMap,
  buildFoldStabilityLayout,
  buildFoldStabilityLineData,
  buildFoldStabilityLinePath,
  buildFoldStabilityMeanBand,
  buildFoldStabilityMeanPath,
  buildFoldStabilityXTicks,
  buildFoldStabilityYTicks,
  findFoldStabilityLine,
  getRenderableFoldStabilityLines,
  scaleFoldStabilityX,
  scaleFoldStabilityY,
  withFoldStabilityYRange,
} from '@/lib/inspector/foldStabilityData';
import type { FoldScoreEntry, FoldStabilityResponse, InspectorGroup } from '@/types/inspector';

function entry(overrides: Partial<FoldScoreEntry> = {}): FoldScoreEntry {
  return {
    chain_id: 'chain-a',
    model_class: 'PLS',
    preprocessings: 'SNV',
    fold_id: '0',
    fold_index: 0,
    score: 0.2,
    ...overrides,
  };
}

function response(entries: FoldScoreEntry[]): FoldStabilityResponse {
  return {
    entries,
    fold_ids: ['0', '1', '2'],
    score_column: 'cv_val_score',
    total_chains: 2,
  };
}

describe('inspector fold stability data helpers', () => {
  it('builds chain color maps and sorted line data with padded y-domain', () => {
    const groups: InspectorGroup[] = [{
      id: 'group-a',
      label: 'Group A',
      color: '#123456',
      chain_ids: ['chain-a'],
    }];
    const colorMap = buildFoldStabilityChainColorMap(groups);
    expect(colorMap.get('chain-a')).toBe('#123456');

    const lineData = buildFoldStabilityLineData(response([
      entry({ chain_id: 'chain-a', fold_index: 1, score: 0.4 }),
      entry({ chain_id: 'chain-a', fold_index: 0, score: 0.2 }),
      entry({ chain_id: 'chain-b', model_class: 'Ridge', fold_index: 0, score: 0.3 }),
      entry({ chain_id: 'chain-b', model_class: 'Ridge', fold_index: 1, score: 0.5 }),
    ]), colorMap);

    expect(lineData.foldCount).toBe(3);
    expect(lineData.lines).toHaveLength(2);
    expect(lineData.lines[0]).toMatchObject({
      chainId: 'chain-a',
      color: '#123456',
      points: [
        { foldIndex: 0, score: 0.2 },
        { foldIndex: 1, score: 0.4 },
      ],
    });
    expect(lineData.yMin).toBeCloseTo(0.185);
    expect(lineData.yMax).toBeCloseTo(0.515);
  });

  it('computes renderable lines and mean/std band per fold', () => {
    const { lines } = buildFoldStabilityLineData(response([
      entry({ chain_id: 'chain-a', fold_index: 0, score: 0.2 }),
      entry({ chain_id: 'chain-a', fold_index: 1, score: 0.4 }),
      entry({ chain_id: 'chain-b', model_class: 'Ridge', fold_index: 0, score: 0.4 }),
      entry({ chain_id: 'chain-b', model_class: 'Ridge', fold_index: 1, score: 0.6 }),
      entry({ chain_id: 'single', model_class: 'Lasso', fold_index: 0, score: 0.1 }),
    ]), new Map());

    expect(getRenderableFoldStabilityLines(lines).map((line) => line.chainId)).toEqual(['chain-a', 'chain-b']);
    const band = buildFoldStabilityMeanBand(lines);
    expect(band).toHaveLength(2);
    expect(band?.[0].foldIndex).toBe(0);
    expect(band?.[0].mean).toBeCloseTo(0.23333333333333336);
    expect(band?.[0].upper).toBeCloseTo(0.3580552462257981);
    expect(band?.[0].lower).toBeCloseTo(0.10861142044086863);
    expect(band?.[1]).toEqual({ foldIndex: 1, mean: 0.5, upper: 0.6, lower: 0.4 });
    expect(buildFoldStabilityMeanBand(lines.slice(0, 1))).toBeNull();
  });

  it('builds layout scales, ticks, and SVG paths', () => {
    const layout = withFoldStabilityYRange(buildFoldStabilityLayout(600, 400), 0.1, 0.6);
    expect(layout).toMatchObject({
      marginLeft: 55,
      marginRight: 15,
      marginTop: 15,
      marginBottom: 35,
      plotW: 530,
      plotH: 350,
      yRange: 0.5,
    });
    expect(scaleFoldStabilityX(1, 3, layout)).toBe(320);
    expect(scaleFoldStabilityY(0.35, 0.1, layout)).toBeCloseTo(190);
    expect(buildFoldStabilityYTicks(0.1, 0.5, 5)).toEqual([0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6]);
    expect(buildFoldStabilityXTicks(3)).toEqual([0, 1, 2]);

    const points = [
      { foldIndex: 0, score: 0.2 },
      { foldIndex: 1, score: 0.4 },
    ];
    expect(buildFoldStabilityLinePath(points, { foldCount: 3, yMin: 0.1, layout }))
      .toBe('M 55,295 L 320,154.99999999999997');

    const band = [
      { foldIndex: 0, mean: 0.3, upper: 0.4, lower: 0.2 },
      { foldIndex: 1, mean: 0.5, upper: 0.6, lower: 0.4 },
    ];
    expect(buildFoldStabilityBandPath(band, { foldCount: 3, yMin: 0.1, layout }))
      .toBe('M 55,154.99999999999997 L 320,15 L 320,154.99999999999997 L 55,295 Z');
    expect(buildFoldStabilityMeanPath(band, { foldCount: 3, yMin: 0.1, layout }))
      .toBe('M 55,225 L 320,85');
  });

  it('finds hovered line data by chain id', () => {
    const { lines } = buildFoldStabilityLineData(response([
      entry({ chain_id: 'chain-a' }),
      entry({ chain_id: 'chain-a', fold_index: 1 }),
    ]), new Map());

    expect(findFoldStabilityLine(lines, 'chain-a')?.modelClass).toBe('PLS');
    expect(findFoldStabilityLine(lines, 'missing')).toBeUndefined();
    expect(findFoldStabilityLine(lines, null)).toBeUndefined();
  });
});
