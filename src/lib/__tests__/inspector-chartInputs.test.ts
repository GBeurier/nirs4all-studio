import { describe, expect, it } from "vitest";

import {
  buildInspectorChartInputs,
  buildInspectorMetricObservationReadModel,
  buildInspectorScoreColumnAvailability,
  INSPECTOR_HEATMAP_AXIS_OPTIONS,
  resolveInspectorHeatmapAxes,
  resolveInspectorHyperparameter,
  resolveInspectorObservedScoreColumn,
  resolveInspectorObservedScoreRef,
  resolveInspectorSelectedScoreRef,
  resolveScoreHistogramScoreColumn,
} from "@/lib/inspector/chartInputs";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(
  chainId: string,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "dataset-a",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.1,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector chart inputs", () => {
  it("exposes the supported UI heatmap axes", () => {
    expect(INSPECTOR_HEATMAP_AXIS_OPTIONS).toEqual(["dataset_name", "model_class", "preprocessings"]);
  });

  it("coerces unsupported auto heatmap axes to UI-supported defaults", () => {
    const chains = [
      makeChain("a", { run_id: "run-a" }),
      makeChain("b", { run_id: "run-b" }),
    ];

    expect(resolveInspectorHeatmapAxes(chains, null, null)).toEqual({
      xVariable: "dataset_name",
      yVariable: "model_class",
    });
  });

  it("honors manual heatmap axes while preventing duplicate x/y axes", () => {
    const chains = [
      makeChain("a", { dataset_name: "dataset-a", model_class: "PLSRegression" }),
      makeChain("b", { dataset_name: "dataset-b", model_class: "RandomForestRegressor" }),
    ];

    expect(resolveInspectorHeatmapAxes(chains, "dataset_name", "preprocessings")).toEqual({
      xVariable: "dataset_name",
      yVariable: "preprocessings",
    });
    expect(resolveInspectorHeatmapAxes(chains, "dataset_name", "dataset_name")).toEqual({
      xVariable: "dataset_name",
      yVariable: "model_class",
    });
  });

  it("keeps a selected hyperparameter only when it is still available", () => {
    expect(resolveInspectorHyperparameter(["n_components", "alpha"], "alpha")).toBe("alpha");
    expect(resolveInspectorHyperparameter(["n_components", "alpha"], "missing")).toBe("n_components");
    expect(resolveInspectorHyperparameter([], "missing")).toBe("");
  });

  it("builds all chart inputs from visible chains and UI selections", () => {
    const chains = [
      makeChain("a", {
        model_class: "PLSRegression",
        dataset_name: "dataset-a",
        preprocessings: "SNV",
        best_params: { n_components: 8, alpha: 0.1 },
      }),
      makeChain("b", {
        model_class: "RandomForestRegressor",
        dataset_name: "dataset-b",
        preprocessings: "MSC",
        best_params: { alpha: 0.2 },
      }),
    ];

    expect(buildInspectorChartInputs(chains, {
      heatmapXAxis: "preprocessings",
      heatmapYAxis: null,
      selectedHyperParam: "alpha",
    })).toEqual({
      heatmapAxes: {
        xVariable: "preprocessings",
        yVariable: "dataset_name",
      },
      candlestickField: "model_class",
      availableHyperParams: ["alpha"],
      activeHyperParam: "alpha",
    });
  });
});

describe("inspector metric observation read model", () => {
  it("reports no observations when chains carry no finite scores", () => {
    const model = buildInspectorMetricObservationReadModel([makeChain("a", { cv_val_score: null })]);

    expect(model).toEqual({
      hasObservations: false,
      metricKeys: [],
      scoreRefs: [],
      unmappedScoreRefs: [],
    });
  });

  it("derives mapped score-ref availability and metric keys from finite scores", () => {
    const chains = [
      makeChain("a", { metric: "rmse", cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { metric: "rmse", cv_val_score: 0.4, final_test_score: null }),
    ];

    const model = buildInspectorMetricObservationReadModel(chains);

    expect(model.hasObservations).toBe(true);
    expect(model.metricKeys).toEqual(["rmse"]);
    expect(model.unmappedScoreRefs).toEqual([]);

    const byLegacyColumn = Object.fromEntries(
      model.scoreRefs.map((scoreRef) => [scoreRef.legacyScoreColumn, scoreRef]),
    );
    expect(byLegacyColumn.cv_val_score).toMatchObject({
      metric: "rmse",
      protocol: "cross_validation",
      partition: "validation",
      aggregation: "fold_mean",
      observationCount: 2,
    });
    expect(byLegacyColumn.final_test_score).toMatchObject({
      protocol: "final",
      partition: "test",
      observationCount: 1,
    });
  });

  it("surfaces target-aware score maps as unmapped score refs", () => {
    const model = buildInspectorMetricObservationReadModel([
      makeChain("a", {
        cv_val_score: null,
        source_index: 2,
        variant_params: {
          prediction_metadata: {
            score_maps: {
              cv: {
                targets: {
                  protein: {
                    rmse: 0.31,
                    target_index: 1,
                    source_name: "nir",
                  },
                },
              },
            },
          },
        },
        score_maps: {
          cv: {
            targets: {
              protein: {
                rmse: 0.31,
                target_index: 1,
                source_name: "nir",
              },
            },
          },
        },
      }),
    ]);

    expect(model.hasObservations).toBe(false);
    expect(model.metricKeys).toEqual(["rmse"]);
    expect(model.scoreRefs).toEqual([]);
    expect(model.unmappedScoreRefs).toEqual([
      {
        key: "metric=rmse|protocol=cross_validation|partition=target|aggregation=fold_mean|target_index=1|source_index=2",
        metric: "rmse",
        protocol: "cross_validation",
        partition: "target",
        aggregation: "fold_mean",
        legacyScoreColumn: null,
        targetIndex: 1,
        targetName: "protein",
        sourceIndex: 2,
        sourceName: "nir",
        occurrences: 1,
      },
    ]);
    expect(buildInspectorScoreColumnAvailability(model, ["cv_val_score"])).toEqual([
      { scoreColumn: "cv_val_score", observationCount: 0, hasMetricObservations: false },
    ]);
  });

  it("surfaces retained unmapped score-refs from result_metadata with occurrence counts", () => {
    const futureRef = {
      key: "metric=mae|protocol=nested_cv|partition=holdout|aggregation=trimmed_mean",
      metric: "mae",
      protocol: "nested_cv",
      partition: "holdout",
      aggregation: "trimmed_mean",
      legacy_score_column: null,
    };
    const chains = [
      makeChain("a", {
        cv_val_score: null,
        variant_params: { result_metadata: { score_refs: [futureRef] } },
      }),
      makeChain("b", {
        cv_val_score: null,
        variant_params: { result_metadata: { score_refs: [{ ...futureRef }] } },
      }),
    ];

    const model = buildInspectorMetricObservationReadModel(chains);

    expect(model.hasObservations).toBe(false);
    expect(model.metricKeys).toEqual(["mae"]);
    expect(model.unmappedScoreRefs).toEqual([
      {
        key: futureRef.key,
        metric: "mae",
        protocol: "nested_cv",
        partition: "holdout",
        aggregation: "trimmed_mean",
        legacyScoreColumn: null,
        occurrences: 2,
      },
    ]);
  });
});

describe("resolveScoreHistogramScoreColumn", () => {
  it("preserves the requested column when the read model has no mapped availability (legacy)", () => {
    const model = buildInspectorMetricObservationReadModel([makeChain("a", { cv_val_score: null })]);
    expect(model.scoreRefs).toEqual([]);

    expect(resolveScoreHistogramScoreColumn("cv_val_score", model)).toBe("cv_val_score");
    expect(resolveScoreHistogramScoreColumn("final_test_score", model)).toBe("final_test_score");
  });

  it("keeps the requested column when it carries observations", () => {
    const chains = [
      makeChain("a", { cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { cv_val_score: 0.4, final_test_score: null }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);

    expect(resolveScoreHistogramScoreColumn("cv_val_score", model)).toBe("cv_val_score");
    expect(resolveScoreHistogramScoreColumn("final_test_score", model)).toBe("final_test_score");
  });

  it("falls back to the most-observed column when the requested one has no observations", () => {
    const chains = [
      makeChain("a", { cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { cv_val_score: 0.4, final_test_score: null }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);

    // cv_train_score is never observed here -> substitute the most-observed column.
    expect(resolveScoreHistogramScoreColumn("cv_train_score", model)).toBe("cv_val_score");
  });
});

describe("resolveInspectorObservedScoreColumn", () => {
  it("exposes shared observed score-column availability and fallback resolution", () => {
    const chains = [
      makeChain("a", { cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { cv_val_score: 0.4, final_test_score: null }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);

    expect(buildInspectorScoreColumnAvailability(model, [
      "cv_val_score",
      "cv_train_score",
      "final_test_score",
    ])).toEqual([
      { scoreColumn: "cv_val_score", observationCount: 2, hasMetricObservations: true },
      { scoreColumn: "cv_train_score", observationCount: 0, hasMetricObservations: false },
      { scoreColumn: "final_test_score", observationCount: 1, hasMetricObservations: true },
    ]);
    expect(resolveInspectorObservedScoreColumn("cv_train_score", model)).toBe("cv_val_score");
    expect(resolveInspectorObservedScoreColumn("final_test_score", model)).toBe("final_test_score");
  });

  it("resolves the score-ref that backs the effective observed score column", () => {
    const chains = [
      makeChain("a", { metric: "rmse", cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { metric: "rmse", cv_val_score: 0.4, final_test_score: null }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);

    expect(resolveInspectorObservedScoreRef("cv_train_score", model)).toMatchObject({
      metric: "rmse",
      protocol: "cross_validation",
      partition: "validation",
      aggregation: "fold_mean",
      legacyScoreColumn: "cv_val_score",
    });
    expect(resolveInspectorObservedScoreRef("final_test_score", model)).toMatchObject({
      metric: "rmse",
      protocol: "final",
      partition: "test",
      aggregation: "final_model",
      legacyScoreColumn: "final_test_score",
    });
  });

  it("returns no score-ref when the read model has no mapped availability", () => {
    const model = buildInspectorMetricObservationReadModel([makeChain("a", { cv_val_score: null })]);

    expect(resolveInspectorObservedScoreRef("cv_val_score", model)).toBeNull();
  });

  it("resolves an explicit observed score-ref key to its legacy score column", () => {
    const chains = [
      makeChain("a", { metric: "rmse", cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { metric: "rmse", cv_val_score: 0.4, final_test_score: 0.5 }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);
    const selectedKey = model.scoreRefs.find((scoreRef) => scoreRef.legacyScoreColumn === "final_test_score")?.key;

    expect(resolveInspectorSelectedScoreRef("cv_val_score", selectedKey, model)).toMatchObject({
      scoreColumn: "final_test_score",
      selectedScoreRefKey: selectedKey,
      isExplicit: true,
      scoreRef: {
        metric: "rmse",
        protocol: "final",
        partition: "test",
        aggregation: "final_model",
        legacyScoreColumn: "final_test_score",
      },
    });
  });

  it("falls back to Auto when the selected score-ref key is missing or unmapped", () => {
    const chains = [
      makeChain("a", { cv_val_score: 0.2, final_test_score: 0.3 }),
      makeChain("b", { cv_val_score: 0.4, final_test_score: null }),
    ];
    const model = buildInspectorMetricObservationReadModel(chains);

    expect(resolveInspectorSelectedScoreRef("cv_train_score", "missing-key", model)).toMatchObject({
      scoreColumn: "cv_val_score",
      selectedScoreRefKey: null,
      isExplicit: false,
      scoreRef: {
        legacyScoreColumn: "cv_val_score",
      },
    });
    expect(resolveInspectorSelectedScoreRef("final_test_score", null, model)).toMatchObject({
      scoreColumn: "final_test_score",
      selectedScoreRefKey: null,
      isExplicit: false,
      scoreRef: {
        legacyScoreColumn: "final_test_score",
      },
    });
  });
});
