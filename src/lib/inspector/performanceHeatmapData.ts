import { CONTINUOUS_PALETTES, type ContinuousPalette } from '@/lib/playground/colorConfig';
import type { HeatmapCell, HeatmapResponse } from '@/types/inspector';

export interface PerformanceHeatmapLayout {
  labelMarginLeft: number;
  labelMarginBottom: number;
  headerHeight: number;
  svgW: number;
  svgH: number;
  gridW: number;
  gridH: number;
  cellW: number;
  cellH: number;
}

export interface PerformanceHeatmapCellGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface PerformanceHeatmapCellStyle {
  fill: string;
  opacity: number;
  stroke: string;
  strokeWidth: number;
}

export interface PerformanceHeatmapHoverPayload {
  x_label: string;
  y_label: string;
  value: number | null;
  count: number;
}

export const PERFORMANCE_HEATMAP_EMPTY_COLOR = '#1e293b';

export function getPerformanceHeatmapCellKey(xLabel: string, yLabel: string): string {
  return `${xLabel}|${yLabel}`;
}

export function buildPerformanceHeatmapCellMap(
  cells: readonly HeatmapCell[] | null | undefined,
): Map<string, HeatmapCell> {
  const map = new Map<string, HeatmapCell>();
  for (const cell of cells ?? []) {
    map.set(getPerformanceHeatmapCellKey(cell.x_label, cell.y_label), cell);
  }
  return map;
}

export function getPerformanceHeatmapCellColor({
  value,
  minValue,
  maxValue,
  palette,
}: {
  value: number | null;
  minValue: number | null | undefined;
  maxValue: number | null | undefined;
  palette: ContinuousPalette;
}): string {
  if (value == null || minValue == null || maxValue == null) return PERFORMANCE_HEATMAP_EMPTY_COLOR;
  const range = maxValue - minValue;
  const t = range > 0 ? (value - minValue) / range : 0.5;
  const paletteFn = CONTINUOUS_PALETTES[palette];
  return paletteFn ? paletteFn(t) : PERFORMANCE_HEATMAP_EMPTY_COLOR;
}

export function buildPerformanceHeatmapLayout({
  width,
  height,
  xLabelCount,
  yLabelCount,
}: {
  width: number;
  height: number;
  xLabelCount: number;
  yLabelCount: number;
}): PerformanceHeatmapLayout {
  const labelMarginLeft = 100;
  const labelMarginBottom = 60;
  const headerHeight = 20;
  const svgW = width;
  const svgH = height;
  const gridW = Math.max(0, svgW - labelMarginLeft - 10);
  const gridH = Math.max(0, svgH - labelMarginBottom - headerHeight);
  return {
    labelMarginLeft,
    labelMarginBottom,
    headerHeight,
    svgW,
    svgH,
    gridW,
    gridH,
    cellW: xLabelCount > 0 ? gridW / xLabelCount : 0,
    cellH: yLabelCount > 0 ? gridH / yLabelCount : 0,
  };
}

export function getPerformanceHeatmapCellGeometry(
  xIndex: number,
  yIndex: number,
  layout: Pick<PerformanceHeatmapLayout, 'cellW' | 'cellH'>,
): PerformanceHeatmapCellGeometry {
  return {
    x: xIndex * layout.cellW + 0.5,
    y: yIndex * layout.cellH + 0.5,
    width: Math.max(0, layout.cellW - 1),
    height: Math.max(0, layout.cellH - 1),
    centerX: xIndex * layout.cellW + layout.cellW / 2,
    centerY: yIndex * layout.cellH + layout.cellH / 2,
  };
}

export function buildPerformanceHeatmapCellStyle({
  value,
  minValue,
  maxValue,
  palette,
  isHovered,
}: {
  value: number | null;
  minValue: number | null | undefined;
  maxValue: number | null | undefined;
  palette: ContinuousPalette;
  isHovered: boolean;
}): PerformanceHeatmapCellStyle {
  return {
    fill: getPerformanceHeatmapCellColor({ value, minValue, maxValue, palette }),
    opacity: isHovered ? 1 : 0.85,
    stroke: isHovered ? '#fff' : 'transparent',
    strokeWidth: isHovered ? 2 : 0,
  };
}

export function buildPerformanceHeatmapHoverPayload({
  xLabel,
  yLabel,
  cell,
}: {
  xLabel: string;
  yLabel: string;
  cell?: Pick<HeatmapCell, 'value' | 'count'>;
}): PerformanceHeatmapHoverPayload {
  return {
    x_label: xLabel,
    y_label: yLabel,
    value: cell?.value ?? null,
    count: cell?.count ?? 0,
  };
}

export function getPerformanceHeatmapSelectableChainIds(
  cell: Pick<HeatmapCell, 'chain_ids'> | undefined,
): string[] {
  return cell?.chain_ids ?? [];
}

export function hasPerformanceHeatmapData(data: HeatmapResponse | null | undefined): data is HeatmapResponse {
  return Boolean(data && data.cells.length > 0);
}
