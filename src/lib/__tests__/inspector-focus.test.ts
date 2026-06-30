import { describe, expect, it } from "vitest";

import {
  buildInspectorFocusStateFromStore,
  buildInspectorFocusState,
  getInspectorFocusTask,
  isInspectorClassificationTask,
} from "@/lib/inspector/focus";
import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(
  chainId: string,
  score: number,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: null,
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "dataset",
    best_params: null,
    variant_params: null,
    cv_val_score: score,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector focus", () => {
  const chains = [
    makeChain("middle", 0.2, { model_name: "Middle" }),
    makeChain("best", 0.1, { model_name: "Best" }),
    makeChain("worst", 0.9, { model_name: "Worst" }),
    makeChain("second", 0.15, { model_name: "Second" }),
  ];

  it("uses top sorted chains when there is no selected or pinned focus", () => {
    const focus = buildInspectorFocusState({
      chains,
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(),
      pinnedChainIds: new Set(),
      limit: 2,
    });

    expect(focus.mode).toBe("top");
    expect(focus.chainIds).toEqual(["best", "second"]);
    expect(focus.labelChains).toEqual([
      { chain_id: "best", label: "Best" },
      { chain_id: "second", label: "Second" },
    ]);
  });

  it("prefers selected chains over pinned chains and keeps score order", () => {
    const focus = buildInspectorFocusState({
      chains,
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(["worst", "middle"]),
      pinnedChainIds: new Set(["best"]),
      limit: 4,
    });

    expect(focus.mode).toBe("selection");
    expect(focus.selectedVisibleIds).toEqual(["middle", "worst"]);
    expect(focus.pinnedVisibleIds).toEqual(["best"]);
    expect(focus.chainIds).toEqual(["middle", "worst"]);
  });

  it("uses pinned chains when nothing is selected and excludes selected ids from pinned ids", () => {
    const focus = buildInspectorFocusState({
      chains,
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(["not-visible"]),
      pinnedChainIds: new Set(["worst", "best"]),
      limit: 4,
    });

    expect(focus.mode).toBe("pinned");
    expect(focus.chainIds).toEqual(["best", "worst"]);
  });

  it("derives focus task and topology pipeline id from focused chains", () => {
    const mixedPipelineChains = [
      makeChain("regression", 0.1, { pipeline_id: "pipe-1", task_type: "regression" }),
      makeChain("classification", 0.2, { pipeline_id: "pipe-2", task_type: "classification" }),
    ];
    const focus = buildInspectorFocusState({
      chains: mixedPipelineChains,
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(),
      pinnedChainIds: new Set(),
      limit: 2,
    });

    expect(isInspectorClassificationTask("binary_classification")).toBe(true);
    expect(getInspectorFocusTask([])).toBe("none");
    expect(getInspectorFocusTask([mixedPipelineChains[0]])).toBe("regression");
    expect(getInspectorFocusTask([mixedPipelineChains[1]])).toBe("classification");
    expect(focus.task).toBe("mixed");
    expect(focus.topologyPipelineId).toBeNull();
  });

  it("returns the unique topology pipeline id when focus stays within one pipeline", () => {
    const focus = buildInspectorFocusState({
      chains: [
        makeChain("a", 0.1, { pipeline_id: "pipe-one" }),
        makeChain("b", 0.2, { pipeline_id: "pipe-one" }),
      ],
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(),
      pinnedChainIds: new Set(),
      limit: 2,
    });

    expect(focus.topologyPipelineId).toBe("pipe-one");
  });

  it("builds focus state from a result analysis store", () => {
    const store = buildResultAnalysisStore({ chains });
    const focus = buildInspectorFocusStateFromStore({
      store,
      scoreColumn: "cv_val_score",
      selectedChainIds: new Set(["worst", "best"]),
      pinnedChainIds: new Set(),
      limit: 4,
    });

    expect(focus.mode).toBe("selection");
    expect(focus.chainIds).toEqual(["best", "worst"]);
    expect(focus.sortedChains.map(chain => chain.chain_id)).toEqual(["best", "second", "middle", "worst"]);
  });
});
