import type { DataVisibility, FoldVisibility } from "@/lib/predictions/rows";

export interface PredictionFilterOption<TValue extends string> {
  readonly value: TValue;
  readonly labelKey: string;
}

export type PredictionFacetFilterId = "dataset" | "model" | "taskType";

export interface PredictionFacetFilterDefinition<
  TId extends PredictionFacetFilterId = PredictionFacetFilterId,
> {
  readonly id: TId;
  readonly allLabelKey: string;
  readonly placeholderKey: string;
  readonly triggerClassName: string;
}

export interface PredictionFacetFilterCatalog {
  readonly dataset: PredictionFacetFilterDefinition<"dataset">;
  readonly model: PredictionFacetFilterDefinition<"model">;
  readonly taskType: PredictionFacetFilterDefinition<"taskType">;
}

export const PREDICTION_FACET_FILTERS = {
  dataset: {
    id: "dataset",
    allLabelKey: "predictions.filters.allDatasets",
    placeholderKey: "predictions.filters.dataset",
    triggerClassName: "w-[170px]",
  },
  model: {
    id: "model",
    allLabelKey: "predictions.filters.allModels",
    placeholderKey: "predictions.filters.model",
    triggerClassName: "w-[160px]",
  },
  taskType: {
    id: "taskType",
    allLabelKey: "predictions.filters.allTasks",
    placeholderKey: "predictions.filters.task",
    triggerClassName: "w-[140px]",
  },
} as const satisfies PredictionFacetFilterCatalog;

export const PREDICTION_FOLD_VISIBILITY_OPTIONS = [
  { value: "folds", labelKey: "predictions.filters.folds" },
  { value: "refits", labelKey: "predictions.filters.refits" },
  { value: "averages", labelKey: "predictions.filters.averages" },
] as const satisfies readonly PredictionFilterOption<FoldVisibility>[];

export const PREDICTION_DATA_VISIBILITY_OPTIONS = [
  { value: "raw", labelKey: "predictions.filters.raw" },
  { value: "aggregated", labelKey: "predictions.filters.aggregated" },
] as const satisfies readonly PredictionFilterOption<DataVisibility>[];

export interface PredictionVisibilityFilterDefinition<
  TId extends string,
  TValue extends string,
> {
  readonly id: TId;
  readonly labelKey: string;
  readonly options: readonly PredictionFilterOption<TValue>[];
}

export interface PredictionVisibilityFilterCatalog {
  readonly foldTypes: PredictionVisibilityFilterDefinition<
    "foldTypes",
    FoldVisibility
  >;
  readonly dataKinds: PredictionVisibilityFilterDefinition<
    "dataKinds",
    DataVisibility
  >;
}

export type PredictionVisibilityFilterId =
  keyof PredictionVisibilityFilterCatalog;

export const PREDICTION_VISIBILITY_FILTERS = {
  foldTypes: {
    id: "foldTypes",
    labelKey: "predictions.filters.type",
    options: PREDICTION_FOLD_VISIBILITY_OPTIONS,
  },
  dataKinds: {
    id: "dataKinds",
    labelKey: "predictions.filters.data",
    options: PREDICTION_DATA_VISIBILITY_OPTIONS,
  },
} as const satisfies PredictionVisibilityFilterCatalog;

export interface PredictionFiltersClearActionReadModel {
  readonly isVisible: boolean;
  readonly labelKey: string;
}

export interface PredictionFiltersReadModelInput {
  readonly hasActiveFilters: boolean;
}

export interface PredictionFiltersReadModel {
  readonly facets: PredictionFacetFilterCatalog;
  readonly visibility: PredictionVisibilityFilterCatalog;
  readonly clearAction: PredictionFiltersClearActionReadModel;
}

export function getPredictionFacetFilter<TId extends PredictionFacetFilterId>(
  id: TId,
): PredictionFacetFilterCatalog[TId] {
  return PREDICTION_FACET_FILTERS[id];
}

export function getPredictionVisibilityFilter<
  TId extends PredictionVisibilityFilterId,
>(id: TId): PredictionVisibilityFilterCatalog[TId] {
  return PREDICTION_VISIBILITY_FILTERS[id];
}

export function getPredictionFiltersClearAction(
  hasActiveFilters: boolean,
): PredictionFiltersClearActionReadModel {
  return {
    isVisible: hasActiveFilters,
    labelKey: "common.clear",
  };
}

export function getPredictionFiltersReadModel({
  hasActiveFilters,
}: PredictionFiltersReadModelInput): PredictionFiltersReadModel {
  return {
    facets: PREDICTION_FACET_FILTERS,
    visibility: PREDICTION_VISIBILITY_FILTERS,
    clearAction: getPredictionFiltersClearAction(hasActiveFilters),
  };
}
