import { memo } from 'react';
import { Filter } from 'lucide-react';

import type { PartitionFilter } from '@/lib/playground/partitionFilters';
import { PartitionSelector } from './PartitionSelector';
import { MetricsFilterPanel } from './MetricsFilterPanel';
import type { OutlierMethod } from './OutlierSelector';
import { OutlierSelector } from './OutlierSelector';
import type { DistanceMetric } from './SimilarityFilter';
import { SimilarityFilter } from './SimilarityFilter';
import { RibbonGroup } from './CanvasToolbarRibbonGroup';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { FoldsInfo, MetricFilter, MetricsResult, OutlierResult, SimilarityResult } from '@/types/playground';

export interface CanvasToolbarFilterGroupProps {
  hasPartition: boolean;
  hasFolds: boolean;
  partitionFilter: PartitionFilter;
  onPartitionFilterChange: (filter: PartitionFilter) => void;
  folds: FoldsInfo | null;
  totalSamples: number;
  metrics?: MetricsResult | null;
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
  metricFilters?: MetricFilter[];
  onMetricFiltersChange?: (filters: MetricFilter[]) => void;
  onDetectOutliers?: (method: OutlierMethod, threshold: number) => Promise<OutlierResult>;
  onFindSimilar?: (referenceIdx: number, metric: DistanceMetric, threshold?: number, topK?: number) => Promise<SimilarityResult>;
  selectedSample?: number | null;
  sampleIds?: string[];
}

export const CanvasToolbarFilterGroup = memo(function CanvasToolbarFilterGroup({
  hasPartition,
  hasFolds,
  partitionFilter,
  onPartitionFilterChange,
  folds,
  totalSamples,
  metrics,
  metricObservations,
  metricFilters = [],
  onMetricFiltersChange,
  onDetectOutliers,
  onFindSimilar,
  selectedSample,
  sampleIds,
}: CanvasToolbarFilterGroupProps) {
  return (
    <RibbonGroup label="Filter" icon={<Filter className="w-2.5 h-2.5" />}>
      {(hasPartition || hasFolds) && (
        <PartitionSelector
          value={partitionFilter}
          onChange={onPartitionFilterChange}
          folds={folds}
          totalSamples={totalSamples}
          compact
        />
      )}

      {metrics && onMetricFiltersChange && (
        <MetricsFilterPanel
          metrics={metrics}
          metricObservations={metricObservations}
          activeFilters={metricFilters}
          onFiltersChange={onMetricFiltersChange}
          totalSamples={totalSamples}
          compact
        />
      )}

      {onDetectOutliers && (
        <OutlierSelector
          onDetectOutliers={onDetectOutliers}
          totalSamples={totalSamples}
          useSelectionContext
          compact
        />
      )}

      {onFindSimilar && (
        <SimilarityFilter
          onFindSimilar={onFindSimilar}
          selectedSample={selectedSample ?? null}
          sampleIds={sampleIds}
          useSelectionContext
          totalSamples={totalSamples}
          compact
        />
      )}
    </RibbonGroup>
  );
});
