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
      { value: "folds", label: "Folds" },
      { value: "refits", label: "Refits" },
      { value: "averages", label: "Averages" },
    ]);

    expect(PREDICTION_DATA_VISIBILITY_OPTIONS).toEqual([
      { value: "raw", label: "Raw" },
      { value: "aggregated", label: "Aggregated" },
    ]);
  });

  it("keeps facet labels, placeholders, and trigger widths in one catalog", () => {
    expect(getPredictionFacetFilter("dataset")).toEqual({
      id: "dataset",
      allLabel: "All Datasets",
      placeholder: "Dataset",
      triggerClassName: "w-[170px]",
    });

    expect(getPredictionFacetFilter("model")).toEqual({
      id: "model",
      allLabel: "All Models",
      placeholder: "Model",
      triggerClassName: "w-[160px]",
    });

    expect(getPredictionFacetFilter("taskType")).toEqual({
      id: "taskType",
      allLabel: "All Tasks",
      placeholder: "Task",
      triggerClassName: "w-[140px]",
    });
  });

  it("groups visibility controls with their labels and typed options", () => {
    expect(getPredictionVisibilityFilter("foldTypes")).toEqual({
      id: "foldTypes",
      label: "Type",
      options: PREDICTION_FOLD_VISIBILITY_OPTIONS,
    });

    expect(getPredictionVisibilityFilter("dataKinds")).toEqual({
      id: "dataKinds",
      label: "Data",
      options: PREDICTION_DATA_VISIBILITY_OPTIONS,
    });
  });

  it("derives clear action visibility from active filters", () => {
    expect(getPredictionFiltersClearAction(true)).toEqual({
      isVisible: true,
      label: "Clear",
    });

    expect(getPredictionFiltersClearAction(false)).toEqual({
      isVisible: false,
      label: "Clear",
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
      label: "Clear",
    });
  });
});
