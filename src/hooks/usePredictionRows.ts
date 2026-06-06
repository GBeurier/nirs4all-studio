import { useEffect, useMemo, useState } from "react";

import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";
import {
  ALL_DATA_KINDS,
  ALL_FOLD_TYPES,
  buildPredictionModelRows,
  collectSortedUniqueStrings,
  createRowComparator,
  rowDataVisibility,
  rowFoldVisibility,
  rowMatchesFacetScope,
  rowMatchesMetricContext,
  type DataVisibility,
  type FoldVisibility,
  type MetricTaskFilter,
  type SortField,
  type SortOrder,
} from "@/lib/predictions/rows";
import {
  collectPresentMetricKeys,
  isClassificationTaskType,
  isLowerBetter,
  orderMetricKeys,
} from "@/lib/scores";

export interface PredictionRowsState {
  allRows: ScoreCardRow[];
  contextRows: ScoreCardRow[];
  contextDatasets: string[];
  datasetOptions: string[];
  modelOptions: string[];
  taskTypeOptions: string[];
  filteredRows: ScoreCardRow[];
  pageRows: ScoreCardRow[];
  stats: { total: number; datasets: number; models: number; pipelines: number };
  metricContext: { taskType: string | null; taskTypes: string[]; availableMetricKeys: string[] };
  // Filter state
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  filterDataset: string;
  setFilterDataset: (value: string) => void;
  filterModel: string;
  setFilterModel: (value: string) => void;
  filterTaskType: string;
  setFilterTaskType: (value: string) => void;
  visibleFoldTypes: FoldVisibility[];
  setVisibleFoldTypes: (value: FoldVisibility[]) => void;
  visibleDataKinds: DataVisibility[];
  setVisibleDataKinds: (value: DataVisibility[]) => void;
  // Sort state
  sortField: SortField;
  sortOrder: SortOrder;
  handleSort: (field: SortField) => void;
  // Pagination
  currentPage: number;
  setCurrentPage: (updater: number | ((prev: number) => number)) => void;
  pageSize: number;
  setPageSize: (value: number) => void;
  totalCount: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  // Derived filter helpers
  hasActiveFilters: boolean;
  clearFilters: () => void;
}

/**
 * Owns the predictions derivation pipeline: grouping raw records into score
 * rows, the metric-task context split, facet option lists, the filter/sort/page
 * state, and the filtered → sorted → paginated row slice. Behaviour mirrors the
 * previous in-page memos and effects exactly.
 */
export function usePredictionRows(
  rawPredictions: PredictionRecord[],
  metricTaskFilter: MetricTaskFilter,
): PredictionRowsState {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterDataset, setFilterDataset] = useState("all");
  const [filterModel, setFilterModel] = useState("all");
  const [filterTaskType, setFilterTaskType] = useState("all");
  const [sortField, setSortField] = useState<SortField>("test_score");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [visibleFoldTypes, setVisibleFoldTypes] = useState<FoldVisibility[]>(["refits"]);
  const [visibleDataKinds, setVisibleDataKinds] = useState<DataVisibility[]>([...ALL_DATA_KINDS]);

  const allRows = useMemo<ScoreCardRow[]>(() => buildPredictionModelRows(rawPredictions), [rawPredictions]);

  const contextRows = useMemo(
    () => allRows.filter(row => rowMatchesMetricContext(row, metricTaskFilter)),
    [allRows, metricTaskFilter],
  );

  const contextDatasets = useMemo(
    () => collectSortedUniqueStrings(contextRows.map(row => row.datasetName)),
    [contextRows],
  );

  const datasetOptions = useMemo(
    () => collectSortedUniqueStrings(
      contextRows
        .filter(row => rowMatchesFacetScope(row, {
          model: filterModel !== "all" ? filterModel : undefined,
          taskType: filterTaskType !== "all" ? filterTaskType : undefined,
          visibleFoldTypes,
          visibleDataKinds,
        }))
        .map(row => row.datasetName),
    ),
    [contextRows, filterModel, filterTaskType, visibleDataKinds, visibleFoldTypes],
  );

  const modelOptions = useMemo(
    () => collectSortedUniqueStrings(
      contextRows
        .filter(row => rowMatchesFacetScope(row, {
          dataset: filterDataset !== "all" ? filterDataset : undefined,
          taskType: filterTaskType !== "all" ? filterTaskType : undefined,
          visibleFoldTypes,
          visibleDataKinds,
        }))
        .map(row => row.modelName),
    ),
    [contextRows, filterDataset, filterTaskType, visibleDataKinds, visibleFoldTypes],
  );

  const taskTypeOptions = useMemo(
    () => collectSortedUniqueStrings(
      contextRows
        .filter(row => rowMatchesFacetScope(row, {
          dataset: filterDataset !== "all" ? filterDataset : undefined,
          model: filterModel !== "all" ? filterModel : undefined,
          visibleFoldTypes,
          visibleDataKinds,
        }))
        .map(row => row.taskType),
    ),
    [contextRows, filterDataset, filterModel, visibleDataKinds, visibleFoldTypes],
  );

  const pipelinesCount = useMemo(
    () => new Set(contextRows.map(row => row.chainId).filter(Boolean)).size,
    [contextRows],
  );

  const stats = useMemo(() => ({
    total: contextRows.length,
    datasets: new Set(contextRows.map(row => row.datasetName).filter(Boolean)).size,
    models: new Set(contextRows.map(row => row.modelName).filter(Boolean)).size,
    pipelines: pipelinesCount,
  }), [contextRows, pipelinesCount]);

  const filteredRows = useMemo(() => {
    let rows = contextRows;

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

    rows = rows.filter(row =>
      visibleFoldTypes.includes(rowFoldVisibility(row))
      && visibleDataKinds.includes(rowDataVisibility(row)),
    );

    return [...rows].sort(createRowComparator(sortField, sortOrder));
  }, [contextRows, filterDataset, filterModel, filterTaskType, visibleDataKinds, visibleFoldTypes, searchQuery, sortField, sortOrder]);

  useEffect(() => {
    if (filterDataset !== "all" && !datasetOptions.includes(filterDataset)) {
      setFilterDataset("all");
    }
  }, [datasetOptions, filterDataset]);

  useEffect(() => {
    if (filterModel !== "all" && !modelOptions.includes(filterModel)) {
      setFilterModel("all");
    }
  }, [filterModel, modelOptions]);

  useEffect(() => {
    if (filterTaskType !== "all" && !taskTypeOptions.includes(filterTaskType)) {
      setFilterTaskType("all");
    }
  }, [filterTaskType, taskTypeOptions]);

  const metricContext = useMemo(() => {
    const taskTypes = new Set<string>();
    const availableMetricKeys = new Set<string>();
    const sourceRows = filteredRows.length > 0 ? filteredRows : contextRows;

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
      availableMetricKeys: orderMetricKeys([...availableMetricKeys]),
    };
  }, [contextRows, filteredRows]);

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

  return {
    allRows,
    contextRows,
    contextDatasets,
    datasetOptions,
    modelOptions,
    taskTypeOptions,
    filteredRows,
    pageRows,
    stats,
    metricContext,
    searchQuery,
    setSearchQuery,
    filterDataset,
    setFilterDataset,
    filterModel,
    setFilterModel,
    filterTaskType,
    setFilterTaskType,
    visibleFoldTypes,
    setVisibleFoldTypes,
    visibleDataKinds,
    setVisibleDataKinds,
    sortField,
    sortOrder,
    handleSort,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalCount,
    totalPages,
    startIndex,
    endIndex,
    hasActiveFilters,
    clearFilters,
  };
}
