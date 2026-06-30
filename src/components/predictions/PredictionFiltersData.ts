import type { DataVisibility, FoldVisibility } from "@/lib/predictions/rows";

export interface PredictionFilterOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

export type PredictionFacetFilterId = "dataset" | "model" | "taskType";

export interface PredictionFacetFilterDefinition<
  TId extends PredictionFacetFilterId = PredictionFacetFilterId,
> {
  readonly id: TId;
  readonly allLabel: string;
  readonly placeholder: string;
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
    allLabel: "All Datasets",
    placeholder: "Dataset",
    triggerClassName: "w-[170px]",
  },
  model: {
    id: "model",
    allLabel: "All Models",
    placeholder: "Model",
    triggerClassName: "w-[160px]",
  },
  taskType: {
    id: "taskType",
    allLabel: "All Tasks",
    placeholder: "Task",
    triggerClassName: "w-[140px]",
  },
} as const satisfies PredictionFacetFilterCatalog;

export const PREDICTION_FOLD_VISIBILITY_OPTIONS = [
  { value: "folds", label: "Folds" },
  { value: "refits", label: "Refits" },
  { value: "averages", label: "Averages" },
] as const satisfies readonly PredictionFilterOption<FoldVisibility>[];

export const PREDICTION_DATA_VISIBILITY_OPTIONS = [
  { value: "raw", label: "Raw" },
  { value: "aggregated", label: "Aggregated" },
] as const satisfies readonly PredictionFilterOption<DataVisibility>[];

export interface PredictionVisibilityFilterDefinition<
  TId extends string,
  TValue extends string,
> {
  readonly id: TId;
  readonly label: string;
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
    label: "Type",
    options: PREDICTION_FOLD_VISIBILITY_OPTIONS,
  },
  dataKinds: {
    id: "dataKinds",
    label: "Data",
    options: PREDICTION_DATA_VISIBILITY_OPTIONS,
  },
} as const satisfies PredictionVisibilityFilterCatalog;

export interface PredictionFiltersClearActionReadModel {
  readonly isVisible: boolean;
  readonly label: string;
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
    label: "Clear",
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
