import { Target } from "lucide-react";

import { motion } from "@/lib/motion";
import { EmptyState, NoWorkspaceState } from "@/components/ui/state-display";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";
import { ExportDialog } from "@/components/predictions/ExportDialog";
import { PredictionFilters } from "@/components/predictions/PredictionFilters";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";
import { PredictionsHeader } from "@/components/predictions/PredictionsHeader";
import { PredictionsPagination } from "@/components/predictions/PredictionsPagination";
import { PredictionStats } from "@/components/predictions/PredictionStats";
import { PredictionsTable } from "@/components/predictions/PredictionsTable";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import type {
  ChainDetailFocus,
  ChainDetailMetaHint,
} from "@/components/predictions/detail/ChainDetailPanel";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import type { PredictionRowsState } from "@/hooks/usePredictionRows";
import type { MetricTaskFilter } from "@/lib/predictions/rows";
import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";

interface PredictionsNoWorkspacePanelProps {
  title: string;
  subtitle: string;
}

export function PredictionsNoWorkspacePanel({
  title,
  subtitle,
}: PredictionsNoWorkspacePanelProps) {
  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-muted-foreground">{subtitle}</p>
      </div>
      <NoWorkspaceState
        title="No workspace linked"
        description="Link a nirs4all workspace in Settings to view prediction records."
      />
    </motion.div>
  );
}

interface PredictionsEmptyPanelProps {
  title: string;
  workspaceName: string;
  refreshLabel: string;
  onRefresh: () => void;
}

export function PredictionsEmptyPanel({
  title,
  workspaceName,
  refreshLabel,
  onRefresh,
}: PredictionsEmptyPanelProps) {
  return (
    <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-muted-foreground">Workspace: {workspaceName}</p>
      </div>
      <EmptyState
        icon={Target}
        title="No predictions yet"
        description="Run nirs4all.run() to generate predictions."
        action={{ label: refreshLabel, onClick: onRefresh }}
      />
    </motion.div>
  );
}

interface PredictionsResultsSectionProps {
  title: string;
  rows: PredictionRowsState;
  workspaceId: string;
  workspaceName: string;
  predictionsLoading: boolean;
  metricTaskFilter: MetricTaskFilter;
  onMetricTaskFilterChange: (value: MetricTaskFilter) => void;
  metricTaskType: string | null;
  selectedMetrics: string[];
  onSelectedMetricsChange: (metrics: string[]) => void;
  availableMetricKeys: string[];
  primaryMetricLabel: string;
  onRefresh: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  onPageSizeChange: (nextPageSize: number) => void;
  onViewPrediction: (predictionId: string) => void;
  onViewDetails: (row: ScoreCardRow) => void;
}

export function PredictionsResultsSection({
  title,
  rows,
  workspaceId,
  workspaceName,
  predictionsLoading,
  metricTaskFilter,
  onMetricTaskFilterChange,
  metricTaskType,
  selectedMetrics,
  onSelectedMetricsChange,
  availableMetricKeys,
  primaryMetricLabel,
  onRefresh,
  onExport,
  exportDisabled,
  onPageSizeChange,
  onViewPrediction,
  onViewDetails,
}: PredictionsResultsSectionProps) {
  const headerMetricTaskType = metricTaskType ?? metricTaskFilter;

  return (
    <>
      <PredictionsHeader
        title={title}
        totalScored={rows.stats.total}
        workspaceName={workspaceName}
        predictionsLoading={predictionsLoading}
        metricTaskFilter={metricTaskFilter}
        onMetricTaskFilterChange={onMetricTaskFilterChange}
        metricTaskType={headerMetricTaskType}
        selectedMetrics={selectedMetrics}
        onSelectedMetricsChange={onSelectedMetricsChange}
        availableMetricKeys={availableMetricKeys}
        onRefresh={onRefresh}
        onExport={onExport}
        exportDisabled={exportDisabled}
      />

      <PredictionStats stats={rows.stats} />

      <PredictionFilters
        searchQuery={rows.searchQuery}
        onSearchQueryChange={rows.setSearchQuery}
        filterDataset={rows.filterDataset}
        onFilterDatasetChange={rows.setFilterDataset}
        filterModel={rows.filterModel}
        onFilterModelChange={rows.setFilterModel}
        filterTaskType={rows.filterTaskType}
        onFilterTaskTypeChange={rows.setFilterTaskType}
        datasetOptions={rows.datasetOptions}
        modelOptions={rows.modelOptions}
        taskTypeOptions={rows.taskTypeOptions}
        visibleFoldTypes={rows.visibleFoldTypes}
        onVisibleFoldTypesChange={rows.setVisibleFoldTypes}
        visibleDataKinds={rows.visibleDataKinds}
        onVisibleDataKindsChange={rows.setVisibleDataKinds}
        hasActiveFilters={rows.hasActiveFilters}
        onClearFilters={rows.clearFilters}
      />

      <PredictionsTable
        pageRows={rows.pageRows}
        selectedMetrics={selectedMetrics}
        sortField={rows.sortField}
        sortOrder={rows.sortOrder}
        onSort={rows.handleSort}
        primaryMetricLabel={primaryMetricLabel}
        workspaceId={workspaceId}
        startIndex={rows.startIndex}
        onViewPrediction={onViewPrediction}
        onViewDetails={onViewDetails}
      />

      <PredictionsPagination
        startIndex={rows.startIndex}
        endIndex={rows.endIndex}
        totalCount={rows.totalCount}
        currentPage={rows.currentPage}
        totalPages={rows.totalPages}
        pageSize={rows.pageSize}
        onPageChange={rows.setCurrentPage}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
}

interface PredictionsOverlaysProps {
  workspaceId: string;
  exportDialogOpen: boolean;
  onExportDialogOpenChange: (open: boolean) => void;
  exportDatasets: string[];
  quickViewPrediction: PredictionRecord | null;
  quickViewSiblings: PredictionRecord[];
  quickViewOpen: boolean;
  onQuickViewOpenChange: (open: boolean) => void;
  quickViewInitialKind: ChartKind;
  detailChainId: string | null;
  detailMetaHint: ChainDetailMetaHint | undefined;
  detailFocus: ChainDetailFocus | undefined;
  detailOpen: boolean;
  onDetailOpenChange: (open: boolean) => void;
  detailViewerOpen: boolean;
  onDetailViewerOpenChange: (open: boolean) => void;
  detailViewerPartitions: ViewerPartitionTarget[];
  detailViewerHeader: ViewerHeader | null;
  detailViewerKind: ChartKind;
  onOpenDetailViewer: (
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => void;
}

export function PredictionsOverlays({
  workspaceId,
  exportDialogOpen,
  onExportDialogOpenChange,
  exportDatasets,
  quickViewPrediction,
  quickViewSiblings,
  quickViewOpen,
  onQuickViewOpenChange,
  quickViewInitialKind,
  detailChainId,
  detailMetaHint,
  detailFocus,
  detailOpen,
  onDetailOpenChange,
  detailViewerOpen,
  onDetailViewerOpenChange,
  detailViewerPartitions,
  detailViewerHeader,
  detailViewerKind,
  onOpenDetailViewer,
}: PredictionsOverlaysProps) {
  return (
    <>
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={onExportDialogOpenChange}
        datasets={exportDatasets}
      />

      <PredictionQuickView
        prediction={quickViewPrediction}
        siblings={quickViewSiblings}
        open={quickViewOpen}
        onOpenChange={onQuickViewOpenChange}
        workspaceId={workspaceId}
        initialKind={quickViewInitialKind}
      />

      <ChainDetailSheet
        chainId={detailChainId}
        metaHint={detailMetaHint}
        focus={detailFocus}
        metric={detailMetaHint?.metric ?? null}
        open={detailOpen}
        onOpenChange={onDetailOpenChange}
        isViewerOpen={detailViewerOpen}
        onOpenViewer={onOpenDetailViewer}
      />

      {detailViewerHeader && (
        <PredictionViewer
          open={detailViewerOpen}
          onOpenChange={onDetailViewerOpenChange}
          header={detailViewerHeader}
          partitions={detailViewerPartitions}
          workspaceId={workspaceId}
          initialKind={detailViewerKind}
        />
      )}
    </>
  );
}
