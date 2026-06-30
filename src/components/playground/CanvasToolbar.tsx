/**
 * CanvasToolbar - Ribbon-style toolbar for MainCanvas (Word-like banner)
 *
 * Phase 1 Refactoring: Component Modularization
 * Phase 10: Ribbon-style organization with two rows and category groups
 *
 * Categories (organized in ribbon groups):
 * - VIEW: Chart visibility, step comparison, diff mode
 * - SELECTION: Selection tools, selection count, saved selections
 * - FILTER: Partition filter, display filters, metrics, outliers, similarity
 * - COLORATION: Color mode, palette selection
 * - ACTIONS: Export, reset, reference mode
 */

import { memo } from 'react';
import type { PartitionFilter } from '@/lib/playground/partitionFilters';
import type { OutlierMethod } from './OutlierSelector';
import type { DistanceMetric } from './SimilarityFilter';
import type { MetricsResult, MetricFilter, OutlierResult, SimilarityResult, FoldsInfo, SubsetInfo } from '@/types/playground';
import { CanvasToolbarColorGroup } from './CanvasToolbarColorGroup';
import { CanvasToolbarFilterGroup } from './CanvasToolbarFilterGroup';
import { CanvasToolbarSelectionGroup } from './CanvasToolbarSelectionGroup';
import { CanvasToolbarViewGroup } from './CanvasToolbarViewGroup';
import type { ToggleableChartControl } from './CanvasToolbarViewGroup';
import {
  type GlobalColorConfig,
  type ColorContext,
} from '@/lib/playground/colorConfig';
import { type ChartType } from '@/context/usePlaygroundView';
import type { SpectraViewMode } from '@/lib/playground/spectraConfig';
import type { PipelineExecutionMetricObservation } from '@/lib/pipelineExecutionContract';

// Re-export ChartType for consumers
export type { ChartType };
export { CHART_CONFIG } from './CanvasToolbarChartConfig';
export type { ChartConfig } from './CanvasToolbarChartConfig';

export interface CanvasToolbarProps {
  // Chart visibility
  effectiveVisibleCharts: Set<ChartType>;
  onToggleChart: (chart: ChartType) => void;
  toggleableCharts?: readonly ToggleableChartControl[];
  /** True when CV folds (kind="cv_folds", n_folds > 1) are available. */
  hasFolds: boolean;
  /**
   * True when partition coloring should be enabled — independent from folds.
   * Set when the source dataset has a test partition, when the first splitter
   * has produced one.
   */
  hasPartition: boolean;
  /** True when the partition/fold distribution chart should be shown. */
  showFoldsChart: boolean;
  hasRepetitions: boolean;

  // Loading state
  isFetching: boolean;

  // Selection
  selectedCount: number;
  onFilterToSelection?: () => void;

  // Partition filter
  partitionFilter: PartitionFilter;
  onPartitionFilterChange: (filter: PartitionFilter) => void;
  folds: FoldsInfo | null;
  totalSamples: number;
  /** Metadata for selection filters */
  metadata?: Record<string, unknown[]>;

  // Advanced filtering (Phase 5)
  metrics?: MetricsResult | null;
  metricObservations?: readonly PipelineExecutionMetricObservation[] | null;
  metricFilters?: MetricFilter[];
  onMetricFiltersChange?: (filters: MetricFilter[]) => void;
  onDetectOutliers?: (method: OutlierMethod, threshold: number) => Promise<OutlierResult>;
  onFindSimilar?: (referenceIdx: number, metric: DistanceMetric, threshold?: number, topK?: number) => Promise<SimilarityResult>;
  selectedSample?: number | null;
  sampleIds?: string[];

  // Color mode
  colorConfig: GlobalColorConfig;
  onColorConfigChange: (config: GlobalColorConfig) => void;
  /** Whether outliers have been detected (enables outlier color mode) */
  hasOutliers?: boolean;
  /** Color context for legend display */
  colorContext?: ColorContext;

  // Interaction
  onInteractionStart: () => void;

  // Phase 7: Spectra difference mode quick-toggle
  /** Current spectra view mode */
  spectraViewMode?: SpectraViewMode;
  /** Callback when spectra view mode changes */
  onSpectraViewModeChange?: (mode: SpectraViewMode) => void;
  /** Whether to show absolute differences (vs signed) */
  showAbsoluteDifference?: boolean;
  /** Callback to toggle absolute/signed difference mode */
  onToggleAbsoluteDifference?: () => void;

  // OPT-3: Subset mode
  /** Current subset mode ('all' or 'visible') */
  subsetMode?: 'all' | 'visible';
  /** Callback when subset mode changes */
  onSubsetModeChange?: (mode: 'all' | 'visible') => void;
  /** Subset info from the backend response */
  subsetInfo?: SubsetInfo;
}

// ============= Main Component =============

export const CanvasToolbar = memo(function CanvasToolbar({
  effectiveVisibleCharts,
  onToggleChart,
  toggleableCharts,
  hasFolds,
  hasPartition,
  showFoldsChart,
  hasRepetitions,
  isFetching,
  selectedCount,
  onFilterToSelection,
  partitionFilter,
  onPartitionFilterChange,
  folds,
  totalSamples,
  metadata,
  metrics,
  metricObservations,
  metricFilters = [],
  onMetricFiltersChange,
  onDetectOutliers,
  onFindSimilar,
  selectedSample,
  sampleIds,
  colorConfig,
  onColorConfigChange,
  hasOutliers = false,
  colorContext,
  onInteractionStart,
  // Phase 7: Spectra difference mode
  spectraViewMode,
  onSpectraViewModeChange,
  showAbsoluteDifference = false,
  onToggleAbsoluteDifference,
  // OPT-3: Subset mode
  subsetMode = 'all',
  onSubsetModeChange,
  subsetInfo,
}: CanvasToolbarProps) {
  // hasPartition / hasFolds are now distinct concerns and are passed in directly.

  return (
    <div
      className="flex flex-col border-b border-border bg-card/50"
      role="toolbar"
      aria-label="Chart controls"
    >
      {/* ============= ROW 1: View, Selection, Filter ============= */}
      <div className="flex items-stretch px-2 py-1 gap-0">

        <CanvasToolbarViewGroup
          effectiveVisibleCharts={effectiveVisibleCharts}
          onToggleChart={onToggleChart}
          toggleableCharts={toggleableCharts}
          showFoldsChart={showFoldsChart}
          hasRepetitions={hasRepetitions}
          isFetching={isFetching}
          totalSamples={totalSamples}
          onInteractionStart={onInteractionStart}
          spectraViewMode={spectraViewMode}
          onSpectraViewModeChange={onSpectraViewModeChange}
          showAbsoluteDifference={showAbsoluteDifference}
          onToggleAbsoluteDifference={onToggleAbsoluteDifference}
          subsetMode={subsetMode}
          onSubsetModeChange={onSubsetModeChange}
          subsetInfo={subsetInfo}
        />

        <CanvasToolbarSelectionGroup
          selectedCount={selectedCount}
          onFilterToSelection={onFilterToSelection}
          folds={folds}
          metadata={metadata}
          sampleIds={sampleIds}
          totalSamples={totalSamples}
        />

        <CanvasToolbarFilterGroup
          hasPartition={hasPartition}
          hasFolds={hasFolds}
          partitionFilter={partitionFilter}
          onPartitionFilterChange={onPartitionFilterChange}
          folds={folds}
          totalSamples={totalSamples}
          metrics={metrics}
          metricObservations={metricObservations}
          metricFilters={metricFilters}
          onMetricFiltersChange={onMetricFiltersChange}
          onDetectOutliers={onDetectOutliers}
          onFindSimilar={onFindSimilar}
          selectedSample={selectedSample}
          sampleIds={sampleIds}
        />
      </div>

      {/* ============= ROW 2: Coloration, Reference, Actions ============= */}
      <div className="flex items-stretch px-2 py-1 gap-0 border-t border-border/30">

        <CanvasToolbarColorGroup
          colorConfig={colorConfig}
          onColorConfigChange={onColorConfigChange}
          onInteractionStart={onInteractionStart}
          hasFolds={hasFolds}
          hasPartition={hasPartition}
          hasOutliers={hasOutliers}
          metadata={metadata}
          colorContext={colorContext}
        />

      </div>

    </div>
  );
});

export default CanvasToolbar;
