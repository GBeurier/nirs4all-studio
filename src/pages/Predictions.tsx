import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, NoWorkspaceState } from "@/components/ui/state-display";
import { getN4AWorkspacePredictionsData } from "@/api/linkedWorkspaces";
import type { LinkedWorkspace, PredictionRecord } from "@/types/linked-workspaces";
import { PredictionViewer } from "@/components/predictions/viewer/PredictionViewer";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";
import { PredictionFilters } from "@/components/predictions/PredictionFilters";
import { PredictionStats } from "@/components/predictions/PredictionStats";
import { PredictionsHeader } from "@/components/predictions/PredictionsHeader";
import { PredictionsTable } from "@/components/predictions/PredictionsTable";
import { ExportDialog } from "@/components/predictions/ExportDialog";
import { ChainDetailSheet } from "@/components/predictions/ChainDetailSheet";
import type {
  ChainDetailFocus,
  ChainDetailMetaHint,
} from "@/components/predictions/detail/ChainDetailPanel";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { useMetricSelection } from "@/components/scores/MetricSelector";
import {
  canonicalMetricKey,
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getMetricAbbreviation,
  getMetricDefinitions,
  getLegacySelectedMetricsForTaskTypes,
  isClassificationTaskType,
  orderMetricKeys,
} from "@/lib/scores";
import type { ScoreCardRow } from "@/types/score-cards";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import { usePredictionRows } from "@/hooks/usePredictionRows";
import { predictionGroupKey, type MetricTaskFilter } from "@/lib/predictions/rows";

const FETCH_PAGE_SIZE = 1000;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  return fallback;
}

async function getAllPredictionRecords(workspaceId: string): Promise<PredictionRecord[]> {
  const records: PredictionRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await getN4AWorkspacePredictionsData(workspaceId, {
      limit: FETCH_PAGE_SIZE,
      offset,
    });
    records.push(...page.records);
    if (!page.has_more || page.records.length === 0) break;
    offset += page.records.length;
  }

  return records;
}

export default function Predictions() {
  const { t } = useTranslation();
  const [quickViewPrediction, setQuickViewPrediction] = useState<PredictionRecord | null>(null);
  const [quickViewSiblings, setQuickViewSiblings] = useState<PredictionRecord[]>([]);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewInitialKind, setQuickViewInitialKind] = useState<ChartKind>("scatter");
  const [detailChainId, setDetailChainId] = useState<string | null>(null);
  const [detailMetaHint, setDetailMetaHint] = useState<ChainDetailMetaHint | undefined>(undefined);
  const [detailFocus, setDetailFocus] = useState<ChainDetailFocus | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailViewerOpen, setDetailViewerOpen] = useState(false);
  const [detailViewerPartitions, setDetailViewerPartitions] = useState<ViewerPartitionTarget[]>([]);
  const [detailViewerHeader, setDetailViewerHeader] = useState<ViewerHeader | null>(null);
  const [detailViewerKind, setDetailViewerKind] = useState<ChartKind>("scatter");
  const [metricTaskFilter, setMetricTaskFilter] = useState<MetricTaskFilter>("regression");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const {
    data: workspacesData,
    isLoading: workspacesLoading,
    error: workspacesError,
    refetch: refetchWorkspaces,
  } = useLinkedWorkspacesQuery();

  const activeWorkspace: LinkedWorkspace | null = workspacesData?.workspaces.find(workspace => workspace.is_active) ?? null;

  const {
    data: rawPredictions = [],
    isLoading: predictionsLoading,
    error: predictionsError,
    refetch: refetchPredictions,
  } = useQuery({
    queryKey: ["workspace-prediction-records", activeWorkspace?.id],
    queryFn: () => getAllPredictionRecords(activeWorkspace!.id),
    enabled: !!activeWorkspace,
    staleTime: 30000,
  });

  const rows = usePredictionRows(rawPredictions, metricTaskFilter);
  const {
    allRows, contextDatasets, datasetOptions, modelOptions, taskTypeOptions,
    filteredRows, pageRows, stats, metricContext,
    searchQuery, setSearchQuery, filterDataset, setFilterDataset,
    filterModel, setFilterModel, filterTaskType, setFilterTaskType,
    visibleFoldTypes, setVisibleFoldTypes, visibleDataKinds, setVisibleDataKinds,
    sortField, sortOrder, handleSort,
    currentPage, setCurrentPage, pageSize, setPageSize,
    totalCount, totalPages, startIndex, endIndex,
    hasActiveFilters, clearFilters,
  } = rows;

  const didInitMetricFilter = useRef(false);
  useEffect(() => {
    if (didInitMetricFilter.current) return;
    if (allRows.length === 0) return;
    const hasClassification = allRows.some(row => isClassificationTaskType(row.taskType));
    const hasRegression = allRows.some(row => row.taskType && !isClassificationTaskType(row.taskType));
    if (hasClassification && !hasRegression) setMetricTaskFilter("classification");
    didInitMetricFilter.current = true;
  }, [allRows]);

  const effectiveMetricContext = (() => {
    const filteredKeys = orderMetricKeys(
      metricContext.availableMetricKeys.filter(key => {
        const def = getMetricDefinitions([key])[0];
        if (!def) return true;
        if (def.group === "general") return true;
        if (metricTaskFilter === "regression") return def.group === "regression";
        return def.group === "multiclass" || def.group === "binary";
      }),
    );
    return {
      taskType: metricTaskFilter,
      taskTypes: [metricTaskFilter],
      availableMetricKeys: filteredKeys,
    };
  })();

  const [selectedMetrics, setSelectedMetrics] = useMetricSelection(
    "predictions",
    effectiveMetricContext.taskType,
    getDefaultSelectedMetricsForTaskTypes(effectiveMetricContext.taskTypes),
    getLegacySelectedMetricsForTaskTypes(effectiveMetricContext.taskTypes),
    `task-aware-defaults-v1:${metricTaskFilter}`,
    effectiveMetricContext.availableMetricKeys,
    getDefaultSelectionUpgradeCandidatesForTaskTypes(effectiveMetricContext.taskTypes),
  );

  const handleViewDetails = (row: ScoreCardRow) => {
    if (!row.chainId) {
      toast.error("Missing chain id for this row");
      return;
    }
    setDetailChainId(row.chainId);
    setDetailMetaHint({
      modelName: row.modelName,
      modelClass: row.modelClass,
      datasetName: row.datasetName,
      metric: row.metric,
      taskType: row.taskType ?? null,
      preprocessings: row.preprocessings,
    });
    setDetailFocus({
      cardType: row.cardType,
      foldId: row.foldId ?? null,
      predictionId: row.cardType === "train" ? row.id : null,
    });
    setDetailOpen(true);
  };

  const handleQuickView = (predictionId: string) => {
    const prediction = rawPredictions.find(record => record.id === predictionId);
    if (!prediction) return;
    // Collect all records that belong to the same (dataset, pipeline, fold) group
    const key = predictionGroupKey(prediction);
    const siblings = rawPredictions.filter(r => predictionGroupKey(r) === key);
    const primary = siblings.find(r => r.partition === "test") ?? siblings.find(r => r.partition === "val") ?? prediction;
    setQuickViewInitialKind("scatter");
    setQuickViewPrediction(primary);
    setQuickViewSiblings(siblings.length > 0 ? siblings : [prediction]);
    setQuickViewOpen(true);
  };

  const handleRefresh = () => {
    refetchWorkspaces();
    refetchPredictions();
  };

  if (workspacesLoading) {
    return <LoadingState message={t("predictions.loading")} className="min-h-[400px]" />;
  }

  if (workspacesError) {
    return (
      <ErrorState
        title={t("predictions.error")}
        message={getErrorMessage(workspacesError, t("predictions.errorLoad"))}
        onRetry={() => refetchWorkspaces()}
        retryLabel={t("common.refresh")}
      />
    );
  }

  if (!activeWorkspace) {
    return (
      <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("predictions.subtitle")}</p>
        </div>
        <NoWorkspaceState title="No workspace linked" description="Link a nirs4all workspace in Settings to view prediction records." />
      </motion.div>
    );
  }

  if (predictionsLoading) {
    return <LoadingState message={t("predictions.loading")} className="min-h-[400px]" />;
  }

  if (predictionsError) {
    return (
      <ErrorState
        title={t("predictions.error")}
        message={getErrorMessage(predictionsError, t("predictions.errorLoad"))}
        onRetry={() => refetchPredictions()}
        retryLabel={t("common.refresh")}
      />
    );
  }

  if (allRows.length === 0) {
    return (
      <motion.div className="space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">Workspace: {activeWorkspace.name}</p>
        </div>
        <EmptyState icon={Target} title="No predictions yet" description="Run nirs4all.run() to generate predictions." action={{ label: t("common.refresh"), onClick: handleRefresh }} />
      </motion.div>
    );
  }

  const primaryMetricKey = canonicalMetricKey(filteredRows.find(row => row.metric)?.metric)
    || selectedMetrics[0]
    || (isClassificationTaskType(effectiveMetricContext.taskType) ? "accuracy" : "rmse");
  const primaryMetricLabel = getMetricAbbreviation(primaryMetricKey);

  return (
    <motion.div className="space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PredictionsHeader
        title={t("predictions.title")}
        totalScored={stats.total}
        workspaceName={activeWorkspace.name}
        predictionsLoading={predictionsLoading}
        metricTaskFilter={metricTaskFilter}
        onMetricTaskFilterChange={setMetricTaskFilter}
        metricTaskType={effectiveMetricContext.taskType}
        selectedMetrics={selectedMetrics}
        onSelectedMetricsChange={setSelectedMetrics}
        availableMetricKeys={effectiveMetricContext.availableMetricKeys}
        onRefresh={handleRefresh}
        onExport={() => setExportDialogOpen(true)}
        exportDisabled={contextDatasets.length === 0}
      />

      <PredictionStats stats={stats} />

      <PredictionFilters
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filterDataset={filterDataset}
        onFilterDatasetChange={setFilterDataset}
        filterModel={filterModel}
        onFilterModelChange={setFilterModel}
        filterTaskType={filterTaskType}
        onFilterTaskTypeChange={setFilterTaskType}
        datasetOptions={datasetOptions}
        modelOptions={modelOptions}
        taskTypeOptions={taskTypeOptions}
        visibleFoldTypes={visibleFoldTypes}
        onVisibleFoldTypesChange={setVisibleFoldTypes}
        visibleDataKinds={visibleDataKinds}
        onVisibleDataKindsChange={setVisibleDataKinds}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

        <PredictionsTable
          pageRows={pageRows}
          selectedMetrics={selectedMetrics}
          sortField={sortField}
          sortOrder={sortOrder}
          onSort={handleSort}
          primaryMetricLabel={primaryMetricLabel}
          workspaceId={activeWorkspace.id}
          startIndex={startIndex}
          onViewPrediction={handleQuickView}
          onViewDetails={handleViewDetails}
        />

        {totalCount > 0 && (
          <div className="flex items-center justify-between px-1 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Showing {startIndex + 1}-{endIndex} of {totalCount}</span>
              <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[85px] h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 200, 500, 1000].map(size => <SelectItem key={size} value={String(size)}>{size}/page</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-0.5">
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
                <ChevronsLeft className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(page => Math.max(1, page - 1))} disabled={currentPage === 1}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="px-2 text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
                <ChevronsRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        <ExportDialog open={exportDialogOpen} onOpenChange={setExportDialogOpen} datasets={contextDatasets} />

        <PredictionQuickView
          prediction={quickViewPrediction}
          siblings={quickViewSiblings}
          open={quickViewOpen}
          onOpenChange={setQuickViewOpen}
          workspaceId={activeWorkspace.id}
          initialKind={quickViewInitialKind}
        />

        <ChainDetailSheet
          chainId={detailChainId}
          metaHint={detailMetaHint}
          focus={detailFocus}
          metric={detailMetaHint?.metric ?? null}
          open={detailOpen}
          onOpenChange={setDetailOpen}
          isViewerOpen={detailViewerOpen}
          onOpenViewer={(partitions, header, kind) => {
            setDetailViewerPartitions(partitions);
            setDetailViewerHeader(header);
            setDetailViewerKind(kind);
            setDetailViewerOpen(true);
          }}
        />

        {detailViewerHeader && (
          <PredictionViewer
            open={detailViewerOpen}
            onOpenChange={setDetailViewerOpen}
            header={detailViewerHeader}
            partitions={detailViewerPartitions}
            workspaceId={activeWorkspace.id}
            initialKind={detailViewerKind}
          />
        )}
    </motion.div>
  );
}
