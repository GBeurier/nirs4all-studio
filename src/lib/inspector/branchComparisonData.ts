import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { BranchComparisonEntry, BranchComparisonResponse } from '@/types/inspector';

export interface BranchComparisonData {
  branches: BranchComparisonEntry[];
  xMin: number;
  xMax: number;
}

export interface BranchComparisonLayout {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  plotW: number;
  plotH: number;
  xRange: number;
  barHeight: number;
  barSpacing: number;
}

export interface BranchComparisonBarGeometry {
  cy: number;
  xMean: number;
  xCiLower: number;
  xCiUpper: number;
  xZero: number;
  barLeft: number;
  barRight: number;
  barWidth: number;
  barY: number;
  countX: number;
}

export function buildBranchComparisonData(
  data: BranchComparisonResponse | null | undefined,
): BranchComparisonData {
  if (!data?.branches?.length) return { xMin: 0, xMax: 1, branches: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const branch of data.branches) {
    if (branch.ci_lower < min) min = branch.ci_lower;
    if (branch.min < min) min = branch.min;
    if (branch.ci_upper > max) max = branch.ci_upper;
    if (branch.max > max) max = branch.max;
  }
  const range = max - min || 1;
  return {
    xMin: min - range * 0.05,
    xMax: max + range * 0.05,
    branches: data.branches,
  };
}

export function buildBranchComparisonLayout({
  width,
  height,
  branchCount,
  xMin,
  xMax,
}: {
  width: number;
  height: number;
  branchCount: number;
  xMin: number;
  xMax: number;
}): BranchComparisonLayout {
  const marginLeft = 120;
  const marginRight = 20;
  const marginTop = 15;
  const marginBottom = 35;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  const xRange = xMax - xMin || 1;
  const safeBranchCount = Math.max(branchCount, 1);
  const barSpacing = plotH / safeBranchCount;
  return {
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    plotW,
    plotH,
    xRange,
    barHeight: Math.min(barSpacing * 0.6, 28),
    barSpacing,
  };
}

export function scaleBranchComparisonX(
  value: number,
  xMin: number,
  layout: BranchComparisonLayout,
): number {
  return layout.marginLeft + ((value - xMin) / layout.xRange) * layout.plotW;
}

export function buildBranchComparisonTicks(
  xMin: number,
  xRange: number,
  count = 5,
): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index++) {
    ticks.push(xMin + (xRange * index) / count);
  }
  return ticks;
}

export function getBranchComparisonColor(index: number): string {
  return INSPECTOR_GROUP_COLORS[index % INSPECTOR_GROUP_COLORS.length];
}

export function getBranchComparisonGeometry({
  branch,
  branchIndex,
  xMin,
  layout,
}: {
  branch: Pick<BranchComparisonEntry, 'mean' | 'ci_lower' | 'ci_upper'>;
  branchIndex: number;
  xMin: number;
  layout: BranchComparisonLayout;
}): BranchComparisonBarGeometry {
  const cy = layout.marginTop + branchIndex * layout.barSpacing + layout.barSpacing / 2;
  const xMean = scaleBranchComparisonX(branch.mean, xMin, layout);
  const xCiLower = scaleBranchComparisonX(branch.ci_lower, xMin, layout);
  const xCiUpper = scaleBranchComparisonX(branch.ci_upper, xMin, layout);
  const xZero = scaleBranchComparisonX(Math.max(xMin, 0), xMin, layout);
  const barLeft = Math.min(xZero, xMean);
  const barRight = Math.max(xZero, xMean);
  return {
    cy,
    xMean,
    xCiLower,
    xCiUpper,
    xZero,
    barLeft,
    barRight,
    barWidth: Math.max(barRight - barLeft, 2),
    barY: cy - layout.barHeight / 2,
    countX: Math.max(xMean, xCiUpper) + 8,
  };
}

export function getBranchComparisonSelectableChainIds(
  branch: Pick<BranchComparisonEntry, 'chain_ids'> | undefined,
): string[] {
  return branch?.chain_ids ?? [];
}
