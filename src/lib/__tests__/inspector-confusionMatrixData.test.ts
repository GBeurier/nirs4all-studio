import { describe, expect, it } from 'vitest';

import {
  buildConfusionMatrixCellView,
  buildConfusionMatrixHeaderSegments,
  buildConfusionMatrixLayout,
  buildConfusionMatrixSummary,
  formatConfusionMatrixAccuracy,
  formatConfusionMatrixCellValue,
  formatConfusionMatrixLabel,
  formatConfusionMatrixNormalizeLabel,
  formatConfusionMatrixNormalizedPercent,
  getConfusionMatrixBlueColor,
  getConfusionMatrixCellKey,
  getConfusionMatrixReason,
  getConfusionMatrixTextColor,
} from '@/lib/inspector/confusionMatrixData';
import type { ConfusionMatrixCell, ConfusionMatrixResponse } from '@/types/inspector';

function cell(overrides: Partial<ConfusionMatrixCell> = {}): ConfusionMatrixCell {
  return {
    true_label: 'A',
    pred_label: 'A',
    count: 8,
    normalized: 0.8,
    ...overrides,
  };
}

function response(overrides: Partial<ConfusionMatrixResponse> = {}): ConfusionMatrixResponse {
  return {
    cells: [
      cell(),
      cell({ true_label: 'A', pred_label: 'B', count: 2, normalized: 0.2 }),
      cell({ true_label: 'B', pred_label: 'A', count: 1, normalized: 0.1 }),
      cell({ true_label: 'B', pred_label: 'B', count: 9, normalized: 0.9 }),
    ],
    labels: ['A', 'B'],
    total_samples: 20,
    partition: 'test',
    normalize: 'row',
    reason: ' needs classification arrays ',
    ...overrides,
  };
}

describe('inspector confusion matrix data helpers', () => {
  it('builds cell maps, totals, accuracy, display mode, and trimmed reasons', () => {
    const data = response();
    const summary = buildConfusionMatrixSummary(data);

    expect(getConfusionMatrixCellKey('A', 'B')).toBe('A|B');
    expect(summary.cellMap.get('A|B')).toMatchObject({ count: 2, normalized: 0.2 });
    expect(summary.rowTotals).toEqual(new Map([
      ['A', 10],
      ['B', 10],
    ]));
    expect(summary.colTotals).toEqual(new Map([
      ['A', 9],
      ['B', 11],
    ]));
    expect(summary.maxValue).toBe(9);
    expect(summary.totalSamples).toBe(20);
    expect(summary.accuracy).toBeCloseTo(0.85);
    expect(summary.displayValues).toBe(true);
    expect(getConfusionMatrixReason(data)).toBe('needs classification arrays');

    expect(buildConfusionMatrixSummary(response({ total_samples: 0 })).totalSamples).toBe(20);
    expect(buildConfusionMatrixSummary(null)).toMatchObject({
      maxValue: 0,
      totalSamples: 0,
      accuracy: 0,
      displayValues: false,
    });
  });

  it('computes layout, colors, labels, and header copy', () => {
    const layout = buildConfusionMatrixLayout({ width: 500, height: 400, labelCount: 2 });

    expect(layout).toEqual({
      marginLeft: 148,
      marginRight: 20,
      marginTop: 86,
      marginBottom: 86,
      svgW: 500,
      svgH: 400,
      plotW: 332,
      plotH: 228,
      cellW: 166,
      cellH: 114,
      cellLabelThreshold: true,
    });
    expect(getConfusionMatrixBlueColor(0, 9)).toBe('#f8fafc');
    expect(getConfusionMatrixBlueColor(9, 9)).toBe('#1e3a8a');
    expect(getConfusionMatrixTextColor(6, 9)).toBe('#ffffff');
    expect(getConfusionMatrixTextColor(1, 9)).toBe('#0f172a');
    expect(formatConfusionMatrixLabel('short')).toBe('short');
    expect(formatConfusionMatrixLabel('very-long-label')).toBe('very-long-l…');
    expect(formatConfusionMatrixNormalizeLabel('none')).toBe('raw counts');
    expect(formatConfusionMatrixNormalizeLabel('row')).toBe('normalized: row');
    expect(formatConfusionMatrixAccuracy(0.853)).toBe('85.3%');
    expect(formatConfusionMatrixNormalizedPercent(0.234)).toBe('23.4%');
    expect(buildConfusionMatrixHeaderSegments({
      data: response(),
      labelCount: 2,
      totalSamples: 20,
      accuracy: 0.85,
    })).toEqual([
      'test',
      'normalized: row',
      '2 labels',
      '20 samples',
      'diag accuracy 85.0%',
    ]);
  });

  it('projects cell geometry, normalized labels, hover styling, and empty cells', () => {
    const summary = buildConfusionMatrixSummary(response());
    const layout = buildConfusionMatrixLayout({ width: 500, height: 400, labelCount: 2 });
    const cellView = buildConfusionMatrixCellView({
      trueLabel: 'A',
      predLabel: 'B',
      rowIndex: 0,
      colIndex: 1,
      summary,
      layout,
      hovered: { true_label: 'A', pred_label: 'B' },
    });

    expect(cellView).toMatchObject({
      trueLabel: 'A',
      predLabel: 'B',
      count: 2,
      normalized: 0.2,
      value: 0.2,
      color: '#eff6ff',
      textColor: '#0f172a',
      isHovered: true,
      isDiagonal: false,
      isEmpty: false,
      x: 167,
      y: 1,
      width: 164,
      height: 112,
      opacity: 1,
      stroke: '#ffffff',
      strokeWidth: 2,
      label: '20.0%',
      labelX: 249,
      labelY: 57,
      labelFontSize: 12,
      showLabel: true,
    });
    expect(formatConfusionMatrixCellValue({
      displayValues: false,
      normalized: 0.2,
      count: 2,
    })).toBe(2);

    const emptyCell = buildConfusionMatrixCellView({
      trueLabel: 'A',
      predLabel: 'C',
      rowIndex: 0,
      colIndex: 2,
      summary,
      layout,
      hovered: null,
    });
    expect(emptyCell).toMatchObject({
      count: 0,
      normalized: null,
      value: 0,
      color: '#f8fafc',
      isEmpty: true,
      opacity: 0.65,
      stroke: '#e2e8f0',
      strokeWidth: 0.7,
      label: 0,
    });
  });
});
