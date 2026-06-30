import { describe, expect, it } from 'vitest';

import {
  buildCombinedReportChartDrawing,
  buildCombinedReportFooterDrawing,
  buildCombinedReportHeaderDrawing,
} from '@/lib/playground/exportReportDrawing';

describe('buildCombinedReportHeaderDrawing', () => {
  it('builds the header text and divider instructions', () => {
    expect(buildCombinedReportHeaderDrawing({
      datasetName: 'Demo dataset',
      dateText: 'June 29, 2026 at 10:15 AM',
      padding: 20,
      headerHeight: 60,
      width: 1600,
    })).toEqual({
      titleText: {
        text: 'Demo dataset',
        x: 20,
        y: 20,
        fillStyle: '#1a1a1a',
        font: 'bold 24px system-ui, sans-serif',
        textBaseline: 'top',
      },
      dateText: {
        text: 'June 29, 2026 at 10:15 AM',
        x: 20,
        y: 50,
        fillStyle: '#666666',
        font: '14px system-ui, sans-serif',
      },
      divider: {
        strokeStyle: '#e5e5e5',
        lineWidth: 1,
        fromX: 20,
        fromY: 60,
        toX: 1580,
        toY: 60,
      },
    });
  });
});

describe('buildCombinedReportChartDrawing', () => {
  it('builds label, border, and fallback placeholder instructions', () => {
    expect(buildCombinedReportChartDrawing({
      chartType: 'pca',
      x: 100,
      y: 200,
      cellWidth: 300,
      cellHeight: 180,
    })).toEqual({
      labelText: {
        text: 'Pca',
        x: 105,
        y: 205,
        fillStyle: '#333333',
        font: 'bold 12px system-ui, sans-serif',
      },
      border: {
        x: 100,
        y: 200,
        width: 300,
        height: 180,
        strokeStyle: '#e5e5e5',
        lineWidth: 1,
      },
      placeholderBackground: {
        x: 100,
        y: 200,
        width: 300,
        height: 180,
        fillStyle: '#f5f5f5',
      },
      placeholderText: {
        text: '[pca]',
        x: 250,
        y: 290,
        fillStyle: '#999999',
        font: '14px system-ui, sans-serif',
        textAlign: 'center',
        resetTextAlign: 'left',
      },
    });
  });
});

describe('buildCombinedReportFooterDrawing', () => {
  it('builds footer lines with optional pipeline and statistics text', () => {
    const drawing = buildCombinedReportFooterDrawing({
      height: 1200,
      footerHeight: 80,
      width: 1600,
      padding: 20,
      pipelineDescription: 'SNV -> PLS(10)',
      statistics: {
        sampleCount: 500,
        wavelengthCount: 128,
        selectedCount: 12,
        outlierCount: 0,
        yRange: { min: 2.1, max: 8.4 },
      },
    });

    expect(drawing.footerY).toBe(1120);
    expect(drawing.divider).toEqual({
      strokeStyle: '#e5e5e5',
      lineWidth: 1,
      fromX: 20,
      fromY: 1120,
      toX: 1580,
      toY: 1120,
    });
    expect(drawing.pipelineText).toEqual({
      text: 'Pipeline: SNV -> PLS(10)',
      x: 20,
      y: 1135,
      fillStyle: '#333333',
      font: '14px system-ui, sans-serif',
    });
    expect(drawing.statsText).toEqual({
      text: 'N = 500 | Features = 128 | Selected = 12 | Y range: 2.10 - 8.40',
      x: 20,
      y: 1160,
      fillStyle: '#666666',
      font: '12px system-ui, sans-serif',
    });
    expect(drawing.generatedText).toEqual({
      text: 'Generated with nirs4all Playground',
      x: 1580,
      y: 1175,
      fillStyle: '#999999',
      font: '10px system-ui, sans-serif',
      textAlign: 'right',
      resetTextAlign: 'left',
    });
  });

  it('omits optional footer text when there is no content', () => {
    const drawing = buildCombinedReportFooterDrawing({
      height: 600,
      footerHeight: 80,
      width: 800,
      padding: 20,
    });

    expect(drawing.pipelineText).toBeUndefined();
    expect(drawing.statsText).toBeUndefined();
    expect(drawing.generatedText).toMatchObject({
      text: 'Generated with nirs4all Playground',
      x: 780,
      y: 575,
    });
  });
});
