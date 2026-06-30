import { describe, expect, it } from 'vitest';

import { buildSpectraChartLegendItems } from './SpectraChartLegend';
import { CHART_THEME } from './chartConfig';

describe('buildSpectraChartLegendItems', () => {
  it('builds grouped legend entries from group keys', () => {
    const items = buildSpectraChartLegendItems({
      showGroupedAggregation: true,
      groupKeys: ['batch-a', 'batch-b'],
      aggregationMode: 'mean_std',
      viewMode: 'processed',
      showProcessed: false,
      showOriginal: false,
      hasReferenceDataset: false,
      referenceLabel: 'Reference',
    });

    expect(items).toEqual([
      expect.objectContaining({ label: 'batch-a', isArea: true }),
      expect.objectContaining({ label: 'batch-b', isArea: true }),
    ]);
  });

  it('adds original and reference entries for aggregated both-view legends', () => {
    const items = buildSpectraChartLegendItems({
      showGroupedAggregation: false,
      groupKeys: [],
      aggregationMode: 'mean_std',
      viewMode: 'both',
      showProcessed: false,
      showOriginal: false,
      hasReferenceDataset: true,
      referenceLabel: 'Baseline',
    });

    const labels = items.map(item => item.label);
    expect(labels[0]).toBe('Mean');
    expect(labels).toContain('Original');
    expect(labels).toContain('Baseline');
    expect(items.at(-1)).toEqual({
      label: 'Baseline',
      color: CHART_THEME.referenceLineColor,
      dashed: true,
    });
  });

  it('builds individual line legends for processed, original, difference, and reference lines', () => {
    expect(buildSpectraChartLegendItems({
      showGroupedAggregation: false,
      groupKeys: [],
      aggregationMode: 'none',
      viewMode: 'both',
      showProcessed: true,
      showOriginal: true,
      hasReferenceDataset: true,
      referenceLabel: 'Reference',
    }).map(item => item.label)).toEqual(['Processed', 'Original', 'Reference']);

    expect(buildSpectraChartLegendItems({
      showGroupedAggregation: false,
      groupKeys: [],
      aggregationMode: 'none',
      viewMode: 'difference',
      showProcessed: true,
      showOriginal: false,
      hasReferenceDataset: false,
      referenceLabel: 'Reference',
    })).toEqual([
      { label: 'Difference', color: 'hsl(var(--primary))' },
    ]);
  });
});
