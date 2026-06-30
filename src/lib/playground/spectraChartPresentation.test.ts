import { describe, expect, it } from 'vitest';

import {
  buildSpectraChartViewState,
  shouldShowSpectraIndividualLines,
} from './spectraChartPresentation';

describe('buildSpectraChartViewState', () => {
  it('derives individual line visibility from aggregation mode and override', () => {
    expect(shouldShowSpectraIndividualLines('none')).toBe(true);
    expect(shouldShowSpectraIndividualLines('mean_std')).toBe(false);
    expect(shouldShowSpectraIndividualLines('mean_std', true)).toBe(true);
  });

  it('shows individual original and processed lines in both mode with no aggregation', () => {
    expect(buildSpectraChartViewState({
      aggregationMode: 'none',
      viewMode: 'both',
      displayMode: 'individual',
      hasGroupedStats: false,
      groupKeyCount: 0,
      selectedCount: 0,
    })).toEqual({
      showIndividualLines: true,
      showOriginal: true,
      showProcessed: true,
      showGroupedAggregation: false,
      hasSelection: false,
      isSelectedOnlyMode: false,
    });
  });

  it('hides individual lines during aggregation unless explicitly enabled', () => {
    expect(buildSpectraChartViewState({
      aggregationMode: 'mean_std',
      viewMode: 'processed',
      displayMode: 'aggregated',
      hasGroupedStats: false,
      groupKeyCount: 0,
      selectedCount: 0,
    }).showProcessed).toBe(false);

    expect(buildSpectraChartViewState({
      aggregationMode: 'mean_std',
      showAggregationIndividualLines: true,
      viewMode: 'processed',
      displayMode: 'aggregated',
      hasGroupedStats: false,
      groupKeyCount: 0,
      selectedCount: 0,
    }).showProcessed).toBe(true);
  });

  it('requires grouped mode, grouped stats, and group keys for grouped aggregation display', () => {
    expect(buildSpectraChartViewState({
      aggregationMode: 'mean_std',
      viewMode: 'processed',
      displayMode: 'grouped',
      hasGroupedStats: true,
      groupKeyCount: 2,
      selectedCount: 3,
    })).toMatchObject({
      showGroupedAggregation: true,
      hasSelection: true,
      isSelectedOnlyMode: false,
    });

    expect(buildSpectraChartViewState({
      aggregationMode: 'mean_std',
      viewMode: 'processed',
      displayMode: 'grouped',
      hasGroupedStats: true,
      groupKeyCount: 0,
      selectedCount: 0,
    }).showGroupedAggregation).toBe(false);
  });

  it('marks selected-only mode without forcing processed or original visibility', () => {
    expect(buildSpectraChartViewState({
      aggregationMode: 'density',
      viewMode: 'difference',
      displayMode: 'selected_only',
      hasGroupedStats: false,
      groupKeyCount: 0,
      selectedCount: 1,
    })).toMatchObject({
      showIndividualLines: false,
      showOriginal: false,
      showProcessed: false,
      hasSelection: true,
      isSelectedOnlyMode: true,
    });
  });
});
