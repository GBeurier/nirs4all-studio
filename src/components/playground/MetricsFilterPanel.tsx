/**
 * MetricsFilterPanel - Filter samples by spectral metric values
 *
 * Phase 5 Implementation: Advanced Filtering & Metrics
 *
 * Features:
 * - Range slider per metric with histogram preview
 * - Combine multiple metric filters
 * - Preset filters (e.g., "Typical Samples", "Outliers Only")
 * - Real-time filtering feedback
 * - Grouped by metric category
 */

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  MetricsFilterFooter,
  MetricsFilterHeader,
  MetricsFilterTrigger,
  MetricsPresetList,
  MetricsUnavailableTrigger,
} from './MetricsFilterPanelControls';
import { MetricCategoryList } from './MetricsFilterPanelMetrics';
import { useMetricsFilterPanelModel } from './useMetricsFilterPanelModel';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';
import type { MetricsResult, MetricFilter } from '@/types/playground';

// ============= Types =============

export interface MetricsFilterPanelProps {
  /** Computed metrics from backend */
  metrics?: MetricsResult | null;
  /** Structured metric observations from playground execution */
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
  /** Current active filters */
  activeFilters: MetricFilter[];
  /** Callback when filters change */
  onFiltersChange: (filters: MetricFilter[]) => void;
  /** Total samples before filtering */
  totalSamples: number;
  /** Callback to get filtered sample indices */
  onGetFilteredIndices?: () => number[];
  /** Whether metrics are being loaded */
  isLoading?: boolean;
  /** Compact mode for toolbar */
  compact?: boolean;
}

// ============= Main Component =============

export function MetricsFilterPanel({
  metrics,
  metricObservations,
  activeFilters,
  onFiltersChange,
  totalSamples,
  isLoading = false,
  compact = false,
}: MetricsFilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const {
    filteredSampleCount,
    handleApplyPreset,
    handleClearAll,
    handleFilterChange,
    hasActiveFilters,
    hasAvailableMetrics,
    metricsByCategory,
  } = useMetricsFilterPanelModel({
    activeFilters,
    metrics,
    metricObservations,
    onFiltersChange,
    totalSamples,
  });

  if (!metrics || !hasAvailableMetrics) {
    return <MetricsUnavailableTrigger compact={compact} isLoading={isLoading} />;
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <MetricsFilterTrigger activeFilterCount={activeFilters.length} compact={compact} />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 max-h-[70vh] flex flex-col">
        <MetricsFilterHeader
          filteredSampleCount={filteredSampleCount}
          hasActiveFilters={hasActiveFilters}
          onClearAll={handleClearAll}
          totalSamples={totalSamples}
        />
        <MetricsPresetList onApplyPreset={handleApplyPreset} />
        <MetricCategoryList
          activeFilters={activeFilters}
          metricsByCategory={metricsByCategory}
          metricsData={metrics}
          onFilterChange={handleFilterChange}
        />
        {hasActiveFilters && (
          <MetricsFilterFooter
            filteredSampleCount={filteredSampleCount}
            totalSamples={totalSamples}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export default MetricsFilterPanel;
