import { describe, expect, it } from 'vitest';

import {
  buildPerformanceHeatmapCellMap,
  buildPerformanceHeatmapCellStyle,
  buildPerformanceHeatmapHoverPayload,
  buildPerformanceHeatmapLayout,
  getPerformanceHeatmapCellColor,
  getPerformanceHeatmapCellGeometry,
  getPerformanceHeatmapCellKey,
  getPerformanceHeatmapSelectableChainIds,
  hasPerformanceHeatmapData,
  PERFORMANCE_HEATMAP_EMPTY_COLOR,
} from '@/lib/inspector/performanceHeatmapData';
import type { HeatmapCell, HeatmapResponse } from '@/types/inspector';

function cell(overrides: Partial<HeatmapCell> = {}): HeatmapCell {
  return {
    x_label: 'PLS',
    y_label: 'dataset-a',
    value: 0.2,
    count: 2,
    chain_ids: ['a', 'b'],
    ...overrides,
  };
}

function response(cells: HeatmapCell[]): HeatmapResponse {
  return {
    cells,
    x_labels: ['PLS', 'Ridge'],
    y_labels: ['dataset-a'],
    x_variable: 'model_class',
    y_variable: 'dataset_name',
    score_column: 'cv_val_score',
    min_value: 0.1,
    max_value: 0.3,
  };
}

describe('inspector performance heatmap data helpers', () => {
  it('builds cell lookup, data guards, hover payloads, and selectable ids', () => {
    const map = buildPerformanceHeatmapCellMap([
      cell(),
      cell({ x_label: 'Ridge', y_label: 'dataset-a', value: null, chain_ids: [] }),
    ]);

    expect(getPerformanceHeatmapCellKey('PLS', 'dataset-a')).toBe('PLS|dataset-a');
    expect(map.get('PLS|dataset-a')).toMatchObject({ value: 0.2, count: 2 });
    expect(hasPerformanceHeatmapData(response([cell()]))).toBe(true);
    expect(hasPerformanceHeatmapData(response([]))).toBe(false);
    expect(buildPerformanceHeatmapHoverPayload({
      xLabel: 'Ridge',
      yLabel: 'dataset-a',
      cell: map.get('Ridge|dataset-a'),
    })).toEqual({
      x_label: 'Ridge',
      y_label: 'dataset-a',
      value: null,
      count: 2,
    });
    expect(getPerformanceHeatmapSelectableChainIds(map.get('PLS|dataset-a'))).toEqual(['a', 'b']);
    expect(getPerformanceHeatmapSelectableChainIds(undefined)).toEqual([]);
  });

  it('computes colors and hovered cell styles', () => {
    expect(getPerformanceHeatmapCellColor({
      value: null,
      minValue: 0,
      maxValue: 1,
      palette: 'viridis',
    })).toBe(PERFORMANCE_HEATMAP_EMPTY_COLOR);
    expect(getPerformanceHeatmapCellColor({
      value: 0.5,
      minValue: 0,
      maxValue: 1,
      palette: 'viridis',
    })).not.toBe(PERFORMANCE_HEATMAP_EMPTY_COLOR);
    expect(buildPerformanceHeatmapCellStyle({
      value: 0.5,
      minValue: 0,
      maxValue: 1,
      palette: 'viridis',
      isHovered: true,
    })).toMatchObject({
      opacity: 1,
      stroke: '#fff',
      strokeWidth: 2,
    });
  });

  it('builds layout geometry', () => {
    const layout = buildPerformanceHeatmapLayout({
      width: 600,
      height: 400,
      xLabelCount: 2,
      yLabelCount: 4,
    });
    expect(layout).toEqual({
      labelMarginLeft: 100,
      labelMarginBottom: 60,
      headerHeight: 20,
      svgW: 600,
      svgH: 400,
      gridW: 490,
      gridH: 320,
      cellW: 245,
      cellH: 80,
    });
    expect(getPerformanceHeatmapCellGeometry(1, 2, layout)).toEqual({
      x: 245.5,
      y: 160.5,
      width: 244,
      height: 79,
      centerX: 367.5,
      centerY: 200,
    });
  });
});
