import { INSPECTOR_GROUP_COLORS } from '@/types/inspector';
import type { FoldStabilityResponse, InspectorGroup } from '@/types/inspector';

export interface FoldStabilityPoint {
  foldIndex: number;
  score: number;
}

export interface FoldStabilityLine {
  chainId: string;
  modelClass: string;
  preprocessings: string | null;
  color: string;
  points: FoldStabilityPoint[];
}

export interface FoldStabilityBandPoint {
  foldIndex: number;
  mean: number;
  upper: number;
  lower: number;
}

export interface FoldStabilityLineData {
  lines: FoldStabilityLine[];
  yMin: number;
  yMax: number;
  foldCount: number;
}

export interface FoldStabilityLayout {
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  plotW: number;
  plotH: number;
  yRange: number;
}

export function buildFoldStabilityChainColorMap(
  groups: readonly InspectorGroup[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const chainId of group.chain_ids) {
      map.set(chainId, group.color);
    }
  }
  return map;
}

export function buildFoldStabilityLineData(
  data: FoldStabilityResponse | null | undefined,
  chainColorMap: ReadonlyMap<string, string>,
): FoldStabilityLineData {
  if (!data?.entries?.length) {
    return { lines: [], yMin: 0, yMax: 1, foldCount: 0 };
  }

  const chainMap = new Map<string, FoldStabilityLine>();
  let min = Infinity;
  let max = -Infinity;

  for (const entry of data.entries) {
    let line = chainMap.get(entry.chain_id);
    if (!line) {
      const color = chainColorMap.get(entry.chain_id)
        ?? INSPECTOR_GROUP_COLORS[chainMap.size % INSPECTOR_GROUP_COLORS.length];
      line = {
        chainId: entry.chain_id,
        modelClass: entry.model_class,
        preprocessings: entry.preprocessings,
        color,
        points: [],
      };
      chainMap.set(entry.chain_id, line);
    }
    line.points.push({ foldIndex: entry.fold_index, score: entry.score });
    if (entry.score < min) min = entry.score;
    if (entry.score > max) max = entry.score;
  }

  for (const line of chainMap.values()) {
    line.points.sort((left, right) => left.foldIndex - right.foldIndex);
  }

  const range = max - min || 1;
  return {
    lines: Array.from(chainMap.values()),
    yMin: min - range * 0.05,
    yMax: max + range * 0.05,
    foldCount: data.fold_ids.length,
  };
}

export function buildFoldStabilityMeanBand(
  lines: readonly FoldStabilityLine[],
): FoldStabilityBandPoint[] | null {
  if (lines.length < 2) return null;
  const foldScores = new Map<number, number[]>();
  for (const line of lines) {
    for (const point of line.points) {
      const scores = foldScores.get(point.foldIndex) ?? [];
      scores.push(point.score);
      foldScores.set(point.foldIndex, scores);
    }
  }

  const band: FoldStabilityBandPoint[] = [];
  for (const [foldIndex, scores] of foldScores) {
    const n = scores.length;
    const mean = scores.reduce((sum, score) => sum + score, 0) / n;
    const variance = scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);
    band.push({ foldIndex, mean, upper: mean + std, lower: mean - std });
  }
  band.sort((left, right) => left.foldIndex - right.foldIndex);
  return band;
}

export function getRenderableFoldStabilityLines(
  lines: readonly FoldStabilityLine[],
): FoldStabilityLine[] {
  return lines.filter((line) => line.points.length >= 2);
}

export function buildFoldStabilityLayout(
  width: number,
  height: number,
): FoldStabilityLayout {
  const marginLeft = 55;
  const marginRight = 15;
  const marginTop = 15;
  const marginBottom = 35;
  const plotW = width - marginLeft - marginRight;
  const plotH = height - marginTop - marginBottom;
  return {
    marginLeft,
    marginRight,
    marginTop,
    marginBottom,
    plotW,
    plotH,
    yRange: 1,
  };
}

export function withFoldStabilityYRange(
  layout: FoldStabilityLayout,
  yMin: number,
  yMax: number,
): FoldStabilityLayout {
  return {
    ...layout,
    yRange: yMax - yMin || 1,
  };
}

export function scaleFoldStabilityX(
  foldIndex: number,
  foldCount: number,
  layout: FoldStabilityLayout,
): number {
  const maxIndex = Math.max(foldCount - 1, 1);
  return layout.marginLeft + (foldIndex / maxIndex) * layout.plotW;
}

export function scaleFoldStabilityY(
  value: number,
  yMin: number,
  layout: FoldStabilityLayout,
): number {
  return layout.marginTop + layout.plotH - ((value - yMin) / layout.yRange) * layout.plotH;
}

export function buildFoldStabilityYTicks(yMin: number, yRange: number, count = 5): number[] {
  const ticks: number[] = [];
  for (let index = 0; index <= count; index++) {
    ticks.push(yMin + (yRange * index) / count);
  }
  return ticks;
}

export function buildFoldStabilityXTicks(foldCount: number): number[] {
  return Array.from({ length: foldCount }, (_, index) => index);
}

export function buildFoldStabilityLinePath(
  points: readonly FoldStabilityPoint[],
  {
    foldCount,
    yMin,
    layout,
  }: {
    foldCount: number;
    yMin: number;
    layout: FoldStabilityLayout;
  },
): string {
  return `M ${points
    .map((point) => `${scaleFoldStabilityX(point.foldIndex, foldCount, layout)},${scaleFoldStabilityY(point.score, yMin, layout)}`)
    .join(' L ')}`;
}

export function buildFoldStabilityBandPath(
  band: readonly FoldStabilityBandPoint[] | null,
  {
    foldCount,
    yMin,
    layout,
  }: {
    foldCount: number;
    yMin: number;
    layout: FoldStabilityLayout;
  },
): string | null {
  if (!band || band.length <= 1) return null;
  const upper = band
    .map((point) => `${scaleFoldStabilityX(point.foldIndex, foldCount, layout)},${scaleFoldStabilityY(point.upper, yMin, layout)}`)
    .join(' L ');
  const lower = [...band]
    .reverse()
    .map((point) => `${scaleFoldStabilityX(point.foldIndex, foldCount, layout)},${scaleFoldStabilityY(point.lower, yMin, layout)}`)
    .join(' L ');
  return `M ${upper} L ${lower} Z`;
}

export function buildFoldStabilityMeanPath(
  band: readonly FoldStabilityBandPoint[] | null,
  {
    foldCount,
    yMin,
    layout,
  }: {
    foldCount: number;
    yMin: number;
    layout: FoldStabilityLayout;
  },
): string | null {
  if (!band || band.length <= 1) return null;
  return `M ${band
    .map((point) => `${scaleFoldStabilityX(point.foldIndex, foldCount, layout)},${scaleFoldStabilityY(point.mean, yMin, layout)}`)
    .join(' L ')}`;
}

export function findFoldStabilityLine(
  lines: readonly FoldStabilityLine[],
  chainId: string | null,
): FoldStabilityLine | undefined {
  if (!chainId) return undefined;
  return lines.find((line) => line.chainId === chainId);
}
