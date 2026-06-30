import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getAggregatedPredictions,
  getChainPartitionDetail,
  runAggregatedPredictionsQuery,
  type AggregatedSQLQueryResponse,
} from "@/api/aggregatedPredictions";
import { useIsDeveloperMode } from "@/context/useDeveloperMode";
import { useMlReadiness } from "@/context/useMlReadiness";
import {
  buildAggregatedResultsFacets,
  buildAggregatedResultsStats,
  buildPredictionViewerStateFromSiblings,
  filterAndSortAggregatedResults,
  nextAggregatedResultsSortState,
  selectBestViewerPredictionGroup,
  splitAggregatedResultsSections,
  type AggregatedResultsSortKey,
} from "@/lib/aggregatedResultsData";
import { collapseStandaloneRefitSummaries } from "@/lib/score-adapters";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";

const DEFAULT_AGGREGATED_RESULTS_SQL =
  "SELECT dataset_name, COUNT(*) AS predictions FROM predictions GROUP BY 1 ORDER BY 2 DESC";

export function useAggregatedResultsPageState() {
  const isDeveloperMode = useIsDeveloperMode();
  const { workspaceReady } = useMlReadiness();
  const { data: workspacesData } = useLinkedWorkspacesQuery();
  const activeWorkspace = workspacesData?.workspaces.find((workspace) => workspace.is_active) ?? null;

  const [predictions, setPredictions] = useState<ChainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [datasetFilter, setDatasetFilter] = useState("all");
  const [modelClassFilter, setModelClassFilter] = useState("all");
  const [metricFilter, setMetricFilter] = useState("all");
  const [sortKey, setSortKey] = useState<AggregatedResultsSortKey>("cv_val");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedPrediction, setSelectedPrediction] = useState<ChainSummary | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expandedChainId, setExpandedChainId] = useState<string | null>(null);
  const [viewerPartitions, setViewerPartitions] = useState<ViewerPartitionTarget[]>([]);
  const [viewerHeader, setViewerHeader] = useState<ViewerHeader | null>(null);
  const [viewerInitialKind, setViewerInitialKind] = useState<ChartKind | undefined>(undefined);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [sql, setSql] = useState(DEFAULT_AGGREGATED_RESULTS_SQL);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlResult, setSqlResult] = useState<AggregatedSQLQueryResponse | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await getAggregatedPredictions();
      setPredictions(resp.predictions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load aggregated predictions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    // Re-run after workspace_ready flips to replace any empty initial result
    // that raced the backend workspace restoration phase.
  }, [loadData, workspaceReady]);

  const displayPredictions = useMemo(
    () => collapseStandaloneRefitSummaries(predictions),
    [predictions],
  );

  const facets = useMemo(
    () => buildAggregatedResultsFacets(displayPredictions),
    [displayPredictions],
  );

  const filtered = useMemo(() => {
    return filterAndSortAggregatedResults(
      displayPredictions,
      {
        search,
        datasetFilter,
        modelClassFilter,
        metricFilter,
      },
      { sortKey, sortAsc },
    );
  }, [displayPredictions, search, datasetFilter, modelClassFilter, metricFilter, sortKey, sortAsc]);

  const { refitFiltered, cvFiltered } = useMemo(
    () => splitAggregatedResultsSections(filtered),
    [filtered],
  );

  const stats = useMemo(
    () => buildAggregatedResultsStats(displayPredictions),
    [displayPredictions],
  );

  const hasActiveFilters = search !== "" || datasetFilter !== "all" || modelClassFilter !== "all" || metricFilter !== "all";

  const emptyError = error && displayPredictions.length === 0 ? error : null;
  const isNoWorkspaceError = emptyError ? emptyError.includes("No workspace") || emptyError.includes("409") : false;

  const selectedChainId = selectedPrediction?.chain_id ?? null;
  const selectedMetric = selectedPrediction?.metric ?? null;
  const selectedDetailMetaHint = useMemo(() => {
    if (!selectedPrediction) return undefined;
    return {
      modelName: selectedPrediction.model_name,
      modelClass: selectedPrediction.model_class,
      datasetName: selectedPrediction.dataset_name,
      metric: selectedPrediction.metric,
      taskType: selectedPrediction.task_type,
      preprocessings: selectedPrediction.preprocessings,
      pipelineStatus: selectedPrediction.pipeline_status,
    };
  }, [selectedPrediction]);
  const selectedDetailFocus = useMemo(() => {
    if (!selectedPrediction) return undefined;
    const isRefit = selectedPrediction.final_test_score != null;
    return {
      cardType: isRefit ? "refit" : "crossval",
      foldId: isRefit ? "final" : "avg",
    } as const;
  }, [selectedPrediction]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setDatasetFilter("all");
    setModelClassFilter("all");
    setMetricFilter("all");
  }, []);

  const handleSort = useCallback((key: AggregatedResultsSortKey) => {
    const nextSort = nextAggregatedResultsSortState({ sortKey, sortAsc }, key);
    setSortKey(nextSort.sortKey);
    setSortAsc(nextSort.sortAsc);
  }, [sortAsc, sortKey]);

  const openPredictionDetails = useCallback((prediction: ChainSummary) => {
    setSelectedPrediction(prediction);
    setSheetOpen(true);
  }, []);

  const openViewer = useCallback((
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind: ChartKind,
  ) => {
    setViewerPartitions(partitions);
    setViewerHeader(header);
    setViewerInitialKind(kind);
    setViewerOpen(true);
  }, []);

  const handleViewPrediction = useCallback((_predictionId: string, siblings: PartitionPrediction[]) => {
    const viewerState = buildPredictionViewerStateFromSiblings(siblings);
    if (!viewerState) return;
    openViewer(viewerState.partitions, viewerState.header, viewerState.initialKind);
  }, [openViewer]);

  const handleViewChainChart = useCallback(async (pred: ChainSummary) => {
    try {
      const detail = await getChainPartitionDetail(pred.chain_id);
      const allPreds: PartitionPrediction[] = detail.predictions || [];
      if (allPreds.length === 0) {
        toast.error("No predictions found for this model");
        return;
      }
      const bestGroup = selectBestViewerPredictionGroup(allPreds);
      handleViewPrediction("", bestGroup);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load predictions");
    }
  }, [handleViewPrediction]);

  const handleRunSql = useCallback(async () => {
    setSqlLoading(true);
    setSqlError(null);
    try {
      const result = await runAggregatedPredictionsQuery(sql);
      setSqlResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to run query";
      setSqlError(message);
      toast.error(message);
    } finally {
      setSqlLoading(false);
    }
  }, [sql]);

  return {
    activeWorkspaceId: activeWorkspace?.id,
    clearFilters,
    cvFiltered,
    datasetFilter,
    displayPredictions,
    emptyError,
    error,
    expandedChainId,
    facets,
    filtered,
    handleRunSql,
    handleSort,
    handleViewChainChart,
    handleViewPrediction,
    hasActiveFilters,
    isDeveloperMode,
    isNoWorkspaceError,
    loadData,
    loading,
    metricFilter,
    modelClassFilter,
    openPredictionDetails,
    openViewer,
    refitFiltered,
    search,
    selectedChainId,
    selectedDetailFocus,
    selectedDetailMetaHint,
    selectedMetric,
    setDatasetFilter,
    setExpandedChainId,
    setMetricFilter,
    setModelClassFilter,
    setSearch,
    setSheetOpen,
    setSql,
    setViewerOpen,
    sheetOpen,
    sortAsc,
    sortKey,
    sql,
    sqlError,
    sqlLoading,
    sqlResult,
    stats,
    viewerHeader,
    viewerInitialKind,
    viewerOpen,
    viewerPartitions,
  };
}
