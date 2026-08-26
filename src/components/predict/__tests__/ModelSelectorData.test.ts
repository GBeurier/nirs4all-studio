import { describe, expect, it } from "vitest";

import {
  buildModelSelectorState,
  buildNativeArchiveModel,
  formatModelFileSize,
  formatRelativeModelDate,
  getEffectiveScore,
  hasHydratedModel,
  inferTaskKind,
  normalizeCohortScore,
  sortModels,
} from "../ModelSelectorData";
import type { AvailableModel } from "@/types/predict";

function model(overrides: Partial<AvailableModel> = {}): AvailableModel {
  return {
    id: "model",
    name: "Model",
    source: "chain",
    model_class: "",
    dataset_name: null,
    metric: null,
    best_score: null,
    created_at: null,
    file_size: null,
    preprocessing: null,
    bundle_path: null,
    ...overrides,
  };
}

describe("ModelSelectorData", () => {
  it("creates an explicit native Archive V2 selection only for .n4a paths", () => {
    expect(buildNativeArchiveModel("  C:\\models\\native.n4a  ")).toMatchObject({
      id: "C:\\models\\native.n4a",
      name: "native.n4a",
      source: "native_archive",
      model_class: "Native Archive V2",
    });
    expect(buildNativeArchiveModel("model.zip")).toBeNull();
    expect(buildNativeArchiveModel(" ")).toBeNull();
  });

  it("infers task kind and prefers prediction scores over selection scores", () => {
    const regression = model({ metric: "rmse", best_score: 0.2 });
    const classification = model({
      metric: "rmse",
      best_score: 0.2,
      prediction_metric: "accuracy",
      prediction_score: 0.92,
    });

    expect(inferTaskKind(regression)).toBe("regression");
    expect(inferTaskKind(classification)).toBe("classification");
    expect(getEffectiveScore(classification)).toEqual({ value: 0.92, metric: "accuracy" });
    expect(hasHydratedModel(model())).toBe(false);
    expect(hasHydratedModel(model({ prediction_score: 0 }))).toBe(true);
  });

  it("builds selector options, counts, active filters, and filtered sorted models", () => {
    const models = [
      model({
        id: "pls",
        name: "PLS tuned",
        model_class: "PLSRegression",
        dataset_name: "Corn",
        metric: "rmse",
        best_score: 0.2,
        preprocessing: "SNV",
        has_refit: true,
      }),
      model({
        id: "svc",
        name: "SVC",
        model_class: "SVC",
        dataset_name: "Wheat",
        metric: "accuracy",
        best_score: 0.91,
      }),
      model({
        id: "forest",
        name: "Forest",
        model_class: "RandomForest",
        dataset_name: "Corn",
        metric: "accuracy",
        best_score: 0.84,
        has_refit: true,
      }),
    ];

    const state = buildModelSelectorState({
      models,
      filters: {
        search: "snv",
        task: "regression",
        dataset: "Corn",
        modelClass: "PLSRegression",
        refitOnly: true,
      },
      sort: { field: "score", descending: false },
    });

    expect(state.datasetOptions).toEqual(["Corn", "Wheat"]);
    expect(state.classOptions).toEqual(["PLSRegression", "RandomForest", "SVC"]);
    expect(state.taskCounts).toEqual({ regression: 1, classification: 2, unknown: 0 });
    expect(state.activeFilterCount).toBe(5);
    expect(state.sortedModels.map((entry) => entry.id)).toEqual(["pls"]);
    expect(state.scoreCohort).toEqual({ min: 0.2, max: 0.91 });
  });

  it("sorts scores with metric direction and preserves null-score ordering", () => {
    const lowerBetter = [
      model({ id: "missing", metric: "rmse", best_score: null }),
      model({ id: "worse", metric: "rmse", best_score: 0.4 }),
      model({ id: "best", metric: "rmse", best_score: 0.1 }),
    ];
    const higherBetter = [
      model({ id: "low", metric: "accuracy", best_score: 0.81 }),
      model({ id: "high", metric: "accuracy", best_score: 0.93 }),
    ];

    expect(sortModels(lowerBetter, { field: "score", descending: false }).map((entry) => entry.id)).toEqual([
      "best",
      "worse",
      "missing",
    ]);
    expect(sortModels(lowerBetter, { field: "score", descending: true }).map((entry) => entry.id)).toEqual([
      "missing",
      "worse",
      "best",
    ]);
    expect(sortModels(higherBetter, { field: "score", descending: false }).map((entry) => entry.id)).toEqual([
      "high",
      "low",
    ]);
  });

  it("normalizes score quality and formats model metadata", () => {
    const now = Date.parse("2026-06-29T12:00:00Z");

    expect(normalizeCohortScore(0.1, "rmse", 0.1, 0.3)).toBe(1);
    expect(normalizeCohortScore(0.3, "rmse", 0.1, 0.3)).toBe(0);
    expect(normalizeCohortScore(0.8, "accuracy", 0.7, 0.9)).toBeCloseTo(0.5);
    expect(normalizeCohortScore(0.8, "accuracy", 0.8, 0.8)).toBeNull();
    expect(formatModelFileSize(1536)).toBe("1.5 KB");
    expect(formatRelativeModelDate("2026-06-29T09:00:00Z", now)).toBe("today");
    expect(formatRelativeModelDate("2026-06-28T09:00:00Z", now)).toBe("yesterday");
    expect(formatRelativeModelDate("not a date", now)).toBeNull();
  });
});
