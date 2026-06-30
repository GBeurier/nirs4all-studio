/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";

const apiMocks = vi.hoisted(() => ({
  getAggregatedPredictions: vi.fn(),
  getChainPartitionDetail: vi.fn(),
  runAggregatedPredictionsQuery: vi.fn(),
}));

const developerModeState = vi.hoisted(() => ({
  enabled: true,
}));

const readinessState = vi.hoisted(() => ({
  workspaceReady: true,
}));

const linkedWorkspacesState = vi.hoisted(() => ({
  result: {
    data: {
      workspaces: [
        { id: "workspace-old", is_active: false },
        { id: "workspace-active", is_active: true },
      ],
    },
  },
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock("@/api/aggregatedPredictions", () => ({
  getAggregatedPredictions: apiMocks.getAggregatedPredictions,
  getChainPartitionDetail: apiMocks.getChainPartitionDetail,
  runAggregatedPredictionsQuery: apiMocks.runAggregatedPredictionsQuery,
}));

vi.mock("@/context/useDeveloperMode", () => ({
  useIsDeveloperMode: () => developerModeState.enabled,
}));

vi.mock("@/context/useMlReadiness", () => ({
  useMlReadiness: () => readinessState,
}));

vi.mock("@/hooks/useDatasetQueries", () => ({
  useLinkedWorkspacesQuery: () => linkedWorkspacesState.result,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastMocks.error,
  },
}));

import { useAggregatedResultsPageState } from "./useAggregatedResultsPageState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

function chain(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain-cv",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    branch_path: null,
    source_index: null,
    model_step_idx: 0,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: null,
    cv_val_score: 0.2,
    cv_test_score: 0.3,
    cv_train_score: 0.1,
    cv_fold_count: 3,
    cv_scores: null,
    final_test_score: null,
    final_train_score: null,
    final_scores: null,
    pipeline_status: "completed",
    fold_artifacts: null,
    ...overrides,
  };
}

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: "pred-test",
    pipeline_id: "pipe",
    chain_id: "chain-cv",
    dataset_name: "Corn",
    model_name: "PLS",
    model_class: "PLSRegression",
    fold_id: "1",
    partition: "test",
    val_score: null,
    test_score: 0.3,
    train_score: null,
    scores: null,
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: 12,
    n_features: 4,
    preprocessings: "SNV",
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  developerModeState.enabled = true;
  readinessState.workspaceReady = true;
  linkedWorkspacesState.result = {
    data: {
      workspaces: [
        { id: "workspace-old", is_active: false },
        { id: "workspace-active", is_active: true },
      ],
    },
  };
});

describe("useAggregatedResultsPageState", () => {
  it("coordinates aggregated result loading, filters, sort, details, SQL, and viewer state", async () => {
    const chains = [
      chain({ chain_id: "chain-cv", model_name: "PLS", dataset_name: "Corn", model_class: "PLSRegression", metric: "rmse", cv_val_score: 0.2 }),
      chain({ chain_id: "chain-refit", model_name: "SVM", dataset_name: "Wheat", model_class: "SVR", metric: "mae", cv_val_score: 0.4, final_test_score: 0.12 }),
    ];
    apiMocks.getAggregatedPredictions.mockResolvedValue({
      predictions: chains,
      total: chains.length,
      generated_at: "2026-06-28T00:00:00Z",
    });
    apiMocks.runAggregatedPredictionsQuery.mockResolvedValue({
      columns: ["dataset_name", "predictions"],
      rows: [["Corn", 1]],
      row_count: 1,
    });
    apiMocks.getChainPartitionDetail.mockResolvedValue({
      chain_id: "chain-cv",
      predictions: [
        prediction({ prediction_id: "fold0-test", fold_id: "0" }),
        prediction({ prediction_id: "final-test", fold_id: "final" }),
      ],
      total: 2,
      partition: null,
      fold_id: null,
    });

    const mounted = await renderHook(() => useAggregatedResultsPageState());

    await waitFor(() => {
      expect(mounted.result.current!.loading).toBe(false);
      expect(mounted.result.current!.displayPredictions).toHaveLength(2);
    });

    expect(apiMocks.getAggregatedPredictions).toHaveBeenCalledTimes(1);
    expect(mounted.result.current!.activeWorkspaceId).toBe("workspace-active");
    expect(mounted.result.current!.isDeveloperMode).toBe(true);
    expect(mounted.result.current!.stats).toEqual({
      total: 2,
      datasets: 2,
      models: 2,
      metrics: 2,
    });
    expect(mounted.result.current!.facets).toEqual({
      datasets: ["Corn", "Wheat"],
      modelClasses: ["PLSRegression", "SVR"],
      metrics: ["mae", "rmse"],
    });
    expect(mounted.result.current!.refitFiltered.map((item) => item.chain_id)).toEqual(["chain-refit"]);
    expect(mounted.result.current!.cvFiltered.map((item) => item.chain_id)).toEqual(["chain-cv"]);

    await act(async () => {
      mounted.result.current!.setSearch("wheat");
    });
    expect(mounted.result.current!.filtered.map((item) => item.chain_id)).toEqual(["chain-refit"]);
    expect(mounted.result.current!.hasActiveFilters).toBe(true);

    await act(async () => {
      mounted.result.current!.clearFilters();
    });
    await act(async () => {
      mounted.result.current!.handleSort("dataset");
    });
    expect(mounted.result.current!.sortKey).toBe("dataset");
    expect(mounted.result.current!.sortAsc).toBe(false);
    expect(mounted.result.current!.filtered.map((item) => item.chain_id)).toEqual(["chain-refit", "chain-cv"]);

    await act(async () => {
      mounted.result.current!.openPredictionDetails(chains[1]);
    });
    expect(mounted.result.current!.sheetOpen).toBe(true);
    expect(mounted.result.current!.selectedChainId).toBe("chain-refit");
    expect(mounted.result.current!.selectedMetric).toBe("mae");
    expect(mounted.result.current!.selectedDetailMetaHint).toMatchObject({
      modelName: "SVM",
      datasetName: "Wheat",
    });
    expect(mounted.result.current!.selectedDetailFocus).toEqual({
      cardType: "refit",
      foldId: "final",
    });

    await act(async () => {
      mounted.result.current!.setSql("SELECT 1");
    });
    await act(async () => {
      await mounted.result.current!.handleRunSql();
    });
    expect(apiMocks.runAggregatedPredictionsQuery).toHaveBeenCalledWith("SELECT 1");
    expect(mounted.result.current!.sqlResult?.row_count).toBe(1);

    await act(async () => {
      mounted.result.current!.handleViewPrediction("", [
        prediction({ prediction_id: "p-train", partition: "train", fold_id: "2", task_type: "classification" }),
        prediction({ prediction_id: "p-test", partition: "test", fold_id: "2", task_type: "classification" }),
      ]);
    });
    expect(mounted.result.current!.viewerOpen).toBe(true);
    expect(mounted.result.current!.viewerInitialKind).toBe("confusion");
    expect(mounted.result.current!.viewerHeader).toMatchObject({
      datasetName: "Corn",
      foldId: "2",
      taskType: "classification",
    });
    expect(mounted.result.current!.viewerPartitions.map((target) => target.predictionId)).toEqual([
      "p-train",
      "p-test",
    ]);

    await act(async () => {
      await mounted.result.current!.handleViewChainChart(chains[0]);
    });
    expect(apiMocks.getChainPartitionDetail).toHaveBeenCalledWith("chain-cv");
    expect(mounted.result.current!.viewerHeader).toMatchObject({
      foldId: "final",
      taskType: "regression",
    });
    expect(mounted.result.current!.viewerInitialKind).toBe("scatter");
    expect(mounted.result.current!.viewerPartitions.map((target) => target.predictionId)).toEqual(["final-test"]);

    await mounted.unmount();
  });

  it("exposes empty blocking errors for the page-level workspace state", async () => {
    apiMocks.getAggregatedPredictions.mockRejectedValue(new Error("No workspace 409"));

    const mounted = await renderHook(() => useAggregatedResultsPageState());

    await waitFor(() => {
      expect(mounted.result.current!.loading).toBe(false);
      expect(mounted.result.current!.emptyError).toBe("No workspace 409");
    });
    expect(mounted.result.current!.isNoWorkspaceError).toBe(true);
    expect(mounted.result.current!.displayPredictions).toEqual([]);

    await mounted.unmount();
  });
});
