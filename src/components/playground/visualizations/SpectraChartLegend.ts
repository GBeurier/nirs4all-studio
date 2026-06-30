import {
  getCategoricalColor,
  type GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import type {
  AggregationMode,
  SpectraViewMode,
} from '@/lib/playground/spectraConfig';
import { CHART_THEME } from './chartConfig';
import {
  getAggregationLegendItems,
} from './SpectraAggregation';
import type { SpectraChartLegendItem } from './SpectraChartFooter';

export interface BuildSpectraChartLegendItemsInput {
  showGroupedAggregation: boolean;
  groupKeys: Array<string | number>;
  categoricalPalette?: GlobalColorConfig['categoricalPalette'];
  aggregationMode: AggregationMode;
  viewMode: SpectraViewMode;
  showProcessed: boolean;
  showOriginal: boolean;
  hasReferenceDataset: boolean;
  referenceLabel: string;
}

export function buildSpectraChartLegendItems({
  showGroupedAggregation,
  groupKeys,
  categoricalPalette = 'default',
  aggregationMode,
  viewMode,
  showProcessed,
  showOriginal,
  hasReferenceDataset,
  referenceLabel,
}: BuildSpectraChartLegendItemsInput): SpectraChartLegendItem[] {
  if (showGroupedAggregation) {
    return groupKeys.map((key, index) => ({
      label: String(key),
      color: getCategoricalColor(index, categoricalPalette),
      isArea: aggregationMode !== 'none',
    }));
  }

  if (aggregationMode !== 'none') {
    const items = getAggregationLegendItems(aggregationMode, viewMode === 'both') as SpectraChartLegendItem[];
    if (hasReferenceDataset) {
      items.push({ label: referenceLabel, color: CHART_THEME.referenceLineColor, dashed: true });
    }
    return items;
  }

  const items: SpectraChartLegendItem[] = [];
  if (showProcessed) {
    items.push({ label: viewMode === 'difference' ? 'Difference' : 'Processed', color: 'hsl(var(--primary))' });
  }
  if (showOriginal && viewMode === 'both') {
    items.push({ label: 'Original', color: 'hsl(var(--primary))', dashed: true });
  }
  if (hasReferenceDataset) {
    items.push({ label: referenceLabel, color: CHART_THEME.referenceLineColor, dashed: true });
  }
  return items;
}
