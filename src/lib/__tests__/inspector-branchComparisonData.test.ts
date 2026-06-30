import { describe, expect, it } from 'vitest';

import {
  buildBranchComparisonData,
  buildBranchComparisonLayout,
  buildBranchComparisonTicks,
  getBranchComparisonColor,
  getBranchComparisonGeometry,
  getBranchComparisonSelectableChainIds,
  scaleBranchComparisonX,
} from '@/lib/inspector/branchComparisonData';
import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { BranchComparisonEntry, BranchComparisonResponse } from '@/types/inspector';

function branch(overrides: Partial<BranchComparisonEntry> = {}): BranchComparisonEntry {
  return {
    branch_path: 'model.PLS',
    label: 'PLS',
    mean: 0.2,
    std: 0.05,
    min: 0.1,
    max: 0.4,
    ci_lower: 0.15,
    ci_upper: 0.25,
    count: 2,
    chain_ids: ['chain-a', 'chain-b'],
    ...overrides,
  };
}

function response(branches: BranchComparisonEntry[]): BranchComparisonResponse {
  return {
    branches,
    score_column: 'cv_val_score',
    total_chains: branches.reduce((sum, entry) => sum + entry.count, 0),
  };
}

describe('inspector branch comparison data helpers', () => {
  it('builds padded score domains from branch confidence intervals and extrema', () => {
    const data = buildBranchComparisonData(response([
      branch(),
      branch({
        branch_path: 'model.Ridge',
        label: 'Ridge',
        mean: -0.1,
        std: 0.03,
        min: -0.2,
        max: 0.05,
        ci_lower: -0.15,
        ci_upper: -0.05,
        count: 1,
        chain_ids: ['chain-c'],
      }),
    ]));

    expect(data.branches).toHaveLength(2);
    expect(data.xMin).toBeCloseTo(-0.23);
    expect(data.xMax).toBeCloseTo(0.43);
    expect(buildBranchComparisonData(null)).toEqual({ xMin: 0, xMax: 1, branches: [] });
  });

  it('computes chart layout, scales, ticks, and bar geometry', () => {
    const layout = buildBranchComparisonLayout({
      width: 600,
      height: 400,
      branchCount: 2,
      xMin: -0.23,
      xMax: 0.43,
    });

    expect(layout).toEqual({
      marginLeft: 120,
      marginRight: 20,
      marginTop: 15,
      marginBottom: 35,
      plotW: 460,
      plotH: 350,
      xRange: 0.66,
      barHeight: 28,
      barSpacing: 175,
    });
    expect(scaleBranchComparisonX(0, -0.23, layout)).toBeCloseTo(280.30303);
    const ticks = buildBranchComparisonTicks(-0.23, layout.xRange);
    expect(ticks).toHaveLength(6);
    expect(ticks[0]).toBeCloseTo(-0.23);
    expect(ticks[1]).toBeCloseTo(-0.098);
    expect(ticks[2]).toBeCloseTo(0.034);
    expect(ticks[3]).toBeCloseTo(0.166);
    expect(ticks[4]).toBeCloseTo(0.298);
    expect(ticks[5]).toBeCloseTo(0.43);

    const geometry = getBranchComparisonGeometry({
      branch: branch(),
      branchIndex: 0,
      xMin: -0.23,
      layout,
    });
    expect(geometry.cy).toBe(102.5);
    expect(geometry.xMean).toBeCloseTo(419.69697);
    expect(geometry.xCiLower).toBeCloseTo(384.84848);
    expect(geometry.xCiUpper).toBeCloseTo(454.54545);
    expect(geometry.xZero).toBeCloseTo(280.30303);
    expect(geometry.barLeft).toBeCloseTo(280.30303);
    expect(geometry.barRight).toBeCloseTo(419.69697);
    expect(geometry.barWidth).toBeCloseTo(139.39394);
    expect(geometry.barY).toBe(88.5);
    expect(geometry.countX).toBeCloseTo(462.54545);
  });

  it('keeps colors and selectable branch ids deterministic', () => {
    expect(getBranchComparisonColor(0)).toBe(INSPECTOR_GROUP_COLORS[0]);
    expect(getBranchComparisonColor(INSPECTOR_GROUP_COLORS.length)).toBe(INSPECTOR_GROUP_COLORS[0]);
    expect(getBranchComparisonSelectableChainIds(branch())).toEqual(['chain-a', 'chain-b']);
    expect(getBranchComparisonSelectableChainIds(undefined)).toEqual([]);
  });
});
