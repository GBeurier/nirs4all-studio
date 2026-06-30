/**
 * @vitest-environment jsdom
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InspectorViewProvider } from "@/context/InspectorViewContext";
import { ALL_PANELS } from "@/context/useInspectorView";
import type {
  InspectorChainSummary,
  InspectorGroup,
  InspectorPanelType,
  InspectorViewState,
} from "@/types/inspector";

import {
  intersectInspectorGroups,
  useInspectorPanelRuntime,
  type UseInspectorPanelRuntimeInput,
} from "./useInspectorPanelRuntime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function makeChain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline 1",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: [],
    source_index: null,
    metric: "r2",
    task_type: "regression",
    dataset_name: "Dataset 1",
    best_params: { alpha: 0.1, beta: 0.2 },
    variant_params: null,
    cv_val_score: 0.82,
    cv_test_score: 0.78,
    cv_train_score: 0.91,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

function makePanelStates(openPanels: InspectorPanelType[]): Record<InspectorPanelType, InspectorViewState> {
  return ALL_PANELS.reduce((states, panel) => {
    states[panel] = openPanels.includes(panel) ? "visible" : "hidden";
    return states;
  }, {} as Record<InspectorPanelType, InspectorViewState>);
}

function makeInput(overrides: Partial<UseInspectorPanelRuntimeInput> = {}): UseInspectorPanelRuntimeInput {
  const chains = [makeChain(), makeChain({
    chain_id: "chain-2",
    model_class: "SVR",
    model_name: "SVR",
    dataset_name: "Dataset 2",
    cv_val_score: 0.72,
  })];

  return {
    groups: [
      { id: "g1", label: "Group 1", color: "#2563eb", chain_ids: ["chain-1", "hidden-chain"] },
      { id: "g2", label: "Group 2", color: "#dc2626", chain_ids: ["hidden-chain"] },
    ],
    filteredChains: chains,
    filteredChainIds: new Set(["chain-1", "chain-2"]),
    selectedChains: new Set(),
    pinnedChains: new Set(),
    scoreColumn: "cv_val_score",
    partition: "test",
    panelStates: makePanelStates(["rankings", "heatmap"]),
    maximizedPanel: null,
    hasMaximized: false,
    layoutMode: "auto",
    ...overrides,
  };
}

interface RenderHookOptions {
  input?: UseInspectorPanelRuntimeInput;
}

async function renderHook({ input = makeInput() }: RenderHookOptions = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const result: { current: ReturnType<typeof useInspectorPanelRuntime> | undefined } = { current: undefined };

  function TestComponent() {
    result.current = useInspectorPanelRuntime(input);
    return null;
  }

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <InspectorViewProvider>
          <TestComponent />
        </InspectorViewProvider>
      </QueryClientProvider>
    );
  });

  return {
    result,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      queryClient.clear();
      container.remove();
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("intersectInspectorGroups", () => {
  it("keeps only visible chain ids and drops empty groups", () => {
    const groups: InspectorGroup[] = [
      { id: "a", label: "A", color: "#000", chain_ids: ["chain-1", "chain-2"] },
      { id: "b", label: "B", color: "#111", chain_ids: ["chain-3"] },
    ];

    expect(intersectInspectorGroups(groups, new Set(["chain-2"]))).toEqual([
      { id: "a", label: "A", color: "#000", chain_ids: ["chain-2"] },
    ]);
  });
});

describe("useInspectorPanelRuntime", () => {
  it("builds panel runtime state and exposes stable renderer inputs", async () => {
    const mounted = await renderHook();

    expect(mounted.result.current!.visibleGroups).toEqual([
      { id: "g1", label: "Group 1", color: "#2563eb", chain_ids: ["chain-1"] },
    ]);
    expect(mounted.result.current!.panelIdsToRender).toEqual(expect.arrayContaining(["rankings", "heatmap"]));
    expect(mounted.result.current!.panelQueryInputs.scatter).toBeNull();
    expect(mounted.result.current!.gridClassName).toContain("xl:grid-cols-2");
    expect(mounted.result.current!.workspaceSummary.modelCount).toBe(2);
    expect(mounted.result.current!.panelData.rankingsData.rankings).toHaveLength(2);
    expect(mounted.result.current!.analysisStore.scope.totalChains).toBe(2);
    expect(mounted.result.current!.analysisStore.scope.datasetNames).toEqual(["Dataset 1", "Dataset 2"]);
    expect(mounted.result.current!.resultAnalysisSummaryCounters.map(counter => [counter.id, counter.formattedValue])).toEqual([
      ["leaderboard.total", "2"],
      ["leaderboard.scored", "2"],
      ["leaderboard.missing", "0"],
      ["matrix.rows", "2"],
      ["matrix.columns", "2"],
      ["matrix.cells", "2"],
      ["matrix.scoredCells", "2"],
      ["matrix.assignments", "2"],
    ]);
    expect(mounted.result.current!.queries.scatter.isLoading).toBe(false);

    await act(async () => {
      mounted.result.current!.controls.onHyperParamChange("beta");
    });
    expect(mounted.result.current!.panelData.chartInputs.activeHyperParam).toBe("beta");

    await act(async () => {
      mounted.result.current!.controls.onHeatmapXAxisChange("preprocessings");
    });
    expect(mounted.result.current!.panelData.chartInputs.heatmapAxes.xVariable).toBe("preprocessings");

    await mounted.unmount();
  });

  it("exposes the metric-observation read model for the filtered chains", async () => {
    const mounted = await renderHook();

    const model = mounted.result.current!.metricObservations;
    expect(model.hasObservations).toBe(true);
    expect(model.metricKeys).toEqual(["r2"]);
    expect(model.unmappedScoreRefs).toEqual([]);

    const byLegacyColumn = Object.fromEntries(
      model.scoreRefs.map(scoreRef => [scoreRef.legacyScoreColumn, scoreRef]),
    );
    expect(byLegacyColumn.cv_val_score).toMatchObject({
      metric: "r2",
      observationCount: 2,
    });

    await mounted.unmount();
  });

  it("uses the observed score column for runtime focus and result-analysis read models", async () => {
    const mounted = await renderHook({
      input: makeInput({
        scoreColumn: "cv_train_score",
        filteredChains: [
          makeChain({
            chain_id: "chain-a",
            model_class: "PLSRegression",
            model_name: "PLS",
            dataset_name: "Dataset A",
            cv_val_score: null,
            cv_test_score: null,
            cv_train_score: null,
            final_test_score: 0.12,
          }),
          makeChain({
            chain_id: "chain-b",
            model_class: "RandomForestRegressor",
            model_name: "RF",
            dataset_name: "Dataset B",
            cv_val_score: null,
            cv_test_score: null,
            cv_train_score: null,
            final_test_score: 0.18,
          }),
        ],
        filteredChainIds: new Set(["chain-a", "chain-b"]),
      }),
    });

    expect(mounted.result.current!.effectiveScoreColumn).toBe("final_test_score");
    expect(mounted.result.current!.effectiveScoreRef).toMatchObject({
      metric: "r2",
      protocol: "final",
      partition: "test",
      aggregation: "final_model",
      legacyScoreColumn: "final_test_score",
    });
    expect(mounted.result.current!.focus.orderedVisibleIds).toEqual(["chain-b", "chain-a"]);
    expect(mounted.result.current!.panelData.rankingsData.score_column).toBe("final_test_score");
    expect(mounted.result.current!.workspaceSummary.bestChainLabel).toBe("RF");
    expect(mounted.result.current!.resultAnalysisSummaryCounters.map(counter => [
      counter.id,
      counter.formattedValue,
    ])).toEqual([
      ["leaderboard.total", "2"],
      ["leaderboard.scored", "2"],
      ["leaderboard.missing", "0"],
      ["matrix.rows", "2"],
      ["matrix.columns", "2"],
      ["matrix.cells", "2"],
      ["matrix.scoredCells", "2"],
      ["matrix.assignments", "2"],
    ]);

    await mounted.unmount();
  });

  it("uses an explicit selected score-ref key before the legacy score-column fallback", async () => {
    const mounted = await renderHook({
      input: makeInput({
        scoreColumn: "cv_val_score",
        selectedScoreRefKey: "metric=r2|protocol=final|partition=test|aggregation=final_model",
        filteredChains: [
          makeChain({
            chain_id: "chain-a",
            model_class: "PLSRegression",
            model_name: "PLS",
            dataset_name: "Dataset A",
            cv_val_score: 0.4,
            final_test_score: 0.12,
          }),
          makeChain({
            chain_id: "chain-b",
            model_class: "RandomForestRegressor",
            model_name: "RF",
            dataset_name: "Dataset B",
            cv_val_score: 0.5,
            final_test_score: 0.18,
          }),
        ],
        filteredChainIds: new Set(["chain-a", "chain-b"]),
      }),
    });

    expect(mounted.result.current!.effectiveScoreColumn).toBe("final_test_score");
    expect(mounted.result.current!.effectiveScoreRef).toMatchObject({
      metric: "r2",
      protocol: "final",
      partition: "test",
      aggregation: "final_model",
      legacyScoreColumn: "final_test_score",
    });
    expect(mounted.result.current!.focus.orderedVisibleIds).toEqual(["chain-b", "chain-a"]);
    expect(mounted.result.current!.panelData.rankingsData.score_column).toBe("final_test_score");

    await mounted.unmount();
  });

  it("limits rendered panels to the maximized panel", async () => {
    const mounted = await renderHook({
      input: makeInput({
        panelStates: makePanelStates(["rankings", "heatmap", "histogram"]),
        maximizedPanel: "heatmap",
        hasMaximized: true,
      }),
    });

    expect(mounted.result.current!.panelIdsToRender).toEqual(["heatmap"]);
    expect(mounted.result.current!.gridClassName).toBe("grid grid-cols-1");

    await mounted.unmount();
  });

  it("passes the selected target index to target-aware panel queries", async () => {
    const mounted = await renderHook({
      input: makeInput({
        targetIndex: 2,
        panelStates: makePanelStates(["scatter"]),
      }),
    });

    expect(mounted.result.current!.panelQueryInputs.scatter).toEqual({
      chain_ids: ["chain-1", "chain-2"],
      partition: "test",
      target_index: 2,
    });

    await mounted.unmount();
  });

  it("exposes compact metadata facet counters for the filtered scope", async () => {
    const mounted = await renderHook({
      input: makeInput({
        filteredChains: [
          makeChain({
            chain_id: "chain-1",
            variant_params: {
              result_metadata: {
                target_name: "moisture",
                backend: "dag-ml",
                dimensions: {
                  fold_index: 0,
                  repetition_policy: "raw",
                },
              },
            },
          }),
          makeChain({
            chain_id: "chain-2",
            model_class: "SVR",
            model_name: "SVR",
            dataset_name: "Dataset 2",
            variant_params: {
              result_metadata: {
                target_name: "protein",
                backend: "dag-ml",
                dimensions: {
                  fold_index: 1,
                  repetition_policy: "raw",
                },
              },
            },
          }),
        ],
      }),
    });

    expect(mounted.result.current!.resultAnalysisMetadataFacetCounters.map(counter => [
      counter.id,
      counter.formattedValue,
    ])).toEqual([
      ["metadata.facets", "2"],
      ["dimension.facets", "2"],
      ["summary.uniqueValues", "6"],
      ["dimension:fold_index.values", "2 values"],
      ["metadata:target_name.values", "2 values"],
      ["metadata:backend.values", "1 value"],
    ]);

    await mounted.unmount();
  });
});
