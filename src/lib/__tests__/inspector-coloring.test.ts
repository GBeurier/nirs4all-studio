import { describe, expect, it } from "vitest";

import {
  computeInspectorColorScoreRange,
  INSPECTOR_DEFAULT_OPACITY,
  INSPECTOR_FALLBACK_COLOR,
  resolveInspectorChainColor,
  resolveInspectorChainOpacity,
} from "@/lib/inspector/coloring";
import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { InspectorChainSummary, InspectorColorConfig, InspectorGroup } from "@/types/inspector";

function chain(
  chainId: string,
  score: number | null,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: null,
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: [],
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Dataset A",
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

const baseConfig: InspectorColorConfig = {
  mode: "group",
  continuousPalette: "blue_red",
  categoricalPalette: "default",
  unselectedOpacity: 0.25,
  highlightSelection: true,
  highlightHover: true,
};

describe("inspector store-backed coloring", () => {
  const store = buildResultAnalysisStore({
    chains: [
      chain("low", 1, { dataset_name: "Dataset A", model_class: "PLSRegression" }),
      chain("mid", 2, { dataset_name: "Dataset B", model_class: "SVR" }),
      chain("high", 3, { dataset_name: "Dataset C", model_class: "RandomForest" }),
      chain("missing", null, { dataset_name: null }),
    ],
  });
  const groups: InspectorGroup[] = [
    { id: "g1", label: "Selected", color: "#123456", chain_ids: ["mid"] },
  ];
  const getChainGroup = (chainId: string) => groups.find(group => group.chain_ids.includes(chainId));

  it("computes score ranges from finite scores", () => {
    expect(computeInspectorColorScoreRange(store, "cv_val_score")).toEqual({ min: 1, max: 3 });
    expect(computeInspectorColorScoreRange(
      buildResultAnalysisStore({ chains: [chain("missing", null)] }),
      "cv_val_score",
    )).toBeNull();
  });

  it("resolves group and unknown-chain colors", () => {
    expect(resolveInspectorChainColor({
      store,
      chainId: "mid",
      config: baseConfig,
      scoreColumn: "cv_val_score",
      scoreRange: computeInspectorColorScoreRange(store, "cv_val_score"),
      getChainGroup,
      availableDatasets: [],
      availableModels: [],
    })).toBe("#123456");

    expect(resolveInspectorChainColor({
      store,
      chainId: "unknown",
      config: baseConfig,
      scoreColumn: "cv_val_score",
      scoreRange: null,
      getChainGroup,
      availableDatasets: [],
      availableModels: [],
    })).toBe(INSPECTOR_FALLBACK_COLOR);
  });

  it("resolves score, dataset, and model colors from store metadata", () => {
    expect(resolveInspectorChainColor({
      store,
      chainId: "mid",
      config: { ...baseConfig, mode: "score" },
      scoreColumn: "cv_val_score",
      scoreRange: computeInspectorColorScoreRange(store, "cv_val_score"),
      getChainGroup,
      availableDatasets: [],
      availableModels: [],
    })).toBe("hsl(120, 70%, 50%)");

    expect(resolveInspectorChainColor({
      store,
      chainId: "mid",
      config: { ...baseConfig, mode: "dataset" },
      scoreColumn: "cv_val_score",
      scoreRange: null,
      getChainGroup,
      availableDatasets: ["Dataset A", "Dataset B"],
      availableModels: [],
    })).toBe("hsl(217, 70%, 50%)");

    expect(resolveInspectorChainColor({
      store,
      chainId: "high",
      config: { ...baseConfig, mode: "model_class", categoricalPalette: "tableau10" },
      scoreColumn: "cv_val_score",
      scoreRange: null,
      getChainGroup,
      availableDatasets: [],
      availableModels: ["PLSRegression", "SVR", "RandomForest"],
    })).toBe("#e15759");
  });

  it("resolves opacity from hover and selection state", () => {
    expect(resolveInspectorChainOpacity({
      chainId: "a",
      hoveredChain: "a",
      hasSelection: true,
      selectedChainIds: new Set(),
      unselectedOpacity: 0.2,
    })).toBe(1);

    expect(resolveInspectorChainOpacity({
      chainId: "a",
      hoveredChain: null,
      hasSelection: true,
      selectedChainIds: new Set(["b"]),
      unselectedOpacity: 0.2,
    })).toBe(0.2);

    expect(resolveInspectorChainOpacity({
      chainId: "a",
      hoveredChain: null,
      hasSelection: false,
      selectedChainIds: new Set(),
      unselectedOpacity: 0.2,
    })).toBe(INSPECTOR_DEFAULT_OPACITY);
  });
});
