import { getMetricDefinitions, isLowerBetter } from "@/lib/scores";
import type { AvailableModel } from "@/types/predict";

export type SortField = "score" | "dataset" | "name" | "newest" | "size";
export type TaskFilter = "all" | "regression" | "classification";
export type TaskKind = "regression" | "classification" | "unknown";

export interface ModelSelectorFilters {
  search: string;
  task: TaskFilter;
  dataset: string;
  modelClass: string;
  refitOnly: boolean;
}

export interface ModelSelectorSort {
  field: SortField;
  descending: boolean;
}

export interface EffectiveModelScore {
  value: number | null;
  metric: string | null;
}

export interface ScoreCohort {
  min: number;
  max: number;
}

export interface ModelTaskCounts {
  regression: number;
  classification: number;
  unknown: number;
}

export interface ModelSelectorState {
  datasetOptions: string[];
  classOptions: string[];
  scoreCohort: ScoreCohort | null;
  taskCounts: ModelTaskCounts;
  sortedModels: AvailableModel[];
  activeFilterCount: number;
}

/**
 * Build the explicit, user-selected Archive V2 model reference.
 *
 * Native archives are intentionally not inferred from legacy bundle metadata:
 * the archive path is selected by the user and the native owner validates it
 * before any prediction input is consumed.
 */
export function buildNativeArchiveModel(archivePath: string): AvailableModel | null {
  const path = archivePath.trim();
  if (!path || !path.toLowerCase().endsWith(".n4a")) return null;
  const name = path.split(/[\\/]/).pop() || path;
  return {
    id: path,
    name,
    source: "native_archive",
    model_class: "Native Archive V2",
    dataset_name: null,
    metric: null,
    best_score: null,
    created_at: null,
    file_size: null,
    preprocessing: null,
    bundle_path: path,
  };
}

export function inferTaskKind(model: AvailableModel): TaskKind {
  const metric = (model.prediction_metric || model.metric || "").toLowerCase();
  if (!metric) return "unknown";
  const def = getMetricDefinitions([metric])[0];
  if (!def) return "unknown";
  if (def.group === "regression") return "regression";
  if (def.group === "multiclass" || def.group === "binary") return "classification";
  return "unknown";
}

export function hasHydratedModel(model: AvailableModel | null): boolean {
  return Boolean(
    model && (
      model.model_class ||
      model.dataset_name ||
      model.preprocessing ||
      model.prediction_score != null ||
      model.best_score != null
    )
  );
}

export function getEffectiveScore(model: AvailableModel): EffectiveModelScore {
  if (model.prediction_score != null) {
    return { value: model.prediction_score, metric: model.prediction_metric ?? model.metric };
  }
  if (model.best_score != null) {
    return { value: model.best_score, metric: model.metric };
  }
  return { value: null, metric: model.metric };
}

export function formatModelFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeModelDate(
  value: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = nowMs - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Normalize score to 0-1 where 1 = best, 0 = worst, within a cohort.
 * Direction-aware (lower-is-better metrics invert the scale).
 */
export function normalizeCohortScore(
  value: number | null,
  metric: string | null | undefined,
  min: number,
  max: number,
): number | null {
  if (value == null || !Number.isFinite(value) || max === min) return null;
  const ratio = (value - min) / (max - min);
  return isLowerBetter(metric) ? 1 - ratio : ratio;
}

export function scoreToneClasses(quality: number | null): string {
  if (quality == null) {
    return "bg-muted/70 text-muted-foreground border-border/60";
  }
  if (quality >= 0.75) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
  if (quality >= 0.5) return "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30";
  if (quality >= 0.25) return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30";
}

export function rankOrnamentClasses(rank: number): string {
  if (rank === 1) return "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-sm shadow-amber-500/30";
  if (rank === 2) return "bg-gradient-to-br from-slate-300 to-slate-400 text-slate-900 shadow-sm shadow-slate-400/30";
  if (rank === 3) return "bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950 shadow-sm shadow-orange-500/30";
  return "bg-muted text-muted-foreground border border-border/60";
}

export function getModelOptionValues(
  models: readonly AvailableModel[],
  key: "dataset_name" | "model_class",
): string[] {
  return [...new Set(models.map((model) => model[key]).filter((value): value is string => !!value))].sort();
}

export function getModelScoreCohort(models: readonly AvailableModel[]): ScoreCohort | null {
  const values = models
    .map((model) => getEffectiveScore(model).value)
    .filter((value): value is number => value != null && Number.isFinite(value));
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function getModelTaskCounts(models: readonly AvailableModel[]): ModelTaskCounts {
  let regression = 0;
  let classification = 0;
  let unknown = 0;

  for (const model of models) {
    const kind = inferTaskKind(model);
    if (kind === "regression") regression += 1;
    else if (kind === "classification") classification += 1;
    else unknown += 1;
  }

  return { regression, classification, unknown };
}

export function modelMatchesFilters(model: AvailableModel, filters: ModelSelectorFilters): boolean {
  if (filters.task !== "all") {
    const kind = inferTaskKind(model);
    if (kind !== filters.task) return false;
  }
  if (filters.dataset !== "all" && model.dataset_name !== filters.dataset) return false;
  if (filters.modelClass !== "all" && model.model_class !== filters.modelClass) return false;
  if (filters.refitOnly && !model.has_refit) return false;

  const query = filters.search.trim().toLowerCase();
  if (query) {
    const haystack = [
      model.name,
      model.model_class,
      model.dataset_name,
      model.preprocessing,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

export function filterModels(
  models: readonly AvailableModel[],
  filters: ModelSelectorFilters,
): AvailableModel[] {
  return models.filter((model) => modelMatchesFilters(model, filters));
}

export function sortModels(
  models: readonly AvailableModel[],
  sort: ModelSelectorSort,
): AvailableModel[] {
  const copy = [...models];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case "score": {
        const sa = getEffectiveScore(a).value;
        const sb = getEffectiveScore(b).value;
        if (sa == null && sb == null) cmp = 0;
        else if (sa == null) cmp = 1;
        else if (sb == null) cmp = -1;
        else {
          const lowerBetter = isLowerBetter(getEffectiveScore(a).metric);
          cmp = lowerBetter ? sa - sb : sb - sa;
        }
        break;
      }
      case "dataset":
        cmp = (a.dataset_name || "").localeCompare(b.dataset_name || "");
        break;
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "newest": {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        cmp = db - da;
        break;
      }
      case "size":
        cmp = (b.file_size ?? 0) - (a.file_size ?? 0);
        break;
    }
    return sort.descending ? -cmp : cmp;
  });
  return copy;
}

export function countActiveModelFilters(filters: ModelSelectorFilters): number {
  return (
    (filters.task !== "all" ? 1 : 0) +
    (filters.dataset !== "all" ? 1 : 0) +
    (filters.modelClass !== "all" ? 1 : 0) +
    (filters.refitOnly ? 1 : 0) +
    (filters.search ? 1 : 0)
  );
}

export function buildModelSelectorState({
  models,
  filters,
  sort,
}: {
  models: readonly AvailableModel[];
  filters: ModelSelectorFilters;
  sort: ModelSelectorSort;
}): ModelSelectorState {
  const filteredModels = filterModels(models, filters);

  return {
    datasetOptions: getModelOptionValues(models, "dataset_name"),
    classOptions: getModelOptionValues(models, "model_class"),
    scoreCohort: getModelScoreCohort(models),
    taskCounts: getModelTaskCounts(models),
    sortedModels: sortModels(filteredModels, sort),
    activeFilterCount: countActiveModelFilters(filters),
  };
}
