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

const apiMocks = vi.hoisted(() => ({
  getChainDetail: vi.fn(),
  getChainPartitionDetail: vi.fn(),
  getChainPipelineSteps: vi.fn(),
  getPredictionArrays: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getChainDetail: apiMocks.getChainDetail,
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
  getChainPipelineSteps: apiMocks.getChainPipelineSteps,
  getPredictionArrays: apiMocks.getPredictionArrays,
}));

import { useChainDetailPanelState } from "./useChainDetailPanelState";

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

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("useChainDetailPanelState", () => {
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
});
