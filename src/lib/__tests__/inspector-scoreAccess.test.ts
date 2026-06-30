import { describe, expect, it } from "vitest";

import {
  computeInspectorOutlierChainIds,
  computeInspectorScoreStats,
  getInspectorFiniteScore,
  getInspectorScoreValues,
  isInspectorScoreInRange,
  sortInspectorChainsByScore,
} from "@/lib/inspector/scoreAccess";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(
  chainId: string,
  cvValScore: unknown,
  metric: string | null = "rmse",
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: null,
    source_index: null,
    metric,
    task_type: "regression",
    dataset_name: "dataset",
    best_params: null,
    variant_params: null,
    cv_val_score: cvValScore as number | null,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
  };
}

describe("inspector score access", () => {
  it("normalizes finite numbers and object score payloads", () => {
    expect(getInspectorFiniteScore(makeChain("raw", 0.42), "cv_val_score")).toBe(0.42);
    expect(getInspectorFiniteScore(makeChain("value-object", { value: 0.31 }), "cv_val_score")).toBe(0.31);
    expect(getInspectorFiniteScore(makeChain("score-object", { score: 0.29 }), "cv_val_score")).toBe(0.29);
    expect(getInspectorFiniteScore(makeChain("nan", Number.NaN), "cv_val_score")).toBeNull();
    expect(getInspectorFiniteScore(makeChain("missing", null), "cv_val_score")).toBeNull();
  });

  it("builds score values, stats, range checks, and outlier ids from one accessor", () => {
    const chains = [
      makeChain("a", 1),
      makeChain("b", { value: 2 }),
      makeChain("c", 2),
      makeChain("d", 3),
      makeChain("e", 100),
      makeChain("ignored", null),
    ];

    expect(getInspectorScoreValues(chains, "cv_val_score")).toEqual([1, 2, 2, 3, 100]);
    expect(computeInspectorScoreStats(chains, "cv_val_score")).toEqual({ min: 1, max: 100, mean: 21.6 });
    expect(isInspectorScoreInRange(chains[1], "cv_val_score", 1.5, 2.5)).toBe(true);
    expect(isInspectorScoreInRange(chains[5], "cv_val_score", 1.5, 2.5)).toBe(false);
    expect([...computeInspectorOutlierChainIds(chains, "cv_val_score")]).toEqual(["e"]);
  });

  it("sorts with explicit score direction and keeps unscored chains last", () => {
    const chains = [
      makeChain("middle", 0.5),
      makeChain("missing", null),
      makeChain("best-low", 0.2),
      makeChain("best-high", 0.9),
    ];

    expect(
      sortInspectorChainsByScore(chains, "cv_val_score", { lowerBetter: true }).map((chain) => chain.chain_id),
    ).toEqual(["best-low", "middle", "best-high", "missing"]);
    expect(
      sortInspectorChainsByScore(chains, "cv_val_score", { lowerBetter: false }).map((chain) => chain.chain_id),
    ).toEqual(["best-high", "middle", "best-low", "missing"]);
  });
});
