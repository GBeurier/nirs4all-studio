import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";

export type AggregatedResultsSortKey = "model" | "cv_val" | "cv_test" | "final_test" | "dataset" | "metric" | "folds";

export interface AggregatedResultsFilters {
  search: string;
  datasetFilter: string;
  modelClassFilter: string;
  metricFilter: string;
}

export interface AggregatedResultsSortState {
  sortKey: AggregatedResultsSortKey;
  sortAsc: boolean;
}

export interface AggregatedResultsFacets {
  datasets: string[];
  modelClasses: string[];
  metrics: string[];
}

export interface AggregatedResultsStats {
  total: number;
  datasets: number;
  models: number;
  metrics: number;
}

export interface AggregatedResultsSummary {
  facets: AggregatedResultsFacets;
  stats: AggregatedResultsStats;
}

export interface AggregatedResultsSections {
  refitFiltered: ChainSummary[];
  cvFiltered: ChainSummary[];
}

export interface AggregatedPredictionViewerState {
  partitions: ViewerPartitionTarget[];
  header: ViewerHeader;
  initialKind: ChartKind;
}

export function formatAggregatedScore(value: number | null | undefined): string {
  if (value == null) return "\u2014";
  return value.toFixed(4);
}

export function buildAggregatedResultsSummary(predictions: ChainSummary[]): AggregatedResultsSummary {
  const datasets = new Set<string>();
  const modelClasses = new Set<string>();
  const metrics = new Set<string>();
  for (const prediction of predictions) {
    if (prediction.dataset_name) datasets.add(prediction.dataset_name);
    modelClasses.add(prediction.model_class);
    if (prediction.metric) metrics.add(prediction.metric);
  }
  const facets = {
    datasets: Array.from(datasets).sort(),
    modelClasses: Array.from(modelClasses).sort(),
    metrics: Array.from(metrics).sort(),
  };

  return {
    facets,
    stats: {
      total: predictions.length,
      datasets: datasets.size,
      models: modelClasses.size,
      metrics: metrics.size,
    },
  };
}

export function buildAggregatedResultsFacets(predictions: ChainSummary[]): AggregatedResultsFacets {
  return buildAggregatedResultsSummary(predictions).facets;
}

export function buildAggregatedResultsStats(predictions: ChainSummary[]): AggregatedResultsStats {
  return buildAggregatedResultsSummary(predictions).stats;
}

export function filterAndSortAggregatedResults(
  predictions: ChainSummary[],
  filters: AggregatedResultsFilters,
  sort: AggregatedResultsSortState,
): ChainSummary[] {
  let items = predictions;

  if (filters.search) {
    const query = filters.search.toLowerCase();
    items = items.filter(
      (prediction) =>
        (prediction.model_name ?? "").toLowerCase().includes(query) ||
        prediction.model_class.toLowerCase().includes(query) ||
        (prediction.dataset_name ?? "").toLowerCase().includes(query) ||
        (prediction.preprocessings && prediction.preprocessings.toLowerCase().includes(query)),
    );
  }

  if (filters.datasetFilter !== "all") {
    items = items.filter((prediction) => prediction.dataset_name === filters.datasetFilter);
  }
  if (filters.modelClassFilter !== "all") {
    items = items.filter((prediction) => prediction.model_class === filters.modelClassFilter);
  }
  if (filters.metricFilter !== "all") {
    items = items.filter((prediction) => prediction.metric === filters.metricFilter);
  }

  return [...items].sort((a, b) => compareAggregatedPredictions(a, b, sort));
}

export function splitAggregatedResultsSections(predictions: ChainSummary[]): AggregatedResultsSections {
  return {
    refitFiltered: predictions.filter((prediction) => prediction.final_test_score != null),
    cvFiltered: predictions.filter((prediction) => prediction.final_test_score == null),
  };
}

export function nextAggregatedResultsSortState(
  current: AggregatedResultsSortState,
  nextKey: AggregatedResultsSortKey,
): AggregatedResultsSortState {
  if (current.sortKey === nextKey) {
    return { sortKey: current.sortKey, sortAsc: !current.sortAsc };
  }
  return {
    sortKey: nextKey,
    sortAsc: nextKey === "cv_val" || nextKey === "cv_test" || nextKey === "final_test",
  };
}

export function buildPredictionViewerStateFromSiblings(
  siblings: PartitionPrediction[],
): AggregatedPredictionViewerState | null {
  if (siblings.length === 0) return null;
  const primary = siblings.find((sibling) => sibling.partition === "test")
    ?? siblings.find((sibling) => sibling.partition === "val")
    ?? siblings[0];
  const partitions: ViewerPartitionTarget[] = siblings.map((sibling) => ({
    predictionId: sibling.prediction_id,
    partition: (sibling.partition ?? "").toLowerCase(),
    label: sibling.partition ?? "",
    source: "aggregated" as const,
  }));
  return {
    partitions,
    header: {
      datasetName: primary.dataset_name,
      modelName: primary.model_name ?? null,
      preprocessings: primary.preprocessings ?? null,
      foldId: primary.fold_id ?? null,
      taskType: primary.task_type ?? null,
      valScore: primary.val_score ?? null,
      testScore: primary.test_score ?? null,
      trainScore: primary.train_score ?? null,
      nSamples: primary.n_samples ?? null,
      nFeatures: primary.n_features ?? null,
    },
    initialKind: isClassificationTask(primary.task_type) ? "confusion" : "scatter",
  };
}

export function selectBestViewerPredictionGroup(
  predictions: PartitionPrediction[],
): PartitionPrediction[] {
  if (predictions.length === 0) return [];
  const foldGroups = new Map<string, PartitionPrediction[]>();
  for (const prediction of predictions) {
    const foldKey = prediction.fold_id || "unknown";
    foldGroups.set(foldKey, [...(foldGroups.get(foldKey) ?? []), prediction]);
  }
  if (foldGroups.has("final")) return foldGroups.get("final") ?? [];

  let bestGroup = predictions;
  let maxSize = 0;
  for (const group of foldGroups.values()) {
    if (group.length > maxSize) {
      maxSize = group.length;
      bestGroup = group;
    }
  }
  return bestGroup;
}

function compareAggregatedPredictions(
  a: ChainSummary,
  b: ChainSummary,
  sort: AggregatedResultsSortState,
): number {
  let comparison = 0;
  switch (sort.sortKey) {
    case "model":
      comparison = (a.model_name ?? "").localeCompare(b.model_name ?? "");
      break;
    case "cv_val":
      comparison = (a.cv_val_score ?? Infinity) - (b.cv_val_score ?? Infinity);
      break;
    case "cv_test":
      comparison = (a.cv_test_score ?? Infinity) - (b.cv_test_score ?? Infinity);
      break;
    case "final_test":
      comparison = (a.final_test_score ?? Infinity) - (b.final_test_score ?? Infinity);
      break;
    case "dataset":
      comparison = (a.dataset_name ?? "").localeCompare(b.dataset_name ?? "");
      break;
    case "metric":
      comparison = (a.metric ?? "").localeCompare(b.metric ?? "");
      break;
    case "folds":
      comparison = a.cv_fold_count - b.cv_fold_count;
      break;
  }
  return sort.sortAsc ? comparison : -comparison;
}
