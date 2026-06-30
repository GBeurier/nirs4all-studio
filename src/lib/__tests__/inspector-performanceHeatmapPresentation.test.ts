import { describe, expect, it } from 'vitest';

import {
  formatPerformanceHeatmapCellValue,
  formatPerformanceHeatmapLabel,
  formatPerformanceHeatmapTooltipValue,
  getPerformanceHeatmapEmptyMessage,
  getPerformanceHeatmapValueFontSize,
  shouldShowPerformanceHeatmapValue,
} from '@/lib/inspector/performanceHeatmapPresentation';

describe('inspector performance heatmap presentation helpers', () => {
  it('formats heatmap labels, values, empty copy, and annotation affordances', () => {
    const layout = { cellW: 245, cellH: 80 };

    expect(getPerformanceHeatmapEmptyMessage()).toBe('No heatmap data available.');
    expect(formatPerformanceHeatmapLabel('short')).toBe('short');
    expect(formatPerformanceHeatmapLabel('very-long-dataset-name')).toBe('very-long-da\u2026');
    expect(shouldShowPerformanceHeatmapValue(0.2, layout)).toBe(true);
    expect(shouldShowPerformanceHeatmapValue(null, layout)).toBe(false);
    expect(getPerformanceHeatmapValueFontSize(layout)).toBe(10);
    expect(getPerformanceHeatmapValueFontSize({ cellH: 12 })).toBe(6);
    expect(formatPerformanceHeatmapCellValue(0.123456)).toBe('0.123');
    expect(formatPerformanceHeatmapTooltipValue(0.123456)).toBe('0.1235');
    expect(formatPerformanceHeatmapTooltipValue(null)).toBe('N/A');
  });
});
