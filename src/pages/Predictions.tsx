import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { motion } from "@/lib/motion";
import {
  ArrowUpDown, Brain, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Database, Download, Loader2, RefreshCw, Search, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { EmptyState, ErrorState, LoadingState, NoWorkspaceState } from "@/components/ui/state-display";
import {
  exportAggregatedPredictions,
  getN4AWorkspacePredictionsData,
} from "@/api/client";
import type { LinkedWorkspace, PredictionRecord } from "@/types/linked-workspaces";
import { PredictionQuickView } from "@/components/predictions/PredictionQuickView";
import { MetricSelector, useMetricSelection } from "@/components/scores/MetricSelector";
import { ScoreCardRowView } from "@/components/scores/ScoreCardRowView";
import type { ModelActionChartView } from "@/components/scores/ModelActionMenu";
import { predictionRecordBestParams, predictionRecordToRow } from "@/lib/score-adapters";
import { FOLD_ORDER, foldIdBase } from "@/lib/fold-utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  collectPresentMetricKeys,
  getAvailableMetricKeysForTaskTypes,
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getMetricAbbreviation,
  getMetricDefinitions,
  getLegacySelectedMetricsForTaskTypes,
  isClassificationTaskType,
  isLowerBetter,
  orderMetricKeys,
} from "@/lib/scores";
import type { ScoreCardRow } from "@/types/score-cards";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import type { PredictionQuickViewTab } from "@/components/predictions/PredictionQuickView";

const FETCH_PAGE_SIZE = 1000;
const ALL_FOLD_TYPES = ["folds", "refits", "averages"] as const;
const ALL_DATA_KINDS = ["raw", "aggregated"] as const;
const toggleItemClass = "h-7 px-2 text-[11px] border-border/60 hover:bg-muted/60 hover:text-foreground data-[state=on]:border-primary/40 data-[state=on]:bg-primary/10 data-[state=on]:text-primary";

type SortField =
  | "model_name"
  | "dataset_name"
  | "fold"
  | "val_score"
  | "test_score"
  | "n_samples"
  | "card_type"
  | "preproc"
  | `metric:${string}`;
type SortOrder = "asc" | "desc";
type FoldVisibility = typeof ALL_FOLD_TYPES[number];
type DataVisibility = typeof ALL_DATA_KINDS[number];
type MetricTaskFilter = "regression" | "classification";

const CARD_TYPE_ORDER: Record<string, number> = { refit: 0, crossval: 1, train: 2 };

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

function predictionGroupKey(pred: PredictionRecord): string {
  return [
    pred.source_dataset || pred.dataset_name || "",
    pred.trace_id || pred.pipeline_uid || pred.id,
    pred.fold_id || "unknown",
  ].join("::");
}

function foldSortValue(foldId?: string): number {
  if (!foldId) return Number.MAX_SAFE_INTEGER;
  const baseFoldId = foldIdBase(foldId);
  const aggOffset = foldId === baseFoldId ? 0 : 0.5;
  if (baseFoldId in FOLD_ORDER) return FOLD_ORDER[baseFoldId] + aggOffset;
  const parsed = Number.parseInt(baseFoldId, 10);
  return Number.isFinite(parsed) ? 100 + parsed + aggOffset : 1000 + aggOffset;
}

function rowFoldVisibility(row: ScoreCardRow): FoldVisibility {
  if (row.cardType === "refit") return "refits";
  if (row.cardType === "crossval") return "averages";
  return "folds";
}

function rowDataVisibility(row: ScoreCardRow): DataVisibility {
  const foldId = row.foldId;
  if (!foldId) return "raw";
  return foldId === foldIdBase(foldId) ? "raw" : "aggregated";
}

function buildPredictionModelRows(predictions: PredictionRecord[]): ScoreCardRow[] {
  const groups = new Map<string, PredictionRecord[]>();

  for (const pred of predictions) {
    const key = predictionGroupKey(pred);
    const group = groups.get(key) ?? [];
    group.push(pred);
    groups.set(key, group);
  }

  return [...groups.values()].map(group => {
    const testPred = group.find(pred => pred.partition === "test");
    const valPred = group.find(pred => pred.partition === "val");
    const trainPred = group.find(pred => pred.partition === "train");
    const primary = testPred ?? valPred ?? trainPred ?? group[0];

    const row = predictionRecordToRow(primary);

    if (valPred && valPred !== primary) {
      const valRow = predictionRecordToRow(valPred);
      Object.assign(row.valScores, valRow.valScores);
      if (valRow.primaryValScore != null) row.primaryValScore = valRow.primaryValScore;
    }
    if (trainPred && trainPred !== primary) {
      const trainRow = predictionRecordToRow(trainPred);
      Object.assign(row.trainScores, trainRow.trainScores);
      if (trainRow.primaryTrainScore != null) row.primaryTrainScore = trainRow.primaryTrainScore;
    }
    if (testPred && testPred !== primary) {
      const testRow = predictionRecordToRow(testPred);
      Object.assign(row.testScores, testRow.testScores);
      if (testRow.primaryTestScore != null) row.primaryTestScore = testRow.primaryTestScore;
    }

    row.id = primary.id;
    row.chainId = primary.trace_id || row.chainId;
    row.datasetName = primary.source_dataset || primary.dataset_name || row.datasetName;
    row.modelName = primary.model_name || row.modelName;
    row.modelClass = primary.model_classname || row.modelClass;
    row.preprocessings = primary.preprocessings || row.preprocessings;
    row.bestParams = predictionRecordBestParams(primary)
      ?? (valPred ? predictionRecordBestParams(valPred) : null)
      ?? (testPred ? predictionRecordBestParams(testPred) : null)
      ?? (trainPred ? predictionRecordBestParams(trainPred) : null)
      ?? row.bestParams;
    row.foldId = primary.fold_id;
    row.partition = undefined;
    row.nSamplesEval = testPred?.n_samples ?? valPred?.n_samples ?? primary.n_samples ?? row.nSamplesEval;
    row.nSamplesTrain = trainPred?.n_samples ?? null;
    row.hasRefitArtifact = primary.fold_id === "final" && group.some(pred => !!pred.model_artifact_id);

    return row;
  });
}

export default function Predictions() {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDataset, setFilterDataset] = useState("all");
  const [filterModel, setFilterModel] = useState("all");
  const [filterTaskType, setFilterTaskType] = useState("all");
  const [sortField, setSortField] = useState<SortField>("test_score");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [quickViewPrediction, setQuickViewPrediction] = useState<PredictionRecord | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);
  const [quickViewInitialTab, setQuickViewInitialTab] = useState<PredictionQuickViewTab>("scatter");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [metricTaskFilter, setMetricTaskFilter] = useState<MetricTaskFilter>("regression");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportSelection, setExportSelection] = useState<Set<string>>(new Set());
  const [isExporting, setIsExporting] = useState(false);
  const [visibleFoldTypes, setVisibleFoldTypes] = useState<FoldVisibility[]>(["refits"]);
  const [visibleDataKinds, setVisibleDataKinds] = useState<DataVisibility[]>([...ALL_DATA_KINDS]);

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

  const allRows = useMemo<ScoreCardRow[]>(() => buildPredictionModelRows(rawPredictions), [rawPredictions]);

  const datasets = useMemo(
    () => [...new Set(allRows.map(row => row.datasetName).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );

  const models = useMemo(
    () => [...new Set(allRows.map(row => row.modelName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );

  const taskTypes = useMemo(
    () => [...new Set(allRows.map(row => row.taskType).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [allRows],
  );

  const pipelinesCount = useMemo(
    () => new Set(rawPredictions.map(pred => pred.trace_id || pred.pipeline_uid || pred.id).filter(Boolean)).size,
    [rawPredictions],
  );

  const stats = useMemo(() => ({
    total: allRows.length,
    datasets: new Set(allRows.map(row => row.datasetName).filter(Boolean)).size,
    models: new Set(allRows.map(row => row.modelName).filter(Boolean)).size,
    pipelines: pipelinesCount,
  }), [allRows, pipelinesCount]);

  const filteredRows = useMemo(() => {
    let rows = allRows;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter(row =>
        row.modelName.toLowerCase().includes(query)
        || (row.datasetName || "").toLowerCase().includes(query)
        || (row.preprocessings || "").toLowerCase().includes(query)
      );
    }

    if (filterDataset !== "all") rows = rows.filter(row => row.datasetName === filterDataset);
    if (filterModel !== "all") rows = rows.filter(row => row.modelName === filterModel || row.modelClass === filterModel);
    if (filterTaskType !== "all") rows = rows.filter(row => row.taskType === filterTaskType);

    rows = rows.filter(row => {
      const isClass = isClassificationTaskType(row.taskType);
      return metricTaskFilter === "classification" ? isClass : !isClass;
    });

    rows = rows.filter(row =>
      visibleFoldTypes.includes(rowFoldVisibility(row))
      && visibleDataKinds.includes(rowDataVisibility(row)),
    );

    const referenceMetric = rows.find(row => row.metric)?.metric || "rmse";
    const metricSortKey = sortField.startsWith("metric:") ? sortField.slice("metric:".length) : null;
    const scoreMetricForSort = metricSortKey
      ?? (sortField === "test_score" || sortField === "val_score" ? referenceMetric : null);
    const naturalScoreOrder: SortOrder = isLowerBetter(scoreMetricForSort || referenceMetric) ? "asc" : "desc";
    const scoreValue = (row: ScoreCardRow, key: string, partition: "test" | "val"): number => {
      const maps = partition === "test"
        ? [row.testScores, row.aggregatedTestScores, row.avgTestScores, row.wAvgTestScores, row.meanTestScores]
        : [row.valScores, row.avgValScores, row.meanValScores];
      for (const map of maps) {
        const value = map?.[key];
        if (value != null && Number.isFinite(value)) return value;
      }
      return Number.POSITIVE_INFINITY;
    };

    return [...rows].sort((a, b) => {
      let cmp = 0;

      if (metricSortKey) {
        cmp = scoreValue(a, metricSortKey, "test") - scoreValue(b, metricSortKey, "test");
      } else {
        switch (sortField) {
          case "test_score":
            cmp = (a.primaryTestScore ?? Number.POSITIVE_INFINITY) - (b.primaryTestScore ?? Number.POSITIVE_INFINITY);
            break;
          case "val_score":
            cmp = (a.primaryValScore ?? Number.POSITIVE_INFINITY) - (b.primaryValScore ?? Number.POSITIVE_INFINITY);
            break;
          case "n_samples":
            cmp = (a.nSamplesEval ?? 0) - (b.nSamplesEval ?? 0);
            break;
          case "fold":
            cmp = foldSortValue(a.foldId) - foldSortValue(b.foldId);
            break;
          case "model_name":
            cmp = a.modelName.localeCompare(b.modelName);
            break;
          case "dataset_name":
            cmp = (a.datasetName || "").localeCompare(b.datasetName || "");
            break;
          case "card_type":
            cmp = (CARD_TYPE_ORDER[a.cardType] ?? 99) - (CARD_TYPE_ORDER[b.cardType] ?? 99);
            break;
          case "preproc":
            cmp = (a.preprocessings || "").localeCompare(b.preprocessings || "");
            break;
        }
      }

      const isScoreSort = metricSortKey != null || sortField === "test_score" || sortField === "val_score";
      if (isScoreSort && sortOrder !== naturalScoreOrder) {
        return -cmp;
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });
  }, [allRows, filterDataset, filterModel, filterTaskType, metricTaskFilter, visibleDataKinds, visibleFoldTypes, searchQuery, sortField, sortOrder]);

  const didInitMetricFilter = useRef(false);
  useEffect(() => {
    if (didInitMetricFilter.current) return;
    if (allRows.length === 0) return;
    const hasClassification = allRows.some(row => isClassificationTaskType(row.taskType));
    const hasRegression = allRows.some(row => row.taskType && !isClassificationTaskType(row.taskType));
    if (hasClassification && !hasRegression) setMetricTaskFilter("classification");
    didInitMetricFilter.current = true;
  }, [allRows]);

  const metricContext = useMemo(() => {
    const taskTypes = new Set<string>();
    const availableMetricKeys = new Set<string>();
    const sourceRows = filteredRows.length > 0 ? filteredRows : allRows;

    for (const row of sourceRows) {
      if (isClassificationTaskType(row.taskType)) {
        taskTypes.add("classification");
      } else if (row.taskType) {
        taskTypes.add("regression");
      }

      if (
        row.metric
        && (
          row.primaryTestScore != null
          || row.primaryValScore != null
          || row.primaryTrainScore != null
        )
      ) {
        availableMetricKeys.add(row.metric);
      }

      for (const key of collectPresentMetricKeys(
        row.testScores as Record<string, unknown>,
        row.valScores as Record<string, unknown>,
        row.trainScores as Record<string, unknown>,
        row.avgValScores as Record<string, unknown> | undefined,
        row.avgTestScores as Record<string, unknown> | undefined,
        row.wAvgTestScores as Record<string, unknown> | undefined,
        row.meanValScores as Record<string, unknown> | undefined,
        row.meanTestScores as Record<string, unknown> | undefined,
        row.minValScores as Record<string, unknown> | undefined,
        row.maxValScores as Record<string, unknown> | undefined,
        row.minTestScores as Record<string, unknown> | undefined,
        row.maxTestScores as Record<string, unknown> | undefined,
        row.aggregatedTestScores as Record<string, unknown> | undefined,
        row.aggregatedTrainScores as Record<string, unknown> | undefined,
      )) {
        availableMetricKeys.add(key);
      }
    }

    return {
      taskType: taskTypes.size === 1 ? [...taskTypes][0] : null,
      taskTypes: [...taskTypes],
      availableMetricKeys: orderMetricKeys([
        ...availableMetricKeys,
        ...getAvailableMetricKeysForTaskTypes(taskTypes),
      ]),
    };
  }, [allRows, filteredRows]);

  const effectiveMetricContext = useMemo(() => {
    const filteredKeys = orderMetricKeys(
      metricContext.availableMetricKeys.filter(key => {
        const def = getMetricDefinitions([key])[0];
        if (!def) return true;
        return def.group === "general" || def.group === metricTaskFilter;
      }),
    );
    return {
      taskType: metricTaskFilter,
      taskTypes: [metricTaskFilter],
      availableMetricKeys: filteredKeys,
    };
  }, [metricContext, metricTaskFilter]);

  const [selectedMetrics, setSelectedMetrics] = useMetricSelection(
    "predictions",
    effectiveMetricContext.taskType,
    getDefaultSelectedMetricsForTaskTypes(effectiveMetricContext.taskTypes),
    getLegacySelectedMetricsForTaskTypes(effectiveMetricContext.taskTypes),
    `task-aware-defaults-v1:${metricTaskFilter}`,
    effectiveMetricContext.availableMetricKeys,
    getDefaultSelectionUpgradeCandidatesForTaskTypes(effectiveMetricContext.taskTypes),
  );

  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalCount);
  const pageRows = useMemo(
    () => filteredRows.slice(startIndex, startIndex + pageSize),
    [filteredRows, pageSize, startIndex],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterDataset, filterModel, filterTaskType, metricTaskFilter, visibleDataKinds, visibleFoldTypes, sortField, sortOrder]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    const metricSortKey = field.startsWith("metric:") ? field.slice("metric:".length) : null;
    const referenceMetric = filteredRows.find(row => row.metric)?.metric || "rmse";
    const scoreMetric = metricSortKey
      ?? (field === "test_score" || field === "val_score" ? referenceMetric : null);
    const isScoreSort = metricSortKey != null || field === "test_score" || field === "val_score";
    const naturalScoreOrder: SortOrder = isLowerBetter(scoreMetric || referenceMetric) ? "asc" : "desc";

    setSortField(field);
    setSortOrder(isScoreSort ? naturalScoreOrder : "asc");
  };

  const handleQuickView = (predictionId: string) => {
    const prediction = rawPredictions.find(record => record.id === predictionId);
    if (!prediction) return;
    setQuickViewInitialTab("scatter");
    setQuickViewPrediction(prediction);
    setQuickViewOpen(true);
  };

  const handleOpenChart = (row: ScoreCardRow, view: ModelActionChartView) => {
    const prediction = rawPredictions.find(record => record.id === row.id);
    if (!prediction) return;
    setQuickViewInitialTab(view);
    setQuickViewPrediction(prediction);
    setQuickViewOpen(true);
  };

  const clearFilters = () => {
    setFilterDataset("all");
    setFilterModel("all");
    setFilterTaskType("all");
    setSearchQuery("");
    setVisibleFoldTypes([...ALL_FOLD_TYPES]);
    setVisibleDataKinds([...ALL_DATA_KINDS]);
  };

  const hasActiveFilters = (
    filterDataset !== "all"
    || filterModel !== "all"
    || filterTaskType !== "all"
    || !!searchQuery
    || visibleFoldTypes.length < ALL_FOLD_TYPES.length
    || visibleDataKinds.length < ALL_DATA_KINDS.length
  );

  const openExportDialog = (names?: string[]) => {
    setExportSelection(new Set(names && names.length > 0 ? names : datasets));
    setExportDialogOpen(true);
  };

  const toggleExportDataset = (datasetName: string) => {
    const next = new Set(exportSelection);
    if (next.has(datasetName)) next.delete(datasetName);
    else next.add(datasetName);
    setExportSelection(next);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleExportPredictions = async () => {
    const datasetNames = Array.from(exportSelection);
    if (datasetNames.length === 0) {
      toast.error("Select at least one dataset");
      return;
    }

    setIsExporting(true);
    try {
      const format = datasetNames.length === 1 ? "parquet" : "zip";
      const blob = await exportAggregatedPredictions({ dataset_names: datasetNames, format });
      downloadBlob(
        blob,
        format === "parquet"
          ? `${datasetNames[0]}.parquet`
          : `predictions_export_${new Date().toISOString().slice(0, 10)}.zip`,
      );
      toast.success("Export ready");
      setExportDialogOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "Export failed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleRefresh = () => {
    refetchWorkspaces();
    refetchPredictions();
  };

  const SortableHeader = ({
    field,
    children,
    align = "left",
    className,
  }: {
    field: SortField;
    children: React.ReactNode;
    align?: "left" | "right";
    className?: string;
  }) => (
    <TableHead
      className={cn("cursor-pointer hover:text-foreground transition-colors select-none", className)}
      onClick={() => handleSort(field)}
    >
      <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
        {children}
        {sortField === field && <ArrowUpDown className={cn("h-3 w-3", sortOrder === "asc" && "rotate-180")} />}
      </div>
    </TableHead>
  );

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

  const primaryMetricKey = filteredRows.find(row => row.metric)?.metric
    || selectedMetrics[0]
    || (isClassificationTaskType(effectiveMetricContext.taskType) ? "accuracy" : "rmse");
  const primaryMetricLabel = getMetricAbbreviation(primaryMetricKey);

  return (
    <motion.div className="space-y-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("predictions.title")}</h1>
          <p className="mt-1 text-muted-foreground">
            {stats.total.toLocaleString()} scored models · {activeWorkspace.name}
            {predictionsLoading && <Loader2 className="ml-2 h-3 w-3 animate-spin inline" />}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={metricTaskFilter}
            onValueChange={value => { if (value) setMetricTaskFilter(value as MetricTaskFilter); }}
            variant="outline"
            size="sm"
            className="h-9 rounded-md border border-primary/40 bg-primary/5 p-0.5"
          >
            <ToggleGroupItem
              value="regression"
              className="h-8 px-4 text-xs font-semibold border-0 rounded-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
            >
              Regression
            </ToggleGroupItem>
            <ToggleGroupItem
              value="classification"
              className="h-8 px-4 text-xs font-semibold border-0 rounded-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm"
            >
              Classification
            </ToggleGroupItem>
          </ToggleGroup>
          <MetricSelector
            taskType={effectiveMetricContext.taskType}
            selectedMetrics={selectedMetrics}
            onSelectedMetricsChange={setSelectedMetrics}
            availableMetricKeys={effectiveMetricContext.availableMetricKeys}
          />
          <Button variant="outline" onClick={handleRefresh} size="sm">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => openExportDialog()} disabled={datasets.length === 0}>
            <Download className="h-4 w-4 mr-1" /> Export
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <Card className="glass-card">
          <CardContent className="flex items-center justify-between px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Total</p>
            <p className="text-sm font-bold">{stats.total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center justify-between px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Datasets</p>
            <p className="text-sm font-bold">{stats.datasets}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center justify-between px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Models</p>
            <p className="text-sm font-bold">{stats.models}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center justify-between px-3 py-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-medium">Pipelines</p>
            <p className="text-sm font-bold">{stats.pipelines}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search models, datasets..."
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            className="pl-9 h-8 bg-muted/50 text-sm"
          />
        </div>
        <Select value={filterDataset} onValueChange={setFilterDataset}>
          <SelectTrigger className="w-[170px] h-8 bg-muted/50 text-xs">
            <Database className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Dataset" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Datasets</SelectItem>
            {datasets.map(datasetName => <SelectItem key={datasetName} value={datasetName}>{datasetName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterModel} onValueChange={setFilterModel}>
          <SelectTrigger className="w-[160px] h-8 bg-muted/50 text-xs">
            <Brain className="h-3.5 w-3.5 mr-1" />
            <SelectValue placeholder="Model" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Models</SelectItem>
            {models.map(modelName => <SelectItem key={modelName} value={modelName}>{modelName}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterTaskType} onValueChange={setFilterTaskType}>
          <SelectTrigger className="w-[140px] h-8 bg-muted/50 text-xs">
            <SelectValue placeholder="Task" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tasks</SelectItem>
            {taskTypes.map(taskType => <SelectItem key={taskType} value={taskType}>{taskType}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1 py-1">
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Type</span>
          <ToggleGroup
            type="multiple"
            value={visibleFoldTypes}
            onValueChange={value => { if (value.length > 0) setVisibleFoldTypes(value as FoldVisibility[]); }}
            variant="outline"
            size="sm"
            className="h-7"
          >
            <ToggleGroupItem value="folds" className={toggleItemClass}>Folds</ToggleGroupItem>
            <ToggleGroupItem value="refits" className={toggleItemClass}>Refits</ToggleGroupItem>
            <ToggleGroupItem value="averages" className={toggleItemClass}>Averages</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 px-1 py-1">
          <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Data</span>
          <ToggleGroup
            type="multiple"
            value={visibleDataKinds}
            onValueChange={value => { if (value.length > 0) setVisibleDataKinds(value as DataVisibility[]); }}
            variant="outline"
            size="sm"
            className="h-7"
          >
            <ToggleGroupItem value="raw" className={toggleItemClass}>Raw</ToggleGroupItem>
            <ToggleGroupItem value="aggregated" className={toggleItemClass}>Aggregated</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 text-xs text-muted-foreground">
            Clear
          </Button>
        )}
      </div>

        <div className="glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent text-[11px]">
                  <TableHead className="w-8">#</TableHead>
                  <SortableHeader field="card_type">Type</SortableHeader>
                  <SortableHeader field="model_name">Model</SortableHeader>
                  <SortableHeader field="dataset_name">Dataset</SortableHeader>
                  <SortableHeader field="preproc">Preproc</SortableHeader>
                  <SortableHeader field="test_score">{primaryMetricLabel}</SortableHeader>
                  <SortableHeader field="val_score">Val</SortableHeader>
                  <SortableHeader field="fold">Fold</SortableHeader>
                  {selectedMetrics.slice(0, 4).map(metric => (
                    <SortableHeader
                      key={metric}
                      field={`metric:${metric}` as SortField}
                      align="right"
                      className="text-right"
                    >
                      <span className="text-[10px]">{getMetricAbbreviation(metric)}</span>
                    </SortableHeader>
                  ))}
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.length === 0 ? (
                  <TableRow>
                    <td colSpan={100} className="text-center py-8 text-muted-foreground text-sm">
                      No models match your filters
                    </td>
                  </TableRow>
                ) : (
                  pageRows.map((row, index) => (
                    <ScoreCardRowView
                      key={`${row.chainId}-${row.foldId}-${row.id}`}
                      row={row}
                      selectedMetrics={selectedMetrics}
                      workspaceId={activeWorkspace.id}
                      rank={startIndex + index + 1}
                      variant="table-row"
                      onViewPrediction={handleQuickView}
                      onOpenChart={handleOpenChart}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>

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

        <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Export Predictions</DialogTitle>
              <DialogDescription>Select datasets to export (.parquet or .zip).</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-60 overflow-auto">
              {datasets.map(datasetName => (
                <label key={datasetName} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={exportSelection.has(datasetName)} onCheckedChange={() => toggleExportDataset(datasetName)} />
                  <span>{datasetName}</span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set(datasets))} disabled={isExporting}>All</Button>
              <Button variant="outline" size="sm" onClick={() => setExportSelection(new Set())} disabled={isExporting}>None</Button>
              <Button onClick={handleExportPredictions} disabled={isExporting}>
                {isExporting ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Exporting...</> : "Download"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <PredictionQuickView
          prediction={quickViewPrediction}
          open={quickViewOpen}
          onOpenChange={setQuickViewOpen}
          initialTab={quickViewInitialTab}
          workspaceId={activeWorkspace.id}
        />
    </motion.div>
  );
}
