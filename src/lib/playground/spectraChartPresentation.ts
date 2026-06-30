import type {
  AggregationMode,
  SpectraDisplayMode,
  SpectraViewMode,
} from '@/lib/playground/spectraConfig';

export interface BuildSpectraChartViewStateInput {
  aggregationMode: AggregationMode;
  showAggregationIndividualLines?: boolean;
  viewMode: SpectraViewMode;
  displayMode: SpectraDisplayMode;
  hasGroupedStats: boolean;
  groupKeyCount: number;
  selectedCount: number;
}

export interface SpectraChartViewState {
  showIndividualLines: boolean;
  showOriginal: boolean;
  showProcessed: boolean;
  showGroupedAggregation: boolean;
  hasSelection: boolean;
  isSelectedOnlyMode: boolean;
}

export function shouldShowSpectraIndividualLines(
  aggregationMode: AggregationMode,
  showAggregationIndividualLines?: boolean,
): boolean {
  return aggregationMode === 'none' || showAggregationIndividualLines === true;
}

export function buildSpectraChartViewState({
  aggregationMode,
  showAggregationIndividualLines,
  viewMode,
  displayMode,
  hasGroupedStats,
  groupKeyCount,
  selectedCount,
}: BuildSpectraChartViewStateInput): SpectraChartViewState {
  const showIndividualLines = shouldShowSpectraIndividualLines(
    aggregationMode,
    showAggregationIndividualLines,
  );

  return {
    showIndividualLines,
    showOriginal: showIndividualLines && (viewMode === 'both' || viewMode === 'original'),
    showProcessed: showIndividualLines && (viewMode === 'both' || viewMode === 'processed'),
    showGroupedAggregation: displayMode === 'grouped' && hasGroupedStats && groupKeyCount > 0,
    hasSelection: selectedCount > 0,
    isSelectedOnlyMode: displayMode === 'selected_only',
  };
}
