/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChainDetailResponse,
  ChainPartitionDetailResponse,
  ChainSummary,
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";
import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";

const apiMocks = vi.hoisted(() => ({
  getChainDetail: vi.fn(),
  getChainPartitionDetail: vi.fn(),
  getChainPipelineSteps: vi.fn(),
  getPredictionArrays: vi.fn(),
  getPredictionRobustnessEvidence: vi.fn(),
  computePredictionRobustnessReport: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getChainDetail: apiMocks.getChainDetail,
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
  getChainPipelineSteps: apiMocks.getChainPipelineSteps,
  getPredictionArrays: apiMocks.getPredictionArrays,
  getPredictionRobustnessEvidence: apiMocks.getPredictionRobustnessEvidence,
  computePredictionRobustnessReport: apiMocks.computePredictionRobustnessReport,
}));

import {
  buildChainDetailRobustnessScenarioOptions,
  buildChainDetailRobustnessUnavailableScenarios,
  useChainDetailPanelState,
} from "./useChainDetailPanelState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void, timeoutMs: number = 1000): Promise<void> {
  const start = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  }
}

async function renderHook<T>(hook: () => T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  await act(async () => {
    root.render(<TestComponent />);
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function summary(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    model_name: "Loaded model",
    model_class: "LoadedModel",
    preprocessings: "SNV",
    branch_path: ["source", "model"],
    source_index: null,
    model_step_idx: 0,
    metric: "rmse",
    task_type: "classification",
    dataset_name: "Loaded dataset",
    best_params: { alpha: 0.1 },
    variant_params: { n_components: 4 },
    cv_val_score: 0.2,
    cv_test_score: 0.3,
    cv_train_score: 0.1,
    cv_fold_count: 3,
    cv_scores: {
      val: { rmse: 0.2, mae: 0.1 },
      test: { rmse: 0.3, mae: 0.15 },
      train: { rmse: 0.1 },
    },
    final_test_score: null,
    final_train_score: null,
    final_scores: null,
    pipeline_status: "completed",
    fold_artifacts: null,
    ...overrides,
  };
}

function predictionRow(overrides: Partial<PartitionPrediction>): PartitionPrediction {
  return {
    prediction_id: "p-test",
    pipeline_id: "pipe",
    chain_id: "chain",
    dataset_name: "Loaded dataset",
    model_name: "Loaded model",
    model_class: "LoadedModel",
    fold_id: "1",
    partition: "test",
    val_score: null,
    test_score: 0.3,
    train_score: null,
    scores: { rmse: 0.3 },
    best_params: null,
    metric: "rmse",
    task_type: "classification",
    n_samples: 2,
    n_features: 3,
    preprocessings: "SNV",
    ...overrides,
  };
}

function arrays(predictionId: string): PredictionArraysResponse {
  return {
    prediction_id: predictionId,
    y_true: [1, 2],
    y_pred: [1.1, 1.9],
    y_proba: null,
    sample_indices: [0, 1],
    weights: null,
    n_samples: 2,
    sample_metadata: null,
  };
}

function robustnessEvidence(predictionId: string, spectralReady: boolean = false) {
  return {
    prediction_id: predictionId,
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    stored_prediction_scenarios: ["observed", "prediction_bias", "prediction_noise"],
    spectral_scenarios: ["spectral_noise", "spectral_offset", "spectral_scale", "spectral_shift", "spectral_slope"],
    can_compute_stored_prediction_report: true,
    can_compute_spectral_report: spectralReady,
    status: spectralReady ? "ready_for_spectral_replay" : "ready_for_prediction_space_only",
    requirements: [
      {
        id: "y_true",
        label: "Stored truth labels",
        present: true,
        source: "prediction_arrays.y_true",
        detail: "Required for observed and prediction-space robustness metrics.",
      },
      {
        id: "y_pred",
        label: "Stored predictions",
        present: true,
        source: "prediction_arrays.y_pred",
        detail: "Required for observed, prediction_bias and prediction_noise reports.",
      },
      {
        id: "spectra",
        label: "Row-aligned spectra / X matrix",
        present: spectralReady,
        source: spectralReady ? "prediction_arrays.X" : null,
        detail: "Required before Studio can replay spectral/OOD perturbations.",
      },
      {
        id: "frozen_predictor",
        label: "Frozen predictor replay surface",
        present: spectralReady,
        source: spectralReady ? "prediction_arrays.predictor_bundle" : null,
        detail: "Required before Studio can score perturbed spectra with the exact stored predictor.",
      },
    ],
    blockers: spectralReady
      ? []
      : [
        "Spectral/OOD scenarios require a row-aligned X/spectra matrix for the selected prediction.",
        "Spectral/OOD scenarios require an explicit frozen predictor replay surface.",
      ],
  };
}

function robustnessRegistry(scenarioKinds: string[]): KeywordRegistryDocument {
  return {
    entries: [
      {
        aliases: [],
        canonical_term: "robustness_scenarios",
        changes: ["robustness_report"],
        docs_anchor: "robustness-scenarios",
        engine_support: { "dag-ml": "partial", legacy: "partial" },
        id: "robustness.scenarios",
        invalidates_calibration: "not_applicable",
        lifecycle_stage: "robustness",
        path: "robustness.scenarios",
        reads: ["predictions"],
        scope: "robustness",
        status: "partial",
        summary: "Scenario cells used by the robustness report.",
        surface: "robustness_argument",
        token: "scenarios",
        ui: { control: "array", group: "robustness", label: "Robustness scenarios", order: 10 },
        value_schema: {
          items: {
            properties: {
              distribution: { enum: ["normal", "uniform"], type: "string" },
              kind: { enum: scenarioKinds, type: "string" },
              severity: { type: "number" },
            },
            type: "object",
          },
          type: "array",
        },
      },
    ],
    registry_version: "1.0.0",
    schema_id: "https://nirs4all.org/schemas/keyword-effects/v1",
    schema_version: 1,
    scope: "lifecycle-v1",
  };
}

function robustnessSummaryArtifact(scenarioLabel: string = "observed", severity: number = 0) {
  return {
    conformal_guarantee_status: {
      artifact_fingerprint: "robustness-artifact-fp",
      calibrated_coverages: [0.8, 0.95],
      calibration_data_fingerprint: "calibration-data-fp",
      coverage: [0.8],
      effective_engine: "nirs4all.conformal.v1",
      guarantee: "split_conformal_marginal_coverage",
      invalidation_reasons: [],
      limitations: ["finite-sample marginal coverage requires exchangeable calibration and prediction samples"],
      method: "split_absolute_residual",
      multi_target: "marginal",
      predictor_fingerprint: null,
      requested_engine: "nirs4all.conformal.v1",
      scope: "finite_sample_marginal_exchangeability",
      source_calibrated_result_fingerprint: null,
      status: "active",
      unit: "physical_sample",
      version: 1,
    },
    fingerprint: "robustness:generated",
    format: "nirs4all.robustness.summary",
    mode: "clean_frozen",
    report_version: 1,
    schema_version: 1,
    slice_by: [],
    summary: [{
      bias: 0,
      conformal_max_abs_coverage_gap: null,
      conformal_mean_width_mean: null,
      conformal_min_observed_coverage: null,
      delta_bias: 0,
      delta_mae: 0,
      delta_max_abs_error: 0,
      delta_rmse: 0,
      mae: 0.1,
      mae_ratio: 1,
      max_abs_error: 0.2,
      n_samples: 2,
      rmse: 0.14,
      rmse_ratio: 1,
      scenario: { kind: scenarioLabel },
      scenario_index: 0,
      scenario_label: scenarioLabel,
      severity,
      worst_slice_key: null,
      worst_slice_label: null,
      worst_slice_metric: "rmse",
      worst_slice_value: null,
    }],
  };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useChainDetailPanelState", () => {
  it("derives stored-prediction robustness scenarios from the keyword registry when attached", () => {
    const registry = robustnessRegistry(["observed", "prediction_noise", "spectral_noise"]);

    expect(buildChainDetailRobustnessScenarioOptions(registry).map((option) => option.kind)).toEqual([
      "observed",
      "prediction_noise",
    ]);
    expect(buildChainDetailRobustnessScenarioOptions(registry)[1]).toMatchObject({
      label: "prediction noise",
      severityLabel: "Severity",
    });
    expect(buildChainDetailRobustnessUnavailableScenarios(registry)).toEqual([
      {
        kind: "spectral_noise",
        label: "spectral noise",
        reason: "Requires explicit spectra and a frozen predictor replay surface.",
      },
    ]);
  });

  it("derives spectral robustness scenarios from the registry only when replay evidence is ready", () => {
    const registry = robustnessRegistry(["observed", "prediction_noise", "spectral_noise", "spectral_shift"]);

    expect(buildChainDetailRobustnessScenarioOptions(registry).map((option) => option.kind)).toEqual([
      "observed",
      "prediction_noise",
    ]);
    expect(buildChainDetailRobustnessUnavailableScenarios(registry).map((option) => option.kind)).toEqual([
      "spectral_noise",
      "spectral_shift",
    ]);

    expect(buildChainDetailRobustnessScenarioOptions(registry, {
      includeSpectralReplay: true,
    }).map((option) => option.kind)).toEqual([
      "observed",
      "prediction_noise",
      "spectral_noise",
      "spectral_shift",
    ]);
    expect(buildChainDetailRobustnessUnavailableScenarios(registry, {
      includeSpectralReplay: true,
    })).toEqual([]);
  });

  it("hydrates chain detail state, focused fold selection, charts, and viewer handoff", async () => {
    const detailDeferred = deferred<ChainDetailResponse>();
    const partitionsDeferred = deferred<ChainPartitionDetailResponse>();
    apiMocks.getChainDetail.mockReturnValue(detailDeferred.promise);
    apiMocks.getChainPartitionDetail.mockReturnValue(partitionsDeferred.promise);
    apiMocks.getChainPipelineSteps.mockResolvedValue({
      pipeline: [
        { class: "nirs4all.preprocessing.SNV", params: { enabled: true } },
        { model: "nirs4all.models.PLS", _or_: [{ n_components: 2 }, { n_components: 4 }] },
      ],
    });
    apiMocks.getPredictionArrays.mockImplementation(async (predictionId: string) => arrays(predictionId));
    const onOpenViewer = vi.fn();
    const focus = { predictionId: "p-val" };
    const metaHint = {
      modelName: "Hint model",
      modelClass: "HintModel",
      datasetName: "Hint dataset",
      metric: "mae",
      taskType: "regression",
      preprocessings: "None",
      pipelineStatus: "running",
    };

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
      metaHint,
      focus,
      onOpenViewer,
    }));

    expect(mounted.result.current!.prediction.model_name).toBe("Hint model");
    expect(mounted.result.current!.preprocessLabel).toBe("None");

    await act(async () => {
      detailDeferred.resolve({
        chain_id: "chain",
        summary: summary({
          fold_artifacts: {
            fold_1: "artifact-fold-1",
            fold_final: "artifact-final",
          },
        }),
        predictions: [],
        pipeline: {
          pipeline_id: "pipe",
          name: "Loaded pipeline",
          dataset_name: "Loaded dataset",
          generator_choices: JSON.stringify([{ n_components: 4 }]),
          status: "completed",
          metric: "rmse",
          best_val: 0.2,
          best_test: 0.3,
        },
      });
      partitionsDeferred.resolve({
        chain_id: "chain",
        predictions: [
          predictionRow({ prediction_id: "p-train", partition: "train" }),
          predictionRow({ prediction_id: "p-val", partition: "val" }),
          predictionRow({ prediction_id: "p-test", partition: "test" }),
        ],
        total: 3,
        partition: null,
        fold_id: null,
      });
    });

    await waitFor(() => {
      expect(mounted.result.current!.selectedFoldId).toBe("1");
      expect(mounted.result.current!.arrayData?.prediction_id).toBe("p-test");
      expect(mounted.result.current!.chartDatasets).toHaveLength(3);
    });

    expect(mounted.result.current!.prediction.model_name).toBe("Loaded model");
    expect(mounted.result.current!.taskKind).toBe("classification");
    expect(mounted.result.current!.previewKind).toBe("confusion");
    expect(mounted.result.current!.chartTargets.map((target) => target.predictionId)).toEqual([
      "p-val",
      "p-test",
      "p-train",
    ]);
    expect(mounted.result.current!.variantParams).toEqual({ n_components: 4 });
    expect(mounted.result.current!.bestParams).toEqual({ alpha: 0.1 });
    expect(mounted.result.current!.pipelineTree?.nodes.map((node) => [node.label, node.kind])).toEqual([
      ["SNV", "step"],
      ["PLS", "model"],
    ]);
    expect(mounted.result.current!.pipelineTree?.nodes[1].hasGenerator).toBe(true);
    expect(mounted.result.current!.generatorChoices).toEqual([{ n_components: 4 }]);
    expect(mounted.result.current!.branchPathLabel).toBe("source -> model");
    expect(mounted.result.current!.additionalCvMetricRows.map((row) => row.metric)).toEqual(["mae"]);
    expect(mounted.result.current!.vectorSummaries[0].observed).toEqual({ min: 1, max: 2, mean: 1.5 });
    expect(mounted.result.current!.arrayArtifactRef).toMatchObject({
      kind: "prediction_arrays",
      role: "prediction-vectors",
      source: "prediction-arrays",
      scope: "prediction",
      predictionId: "p-test",
      runId: "run",
      pipelineId: "pipe",
      chainId: "chain",
      datasetName: "Loaded dataset",
      metric: "rmse",
      metadata: {
        nSamples: 2,
        vectors: ["y_true", "y_pred", "sample_indices"],
      },
    });
    expect(mounted.result.current!.artifactSummary.refs.map((ref) => ref.id)).toEqual([
      "legacy-fold-artifacts:chain:fold_final:artifact-final",
      "legacy-fold-artifacts:chain:fold_1:artifact-fold-1",
      "prediction-arrays:p-test",
    ]);
    expect(mounted.result.current!.artifactSummary).toMatchObject({
      totalCount: 3,
      totalCountLabel: "3 artifacts",
      kindItems: [
        {
          label: "Model",
          artifactCount: 2,
          artifactCountLabel: "2 artifacts",
        },
        {
          label: "Prediction arrays",
          artifactCount: 1,
          artifactCountLabel: "1 artifact",
        },
      ],
      statusItems: [
        {
          label: "Available",
          artifactCount: 3,
          artifactCountLabel: "3 artifacts",
        },
      ],
      provenanceGroups: [
        {
          label: "Legacy fold artifacts / Fold",
          sourceLabel: "Legacy fold artifacts",
          scopeLabel: "Fold",
          artifactCount: 2,
          artifactCountLabel: "2 artifacts",
          artifactLabels: ["Final (refit) model", "Fold 1 model"],
        },
        {
          label: "Prediction arrays / Prediction",
          sourceLabel: "Prediction arrays",
          scopeLabel: "Prediction",
          artifactCount: 1,
          artifactCountLabel: "1 artifact",
          artifactLabels: ["Prediction arrays"],
        },
      ],
    });

    mounted.result.current!.handleCustomize("confusion");
    expect(onOpenViewer).toHaveBeenCalledWith(
      mounted.result.current!.chartTargets,
      expect.objectContaining({ datasetName: "Loaded dataset", foldId: "1" }),
      "confusion",
    );

    await mounted.unmount();
  });

  it("projects attached calibrated conformal results into prediction rows", async () => {
    const calibratedResult = {
      artifact: {
        calibration_size: 4,
        qhat_by_coverage: [{ coverage: 0.8, qhat: 0.5 }],
        spec: {
          coverage: [0.8],
          group_by: [],
          method: "split_absolute_residual",
          multi_target: "marginal",
          unit: "physical_sample",
        },
      },
      fingerprint: "calibrated-result:chain",
      metadata: {
        conformal_guarantee_status: {
          artifact_fingerprint: "artifact-fp",
          calibrated_coverages: [0.8, 0.95],
          calibration_data_fingerprint: "calibration-data-fp",
          coverage: [0.8],
          effective_engine: "nirs4all.conformal.v1",
          guarantee: "split_conformal_marginal_coverage",
          invalidation_reasons: [],
          limitations: ["finite-sample marginal coverage requires exchangeable calibration and prediction samples"],
          method: "split_absolute_residual",
          multi_target: "marginal",
          predictor_fingerprint: null,
          requested_engine: "nirs4all.conformal.v1",
          scope: "finite_sample_marginal_exchangeability",
          source_calibrated_result_fingerprint: null,
          status: "active",
          unit: "physical_sample",
          version: 1,
        },
        calibration_replay_source: {
          dataset_backed: false,
          kind: "predict_result",
          requires_model_replay: false,
          route: "PredictResult",
          version: 1,
        },
        tuning_calibration_source: {
          score_data_role: "hpo_objective_only",
          score_data_used: false,
          source: "tuning.winner",
        },
        conformal_metrics: [{
          coverage: 0.8,
          coverage_gap: -0.05,
          mean_interval_score: 1.5,
          mean_width: 1.25,
          median_width: 1,
          n_covered: 3,
          n_missed_above: 0,
          n_missed_below: 1,
          n_samples: 4,
          observed_coverage: 0.75,
          unit: "physical_sample",
          version: 1,
        }],
      },
      prediction: {
        intervals: [
          { coverage: 0.8, lower: [0, 1], qhat: 0.5, upper: [1, 2] },
          { coverage: 0.95, lower: [-0.5, 0.5], qhat: 1, upper: [1.5, 2.5] },
        ],
        method: "split_absolute_residual",
        unit: "physical_sample",
        y_pred: [0.5, 1.5],
      },
      sample_ids: ["pred-a", "pred-b"],
      version: 1,
    };

    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary({
        artifact_refs: [{
          id: "conformal-result",
          kind: "repository_entry",
          role: "conformal-calibrated-result",
          label: "Conformal calibrated result",
          source: "result-repository",
          scope: "chain",
          status: "available",
          metadata: {
            conformal_calibrated_result: calibratedResult,
          },
        }],
      }),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
    }));

    await waitFor(() => {
      expect(mounted.result.current!.conformalSummary?.rows).toHaveLength(2);
      expect(mounted.result.current!.chartDatasets[0]?.sampleIds).toEqual([0, 1]);
    });

    expect(mounted.result.current!.conformalSummary).toMatchObject({
      fingerprint: "calibrated-result:chain",
      guarantee: {
        calibrationReplayLabel: "PredictResult",
        calibrationReplaySource: {
          dataset_backed: false,
          kind: "predict_result",
          requires_model_replay: false,
          route: "PredictResult",
          version: 1,
        },
        tuningCalibrationLabel: "tuning winner; score_data ranked trials only",
        tuningCalibrationSource: {
          score_data_role: "hpo_objective_only",
          score_data_used: false,
          source: "tuning.winner",
        },
        label: "Active conformal guarantee",
        status: "active",
        tone: "success",
      },
    });
    expect(mounted.result.current!.conformalSummary?.coverageStrip).toEqual(expect.arrayContaining([
      expect.objectContaining({
        coverage: 0.8,
        coverageLabel: "80%",
        meanWidthLabel: "1.0000",
        qhatLabel: "0.5000",
        selected: true,
        tone: "selected",
      }),
    ]));
    expect(mounted.result.current!.conformalSummary?.metrics).toEqual([
      expect.objectContaining({
        coverage: 0.8,
        coverageGap: -0.05,
        coverageGapDirection: "under",
        coverageLabel: "80%",
        meanIntervalScore: 1.5,
        meanWidth: 1.25,
        missedAbove: 0,
        missedBelow: 1,
        nCovered: 3,
        nSamples: 4,
        observedCoverage: 0.75,
        observedCoverageLabel: "75%",
      }),
    ]);
    expect(mounted.result.current!.selectedConformalCoverage).toBe(0.8);
    expect(mounted.result.current!.chartTargets[0]?.conformalCoverage).toBe(0.8);
    expect(mounted.result.current!.chartTargets[0]?.conformalRows).toHaveLength(2);
    expect(mounted.result.current!.conformalSummary?.coverages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        calibrated: true,
        coverage: 0.8,
        disabled: false,
        materialized: true,
        selected: true,
      }),
      expect.objectContaining({
        calibrated: true,
        coverage: 0.95,
        disabled: false,
        materialized: true,
        selected: false,
      }),
    ]));
    expect(mounted.result.current!.chartDatasets[0]?.conformalCoverage).toBeUndefined();
    expect(mounted.result.current!.chartDatasets[0]?.conformalIntervals).toBeUndefined();
    expect(mounted.result.current!.conformalSummary?.rows[0]).toMatchObject({
      index: 0,
      sampleId: "pred-a",
      yPred: 0.5,
    });
    expect(mounted.result.current!.conformalSummary?.rows[0]?.intervals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        coverage: 0.8,
        lower: 0,
        upper: 1,
        width: 1,
      }),
    ]));
    await act(async () => {
      mounted.result.current!.setSelectedConformalCoverage(0.95);
    });
    expect(mounted.result.current!.chartTargets[0]?.conformalCoverage).toBe(0.95);
    expect(mounted.result.current!.chartDatasets[0]?.conformalCoverage).toBeUndefined();
    expect(mounted.result.current!.chartDatasets[0]?.conformalIntervals).toBeUndefined();

    await mounted.unmount();
  });

  it("projects attached native tuning results into chain detail summary", async () => {
    const tuningResult = {
      best_params: {
        n_components: 8,
      },
      best_value: 0.1234,
      fingerprint: "tuning-result:chain",
      optimizer: "optuna",
      trials: [
        {
          diagnostics: {},
          number: 1,
          params: { n_components: 4 },
          state: "COMPLETE",
          value: 0.2,
        },
        {
          diagnostics: { reason: "winner" },
          number: 2,
          params: { n_components: 8 },
          state: "COMPLETE",
          value: 0.1234,
        },
      ],
      tuning: {
        direction: "minimize",
        engine: "optuna",
        metric: "rmse",
        n_trials: 2,
        pruner: null,
        resume: false,
        sampler: "tpe",
        seed: 42,
        space: {
          n_components: { low: 2, high: 16 },
        },
        storage: null,
        study_name: "pls-chain",
      },
    };

    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary({
        artifact_refs: [{
          id: "tuning-result",
          kind: "repository_entry",
          role: "tuning-result",
          label: "Native tuning result",
          source: "result-repository",
          scope: "chain",
          status: "available",
          metadata: {
            tuning_result: tuningResult,
          },
        }],
      }),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
    }));

    await waitFor(() => {
      expect(mounted.result.current!.tuningSummary?.study.fingerprint).toBe("tuning-result:chain");
    });

    expect(mounted.result.current!.tuningSummary).toMatchObject({
      persistence: {
        optimizerStateResumeSupported: true,
        resume: false,
        storageConfigured: false,
        studyName: "pls-chain",
      },
      study: {
        bestParams: { n_components: 8 },
        bestValueLabel: "0.123",
        completeTrials: 2,
        direction: "minimize",
        metric: "rmse",
        nTrials: 2,
        optimizer: "optuna",
        pruner: null,
        sampler: "tpe",
        seed: 42,
        studyName: "pls-chain",
      },
      trials: [
        expect.objectContaining({
          isBest: false,
          number: 1,
          paramsLabel: "n_components=4",
          status: "complete",
        }),
        expect.objectContaining({
          isBest: true,
          number: 2,
          paramsLabel: "n_components=8",
          valueLabel: "0.123",
        }),
      ],
    });

    await mounted.unmount();
  });

  it("builds chain tuning summary data from a lightweight tuning summary artifact", async () => {
    const tuningSummary = {
      best_params: { n_components: 8 },
      best_value: 0.1234,
      direction: "minimize",
      engine: "optuna",
      fingerprint: "tuning-summary:chain",
      format: "nirs4all.tuning.summary",
      metric: "rmse",
      n_trials: 2,
      optimizer: "optuna",
      persistence: {
        optimizer_state_resume_supported: true,
        resume: true,
        storage_configured: true,
        study_name: "pls-summary-chain",
      },
      pruner: "median",
      sampler: "grid",
      schema_version: 1,
      seed: 42,
      trial_states: { COMPLETE: 2 },
      trials: [
        { number: 1, state: "COMPLETE", value: 0.2 },
        { number: 2, state: "COMPLETE", value: 0.1234, diagnostics: { score_family: "objective" } },
      ],
      version: 1,
    };

    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary({
        artifact_refs: [{
          id: "tuning-summary",
          kind: "repository_entry",
          role: "tuning-summary",
          label: "Native tuning summary",
          source: "result-repository",
          scope: "chain",
          status: "available",
          metadata: {
            tuning_summary: tuningSummary,
          },
        }],
      }),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
    }));

    await waitFor(() => {
      expect(mounted.result.current!.tuningSummary?.study.fingerprint).toBe("tuning-summary:chain");
    });

    expect(mounted.result.current!.tuningSummary).toMatchObject({
      persistence: {
        optimizerStateResumeSupported: true,
        resume: true,
        storageConfigured: true,
        studyName: "pls-summary-chain",
      },
      study: {
        bestParams: { n_components: 8 },
        bestValueLabel: "0.123",
        completeTrials: 2,
        direction: "minimize",
        metric: "rmse",
        nTrials: 2,
        optimizer: "optuna",
        pruner: "median",
        sampler: "grid",
        seed: 42,
        studyName: "pls-summary-chain",
      },
      trials: [
        expect.objectContaining({
          isBest: false,
          number: 1,
          paramsLabel: "summary artifact",
          status: "complete",
        }),
        expect.objectContaining({
          diagnostics: { score_family: "objective" },
          isBest: true,
          number: 2,
          params: {},
          valueLabel: "0.123",
        }),
      ],
    });

    await mounted.unmount();
  });

  it("computes an observed native robustness report for the selected prediction", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));
    apiMocks.computePredictionRobustnessReport.mockResolvedValue({
      robustness_id: "rob-generated",
      prediction_id: "p-test",
      run_id: "run",
      pipeline_id: "pipe",
      chain_id: "chain",
      summary_artifact: robustnessSummaryArtifact(),
      report_fingerprint: "robustness:generated",
    });

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
    }));

    await waitFor(() => {
      expect(mounted.result.current!.canComputeRobustness).toBe(true);
      expect(mounted.result.current!.arrayData?.prediction_id).toBe("p-test");
    });

    await act(async () => {
      await mounted.result.current!.computeRobustnessReport();
    });

    expect(apiMocks.computePredictionRobustnessReport).toHaveBeenCalledWith("p-test", {
      robustness: {
        mode: "clean_frozen",
        scenarios: [{ kind: "observed", severity: 0 }],
      },
      name: "Studio Observed robustness report",
    });
    expect(mounted.result.current!.generatedRobustnessId).toBe("rob-generated");
    expect(mounted.result.current!.robustnessActionError).toBeNull();
    expect(mounted.result.current!.robustnessSummary).toMatchObject({
      fingerprint: "robustness:generated",
      guarantee: {
        coverageLabel: "80%",
        effectiveEngine: "nirs4all.conformal.v1",
        label: "Active conformal guarantee",
        status: "active",
        tone: "success",
      },
      mode: "clean_frozen",
      reportVersion: 1,
      cards: [expect.objectContaining({
        scenarioLabel: "observed",
        nSamples: 2,
      })],
    });

    await mounted.unmount();
  });

  it("computes a prediction noise robustness report with configured severity", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));
    apiMocks.computePredictionRobustnessReport.mockResolvedValue({
      robustness_id: "rob-noise",
      prediction_id: "p-test",
      run_id: "run",
      pipeline_id: "pipe",
      chain_id: "chain",
      summary_artifact: robustnessSummaryArtifact("prediction_noise", 0.25),
      report_fingerprint: "robustness:generated",
    });

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
      keywordRegistry: robustnessRegistry(["observed", "prediction_noise"]),
    }));

    await waitFor(() => {
      expect(mounted.result.current!.canComputeRobustness).toBe(true);
      expect(mounted.result.current!.arrayData?.prediction_id).toBe("p-test");
    });

    await act(async () => {
      mounted.result.current!.setRobustnessScenarioKind("prediction_noise");
      mounted.result.current!.setRobustnessSeverity("0.25");
      mounted.result.current!.setRobustnessDistribution("uniform");
    });
    expect(mounted.result.current!.robustnessDistributionOptions.map((option) => option.value)).toEqual([
      "normal",
      "uniform",
    ]);
    expect(mounted.result.current!.robustnessScenarioValidationError).toBeNull();

    await act(async () => {
      await mounted.result.current!.computeRobustnessReport();
    });

    expect(apiMocks.computePredictionRobustnessReport).toHaveBeenCalledWith("p-test", {
      robustness: {
        mode: "clean_frozen",
        scenarios: [{ kind: "prediction_noise", severity: 0.25, distribution: "uniform" }],
      },
      name: "Studio prediction noise robustness report",
    });
    expect(mounted.result.current!.generatedRobustnessId).toBe("rob-noise");
    expect(mounted.result.current!.robustnessSummary?.cards[0]).toMatchObject({
      scenarioLabel: "prediction_noise",
      severity: 0.25,
    });
    expect(mounted.result.current!.robustnessSummary?.guarantee).toMatchObject({
      coverageLabel: "80%",
      label: "Active conformal guarantee",
      status: "active",
    });

    await mounted.unmount();
  });

  it("computes a spectral robustness report when replay evidence is ready", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));
    apiMocks.getPredictionRobustnessEvidence.mockImplementation(async (predictionId: string) => (
      robustnessEvidence(predictionId, true)
    ));
    apiMocks.computePredictionRobustnessReport.mockResolvedValue({
      robustness_id: "rob-spectral",
      prediction_id: "p-test",
      run_id: "run",
      pipeline_id: "pipe",
      chain_id: "chain",
      summary_artifact: robustnessSummaryArtifact("spectral_shift", 1),
      report_fingerprint: "robustness:generated",
    });

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
      keywordRegistry: robustnessRegistry(["observed", "prediction_noise", "spectral_shift"]),
    }));

    await waitFor(() => {
      expect(mounted.result.current!.robustnessEvidence?.can_compute_spectral_report).toBe(true);
      expect(mounted.result.current!.robustnessScenarioOptions.map((option) => option.kind)).toEqual([
        "observed",
        "prediction_noise",
        "spectral_shift",
      ]);
    });

    await act(async () => {
      mounted.result.current!.setRobustnessScenarioKind("spectral_shift");
      mounted.result.current!.setRobustnessSeverity("1");
    });
    expect(mounted.result.current!.robustnessScenarioValidationError).toBeNull();

    await act(async () => {
      await mounted.result.current!.computeRobustnessReport();
    });

    expect(apiMocks.computePredictionRobustnessReport).toHaveBeenCalledWith("p-test", {
      robustness: {
        mode: "clean_frozen",
        scenarios: [{ kind: "spectral_shift", severity: 1 }],
      },
      name: "Studio spectral shift robustness report",
    });
    expect(mounted.result.current!.generatedRobustnessId).toBe("rob-spectral");

    await mounted.unmount();
  });

  it("rejects invalid spectral noise severity before calling the backend", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));
    apiMocks.getPredictionRobustnessEvidence.mockImplementation(async (predictionId: string) => (
      robustnessEvidence(predictionId, true)
    ));

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
      keywordRegistry: robustnessRegistry(["observed", "spectral_noise"]),
    }));

    await waitFor(() => {
      expect(mounted.result.current!.robustnessScenarioOptions.map((option) => option.kind)).toEqual([
        "observed",
        "spectral_noise",
      ]);
    });

    await act(async () => {
      mounted.result.current!.setRobustnessScenarioKind("spectral_noise");
      mounted.result.current!.setRobustnessSeverity("-0.1");
    });

    expect(mounted.result.current!.robustnessScenarioValidationError).toBe(
      "spectral noise severity must be non-negative.",
    );
    expect(mounted.result.current!.canComputeRobustness).toBe(false);

    await act(async () => {
      await mounted.result.current!.computeRobustnessReport();
    });

    expect(apiMocks.computePredictionRobustnessReport).not.toHaveBeenCalled();
    expect(mounted.result.current!.robustnessActionError).toBe(
      "spectral noise severity must be non-negative.",
    );

    await mounted.unmount();
  });

  it("rejects invalid prediction noise severity before calling the backend", async () => {
    apiMocks.getChainDetail.mockResolvedValue({
      chain_id: "chain",
      summary: summary(),
      predictions: [],
      pipeline: null,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain",
      predictions: [predictionRow({ prediction_id: "p-test", partition: "test" })],
      total: 1,
      partition: null,
      fold_id: null,
    });
    apiMocks.getChainPipelineSteps.mockResolvedValue({ pipeline: [] });
    apiMocks.getPredictionArrays.mockResolvedValue(arrays("p-test"));

    const mounted = await renderHook(() => useChainDetailPanelState({
      chainId: "chain",
      metric: "rmse",
    }));

    await waitFor(() => {
      expect(mounted.result.current!.arrayData?.prediction_id).toBe("p-test");
    });

    await act(async () => {
      mounted.result.current!.setRobustnessScenarioKind("prediction_noise");
      mounted.result.current!.setRobustnessSeverity("-0.1");
    });

    expect(mounted.result.current!.robustnessScenarioValidationError).toBe(
      "Prediction noise severity must be non-negative.",
    );
    expect(mounted.result.current!.canComputeRobustness).toBe(false);

    await act(async () => {
      await mounted.result.current!.computeRobustnessReport();
    });

    expect(apiMocks.computePredictionRobustnessReport).not.toHaveBeenCalled();
    expect(mounted.result.current!.robustnessActionError).toBe(
      "Prediction noise severity must be non-negative.",
    );

    await mounted.unmount();
  });
});
