import type { HistogramResponse, InspectorGroup } from '@/types/inspector';

export const SCORE_HISTOGRAM_FALLBACK_COLOR = '#64748b';

export interface ScoreHistogramBarData {
  label: string;
  count: number;
  binStart: number;
  binEnd: number;
  chainIds: string[];
  hasSelected: boolean;
}

export interface ScoreHistogramCellStyle {
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
}

export interface ScoreHistogramSelectionDecision {
  chainIds: string[];
  mode: 'add' | 'remove';
}

export function buildScoreHistogramChainColorMap(
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

export function buildScoreHistogramBars({
  data,
  selectedChains,
  hasSelection,
}: {
  data: HistogramResponse | null | undefined;
  selectedChains: ReadonlySet<string>;
  hasSelection: boolean;
}): ScoreHistogramBarData[] {
  if (!data?.bins?.length) return [];

  return data.bins.map((bin) => {
    const hasSelected = hasSelection && bin.chain_ids.some((id) => selectedChains.has(id));
    return {
      label: bin.bin_start.toFixed(3),
      count: bin.count,
      binStart: bin.bin_start,
      binEnd: bin.bin_end,
      chainIds: bin.chain_ids,
      hasSelected,
    };
  });
}

export function getScoreHistogramDominantColor(
  chainIds: readonly string[],
  chainColorMap: ReadonlyMap<string, string>,
): string {
  if (chainIds.length === 0) return SCORE_HISTOGRAM_FALLBACK_COLOR;

  const colorCounts = new Map<string, number>();
  for (const chainId of chainIds) {
    const color = chainColorMap.get(chainId) ?? SCORE_HISTOGRAM_FALLBACK_COLOR;
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1);
  }

  let maxColor = SCORE_HISTOGRAM_FALLBACK_COLOR;
  let maxCount = 0;
  for (const [color, count] of colorCounts) {
    if (count > maxCount) {
      maxCount = count;
      maxColor = color;
    }
  }
  return maxColor;
}

export function buildScoreHistogramBarColors(
  bars: readonly ScoreHistogramBarData[],
  chainColorMap: ReadonlyMap<string, string>,
): string[] {
  return bars.map((bar) => getScoreHistogramDominantColor(bar.chainIds, chainColorMap));
}

export function buildScoreHistogramCellStyle({
  color,
  hasSelection,
  hasSelected,
}: {
  color: string;
  hasSelection: boolean;
  hasSelected: boolean;
}): ScoreHistogramCellStyle {
  return {
    fill: color,
    fillOpacity: hasSelection && !hasSelected ? 0.3 : 0.8,
    stroke: hasSelected ? color : 'none',
    strokeWidth: hasSelected ? 2 : 0,
  };
}

export function getScoreHistogramSelectionDecision(
  bar: ScoreHistogramBarData | undefined,
  selectedChains: ReadonlySet<string>,
): ScoreHistogramSelectionDecision | null {
  if (!bar || bar.chainIds.length === 0) return null;
  const allSelected = bar.chainIds.every((id) => selectedChains.has(id));
  return {
    chainIds: bar.chainIds,
    mode: allSelected ? 'remove' : 'add',
  };
}
