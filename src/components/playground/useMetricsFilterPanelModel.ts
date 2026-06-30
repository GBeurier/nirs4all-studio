import { useCallback, useMemo } from 'react';

import {
  countFilteredMetricSamples,
  getMetricPresetFilters,
  replaceMetricFilter,
} from '@/lib/playground/metricFilterData';
import { buildMetricsFilterPanelReadModel } from '@/lib/playground/metricFilterReadModel';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { MetricFilter, MetricsResult } from '@/types/playground';

interface UseMetricsFilterPanelModelArgs {
  metrics?: MetricsResult | null;
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
  activeFilters: MetricFilter[];
  onFiltersChange: (filters: MetricFilter[]) => void;
  totalSamples: number;
}

export function useMetricsFilterPanelModel({
  metrics,
  metricObservations,
  activeFilters,
  onFiltersChange,
  totalSamples,
}: UseMetricsFilterPanelModelArgs) {
  const readModel = useMemo(() => {
    return buildMetricsFilterPanelReadModel(metrics, metricObservations);
  }, [metrics, metricObservations]);

  const filteredSampleCount = useMemo(() => {
    return countFilteredMetricSamples(metrics, activeFilters, totalSamples);
  }, [metrics, activeFilters, totalSamples]);

  const handleFilterChange = useCallback((metric: string, filter: MetricFilter | undefined) => {
    onFiltersChange(replaceMetricFilter(activeFilters, metric, filter));
  }, [activeFilters, onFiltersChange]);

  const handleApplyPreset = useCallback((presetId: string) => {
    if (!metrics) return;

    const newFilters = getMetricPresetFilters(presetId, metrics);
    if (newFilters) onFiltersChange(newFilters);
  }, [metrics, onFiltersChange]);

  const handleClearAll = useCallback(() => {
    onFiltersChange([]);
  }, [onFiltersChange]);

  return {
    availableMetricCount: readModel.availableMetricCount,
    filteredSampleCount,
    handleApplyPreset,
    handleClearAll,
    handleFilterChange,
    hasActiveFilters: activeFilters.length > 0,
    hasAvailableMetrics: readModel.hasAvailableMetrics,
    metricObservationAvailability: readModel.metricObservationAvailability,
    metricsByCategory: readModel.metricsByCategory,
  };
}
