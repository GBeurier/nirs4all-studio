import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import { toast } from "sonner";
import { ErrorState, LoadingState } from "@/components/ui/state-display";
import { getN4AWorkspacePredictionsData } from "@/api/linkedWorkspaces";
import type { LinkedWorkspace, PredictionRecord } from "@/types/linked-workspaces";
import {
  PredictionsEmptyPanel,
  PredictionsNoWorkspacePanel,
  PredictionsOverlays,
  PredictionsResultsSection,
} from "@/components/predictions/PredictionsPageSections";
import type {
  ChainDetailFocus,
  ChainDetailMetaHint,
} from "@/components/predictions/detail/ChainDetailPanel";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { useMetricSelection } from "@/components/scores/useMetricSelection";
import {
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getMetricAbbreviation,
  getLegacySelectedMetricsForTaskTypes,
} from "@/lib/scores";
import type { ScoreCardRow } from "@/types/score-cards";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import { usePredictionRows } from "@/hooks/usePredictionRows";
import type { MetricTaskFilter } from "@/lib/predictions/rows";
import {
  buildEffectivePredictionMetricContext,
  getInitialPredictionMetricTaskFilter,
  resolvePredictionPrimaryMetricKey,
  selectPredictionQuickView,
} from "@/lib/predictions/pageData";

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
    allRows,
    contextDatasets,
    filteredRows,
    metricContext,
    setCurrentPage,
    setPageSize,
  } = rows;

  const didInitMetricFilter = useRef(false);
  useEffect(() => {
    if (didInitMetricFilter.current) return;
    const initialFilter = getInitialPredictionMetricTaskFilter(allRows);
    if (!initialFilter) {
      if (allRows.length === 0) return;
    } else {
      setMetricTaskFilter(initialFilter);
    }
    didInitMetricFilter.current = true;
  }, [allRows]);

  const effectiveMetricContext = buildEffectivePredictionMetricContext(metricContext, metricTaskFilter);

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
    const selection = selectPredictionQuickView(predictionId, rawPredictions);
    if (!selection) return;
    setQuickViewInitialKind(selection.initialKind);
    setQuickViewPrediction(selection.primary);
    setQuickViewSiblings(selection.siblings);
    setQuickViewOpen(true);
  };

  const handleRefresh = () => {
    refetchWorkspaces();
    refetchPredictions();
  };

  const handlePageSizeChange = (nextPageSize: number) => {
    setPageSize(nextPageSize);
    setCurrentPage(1);
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
      <PredictionsNoWorkspacePanel
        title={t("predictions.title")}
        subtitle={t("predictions.subtitle")}
      />
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
      <PredictionsEmptyPanel
        title={t("predictions.title")}
        workspaceName={activeWorkspace.name}
        refreshLabel={t("common.refresh")}
        onRefresh={handleRefresh}
      />
    );
  }

  const primaryMetricKey = resolvePredictionPrimaryMetricKey({
    effectiveMetricTaskType: effectiveMetricContext.taskType,
    filteredRows,
    selectedMetrics,
  });
  const primaryMetricLabel = getMetricAbbreviation(primaryMetricKey);

  return (
    <motion.div className="space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <PredictionsResultsSection
        title={t("predictions.title")}
        rows={rows}
        workspaceId={activeWorkspace.id}
        workspaceName={activeWorkspace.name}
        predictionsLoading={predictionsLoading}
        metricTaskFilter={metricTaskFilter}
        onMetricTaskFilterChange={setMetricTaskFilter}
        metricTaskType={effectiveMetricContext.taskType}
        selectedMetrics={selectedMetrics}
        onSelectedMetricsChange={setSelectedMetrics}
        availableMetricKeys={effectiveMetricContext.availableMetricKeys}
        primaryMetricLabel={primaryMetricLabel}
        onRefresh={handleRefresh}
        onExport={() => setExportDialogOpen(true)}
        exportDisabled={contextDatasets.length === 0}
        onPageSizeChange={handlePageSizeChange}
        onViewPrediction={handleQuickView}
        onViewDetails={handleViewDetails}
      />

      <PredictionsOverlays
        workspaceId={activeWorkspace.id}
        exportDialogOpen={exportDialogOpen}
        onExportDialogOpenChange={setExportDialogOpen}
        exportDatasets={contextDatasets}
        quickViewPrediction={quickViewPrediction}
        quickViewSiblings={quickViewSiblings}
        quickViewOpen={quickViewOpen}
        onQuickViewOpenChange={setQuickViewOpen}
        quickViewInitialKind={quickViewInitialKind}
        detailChainId={detailChainId}
        detailMetaHint={detailMetaHint}
        detailFocus={detailFocus}
        detailOpen={detailOpen}
        onDetailOpenChange={setDetailOpen}
        detailViewerOpen={detailViewerOpen}
        onDetailViewerOpenChange={setDetailViewerOpen}
        detailViewerPartitions={detailViewerPartitions}
        detailViewerHeader={detailViewerHeader}
        detailViewerKind={detailViewerKind}
        onOpenDetailViewer={(partitions, header, kind) => {
          setDetailViewerPartitions(partitions);
          setDetailViewerHeader(header);
          setDetailViewerKind(kind);
          setDetailViewerOpen(true);
        }}
      />
    </motion.div>
  );
}
