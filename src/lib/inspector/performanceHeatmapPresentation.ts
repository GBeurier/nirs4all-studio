import type { TFunction } from 'i18next';
import type { PerformanceHeatmapLayout } from '@/lib/inspector/performanceHeatmapData';

export function getPerformanceHeatmapEmptyMessage(t: TFunction): string {
  return t('inspector.charts.empty.heatmap');
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

export function formatPerformanceHeatmapTooltipValue(value: number | null, t: TFunction): string {
  return value !== null ? value.toFixed(4) : t('inspector.charts.na');
}
