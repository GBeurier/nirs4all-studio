import type { PerformanceHeatmapLayout } from '@/lib/inspector/performanceHeatmapData';

export const PERFORMANCE_HEATMAP_EMPTY_MESSAGE = 'No heatmap data available.';

export function getPerformanceHeatmapEmptyMessage(): string {
  return PERFORMANCE_HEATMAP_EMPTY_MESSAGE;
}

export function formatPerformanceHeatmapLabel(label: string, maxLength = 14): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 2)}\u2026` : label;
}

export function shouldShowPerformanceHeatmapValue(
  value: number | null,
  layout: Pick<PerformanceHeatmapLayout, 'cellW' | 'cellH'>,
): boolean {
  return value !== null && layout.cellW > 30 && layout.cellH > 16;
}

export function getPerformanceHeatmapValueFontSize(
  layout: Pick<PerformanceHeatmapLayout, 'cellH'>,
): number {
  return Math.min(10, layout.cellH * 0.5);
}

export function formatPerformanceHeatmapCellValue(value: number): string {
  return value.toFixed(3);
}

export function formatPerformanceHeatmapTooltipValue(value: number | null): string {
  return value !== null ? value.toFixed(4) : 'N/A';
}
