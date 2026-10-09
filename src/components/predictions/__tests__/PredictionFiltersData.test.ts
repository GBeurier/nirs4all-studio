import { describe, expect, it } from "vitest";

import {
  getPredictionFacetFilter,
  getPredictionFiltersClearAction,
  getPredictionFiltersReadModel,
  getPredictionVisibilityFilter,
  PREDICTION_DATA_VISIBILITY_OPTIONS,
  PREDICTION_FOLD_VISIBILITY_OPTIONS,
} from "../PredictionFiltersData";

describe("PredictionFiltersData", () => {
  it("defines the fold and data visibility option catalogs", () => {
    expect(PREDICTION_FOLD_VISIBILITY_OPTIONS).toEqual([
      { value: "folds", labelKey: "predictions.filters.folds" },
      { value: "refits", labelKey: "predictions.filters.refits" },
      { value: "averages", labelKey: "predictions.filters.averages" },
    ]);

    expect(PREDICTION_DATA_VISIBILITY_OPTIONS).toEqual([
      { value: "raw", labelKey: "predictions.filters.raw" },
      { value: "aggregated", labelKey: "predictions.filters.aggregated" },
    ]);
  });

  it("keeps facet labels, placeholders, and trigger widths in one catalog", () => {
    expect(getPredictionFacetFilter("dataset")).toEqual({
      id: "dataset",
      allLabelKey: "predictions.filters.allDatasets",
      placeholderKey: "predictions.filters.dataset",
      triggerClassName: "w-[170px]",
    });

    expect(getPredictionFacetFilter("model")).toEqual({
      id: "model",
      allLabelKey: "predictions.filters.allModels",
      placeholderKey: "predictions.filters.model",
      triggerClassName: "w-[160px]",
    });

    expect(getPredictionFacetFilter("taskType")).toEqual({
      id: "taskType",
      allLabelKey: "predictions.filters.allTasks",
      placeholderKey: "predictions.filters.task",
      triggerClassName: "w-[140px]",
    });
  });

  it("groups visibility controls with their labels and typed options", () => {
    expect(getPredictionVisibilityFilter("foldTypes")).toEqual({
      id: "foldTypes",
      labelKey: "predictions.filters.type",
      options: PREDICTION_FOLD_VISIBILITY_OPTIONS,
    });

    expect(getPredictionVisibilityFilter("dataKinds")).toEqual({
      id: "dataKinds",
      labelKey: "predictions.filters.data",
      options: PREDICTION_DATA_VISIBILITY_OPTIONS,
    });
  });

  it("derives clear action visibility from active filters", () => {
    expect(getPredictionFiltersClearAction(true)).toEqual({
      isVisible: true,
      labelKey: "common.clear",
    });

    expect(getPredictionFiltersClearAction(false)).toEqual({
      isVisible: false,
      labelKey: "common.clear",
    });
  });

  it("builds the filters read model from the active-filter state", () => {
    const readModel = getPredictionFiltersReadModel({ hasActiveFilters: true });

    expect(readModel.facets.dataset).toBe(getPredictionFacetFilter("dataset"));
    expect(readModel.visibility.foldTypes).toBe(
      getPredictionVisibilityFilter("foldTypes"),
    );
    expect(readModel.clearAction).toEqual({
      isVisible: true,
      labelKey: "common.clear",
    });
  });
});
