/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TopChainResult } from "@/types/enriched-runs";
import type { DatasetTopChains } from "@/types/runs";

const apiMocks = vi.hoisted(() => ({
  getWorkspaceResultsSummary: vi.fn(),
}));

const linkedWorkspacesState = vi.hoisted(() => ({
  result: {
    data: {
      workspaces: [
        { id: "workspace-old", name: "Old workspace", is_active: false },
        { id: "workspace-active", name: "Active workspace", is_active: true },
      ],
    },
  },
}));

vi.mock("@/api/linkedWorkspaces", () => ({
  getWorkspaceResultsSummary: apiMocks.getWorkspaceResultsSummary,
}));

vi.mock("@/hooks/useDatasetQueries", () => ({
  useLinkedWorkspacesQuery: () => linkedWorkspacesState.result,
}));

import { useResultsPageState } from "./useResultsPageState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
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

async function renderHook<T>(hook: () => T, client: QueryClient = createQueryClient()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: T | undefined } = { current: undefined };

  function TestComponent() {
    result.current = hook();
    return null;
  }

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <TestComponent />
        </QueryClientProvider>,
      );
    });
  }

  await render();

  return {
    client,
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      client.clear();
    },
  };
}

function chain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: "chain",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    avg_val_score: 0.2,
    avg_test_score: 0.3,
    avg_train_score: 0.1,
    fold_count: 3,
    scores: {
      val: { rmse: 0.2 },
      test: { rmse: 0.3 },
    },
    final_test_score: 0.25,
    final_train_score: 0.1,
    final_scores: { rmse: 0.25 },
    ...overrides,
  };
}

function dataset(overrides: Partial<DatasetTopChains> = {}): DatasetTopChains {
  return {
    dataset_name: "Corn",
    linked_dataset_id: "dataset-corn",
    metric: "rmse",
    task_type: "regression",
    top_chains: [chain()],
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  linkedWorkspacesState.result = {
    data: {
      workspaces: [
        { id: "workspace-old", name: "Old workspace", is_active: false },
        { id: "workspace-active", name: "Active workspace", is_active: true },
      ],
    },
  };
});

describe("useResultsPageState", () => {
  it("loads active workspace results and exposes filtered/adapted dataset cards", async () => {
    apiMocks.getWorkspaceResultsSummary.mockResolvedValue({
      workspace_id: "workspace-active",
      datasets: [
        dataset({ dataset_name: "Corn" }),
        dataset({
          dataset_name: "Wheat",
          metric: "accuracy",
          task_type: "classification",
          top_chains: [
            chain({
              chain_id: "classifier",
              avg_val_score: 0.91,
              avg_test_score: 0.89,
              final_test_score: 0.93,
              scores: {
                val: { accuracy: 0.91 },
                test: { accuracy: 0.89 },
              },
              final_scores: { accuracy: 0.93 },
            }),
          ],
        }),
      ],
    });

    const mounted = await renderHook(() => useResultsPageState());

    await waitFor(() => {
      expect(mounted.result.current!.isLoading).toBe(false);
      expect(mounted.result.current!.datasets).toHaveLength(2);
    });

    expect(apiMocks.getWorkspaceResultsSummary).toHaveBeenCalledWith("workspace-active");
    expect(mounted.result.current!.activeWorkspace?.name).toBe("Active workspace");
    expect(mounted.result.current!.metricContext).toEqual({
      taskType: null,
      taskTypes: ["classification", "regression"],
      availableMetricKeys: ["rmse", "accuracy"],
    });
    expect(mounted.result.current!.adaptedDatasets.map((item) => item.dataset_name)).toEqual(["Corn", "Wheat"]);
    expect(mounted.result.current!.adaptedDatasets[0]).toMatchObject({
      best_avg_val_score: 0.2,
      best_avg_test_score: 0.3,
      best_final_score: 0.25,
      pipeline_count: 1,
    });

    await act(async () => {
      mounted.result.current!.setSearchQuery("whe");
    });

    expect(mounted.result.current!.filteredDatasets.map((item) => item.dataset_name)).toEqual(["Wheat"]);
    expect(mounted.result.current!.adaptedDatasets.map((item) => item.dataset_name)).toEqual(["Wheat"]);
    expect(mounted.result.current!.metricContext).toEqual({
      taskType: "classification",
      taskTypes: ["classification"],
      availableMetricKeys: ["accuracy"],
    });

    await act(async () => {
      mounted.result.current!.setSearchQuery("missing");
    });

    expect(mounted.result.current!.filteredDatasets).toEqual([]);
    expect(mounted.result.current!.adaptedDatasets).toEqual([]);
    expect(mounted.result.current!.metricContext.taskTypes).toEqual(["classification", "regression"]);

    await mounted.unmount();
  });

  it("does not fetch summary data without an active workspace", async () => {
    linkedWorkspacesState.result = { data: { workspaces: [] } };

    const mounted = await renderHook(() => useResultsPageState());

    expect(mounted.result.current!.activeWorkspace).toBeNull();
    expect(mounted.result.current!.isLoading).toBe(false);
    expect(apiMocks.getWorkspaceResultsSummary).not.toHaveBeenCalled();

    await mounted.unmount();
  });
});
