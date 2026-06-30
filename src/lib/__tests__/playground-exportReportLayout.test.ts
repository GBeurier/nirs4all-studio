import { describe, expect, it } from 'vitest';

import {
  buildCombinedReportChartPlacements,
  buildCombinedReportGrid,
  buildCombinedReportStatsParts,
  formatCombinedReportChartLabel,
  formatCombinedReportDate,
} from '@/lib/playground/exportReportLayout';

describe('playground combined report layout helpers', () => {
  it('builds compact grids based on visible chart count', () => {
    const base = {
      width: 1600,
      height: 1200,
      padding: 20,
      headerHeight: 60,
      footerHeight: 80,
    };

    expect(buildCombinedReportGrid({ ...base, chartCount: 1 })).toMatchObject({ cols: 1, rows: 1 });
    expect(buildCombinedReportGrid({ ...base, chartCount: 2 })).toMatchObject({ cols: 2, rows: 1 });
    expect(buildCombinedReportGrid({ ...base, chartCount: 4 })).toMatchObject({ cols: 2, rows: 2 });
    expect(buildCombinedReportGrid({ ...base, chartCount: 5 })).toMatchObject({ cols: 2, rows: 3 });
  });

  it('formats chart labels and report statistics consistently', () => {
    expect(formatCombinedReportChartLabel('spectra')).toBe('Spectra');
    expect(buildCombinedReportStatsParts({
      sampleCount: 0,
      wavelengthCount: 120,
      selectedCount: 4,
      outlierCount: 0,
      yRange: { min: 1.234, max: 5.678 },
    })).toEqual([
      'N = 0',
      'Features = 120',
      'Selected = 4',
      'Y range: 1.23 - 5.68',
    ]);
  });

  it('places charts row-major within the grid', () => {
    const placements = buildCombinedReportChartPlacements({
      chartCount: 3,
      cols: 2,
      cellWidth: 100,
      cellHeight: 60,
      chartAreaTop: 80,
      padding: 20,
    });

    expect(placements).toEqual([
      { index: 0, col: 0, row: 0, x: 20, y: 80 },
      { index: 1, col: 1, row: 0, x: 140, y: 80 },
      { index: 2, col: 0, row: 1, x: 20, y: 160 },
    ]);
  });

  it('formats a deterministic header date from a given instant', () => {
    const date = formatCombinedReportDate(new Date('2026-01-08T09:30:00Z'));
    expect(date).toContain('2026');
    expect(date).toContain('January');
  });
});
