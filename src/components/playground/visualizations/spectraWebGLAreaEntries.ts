export interface SpectraWebGLAreaStats {
  mean: number[];
  median: number[];
  min: number[];
  max: number[];
  std: number[];
  quantileLower: number[];
  quantileUpper: number[];
}

export interface SpectraWebGLGroupedAreaEntry {
  label: string | number;
  stats: SpectraWebGLAreaStats;
  color: string;
}

const DEFAULT_GROUP_AREA_COLOR = 'hsl(217, 70%, 50%)';

export function buildSpectraWebGLGroupedAreaEntries(
  groupedStats: Map<string | number, SpectraWebGLAreaStats>,
  colors: string[]
): SpectraWebGLGroupedAreaEntry[] {
  const palette = colors.length > 0 ? colors : [DEFAULT_GROUP_AREA_COLOR];

  return Array.from(groupedStats.entries()).map(([label, stats], idx) => ({
    label,
    stats,
    color: palette[idx % palette.length],
  }));
}
