import { describe, expect, it } from "vitest";
import { buildHistogramData } from "@/lib/inspector/analyticsHistogram";
import { buildHistogramData as buildHistogramDataReexport } from "@/lib/inspector/analytics";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(chainId: string, score: number | null): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline 1",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: [0],
    source_index: 0,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "diesel",
    best_params: {},
    variant_params: null,
    cv_val_score: score,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
  };
}

describe("inspector analytics histogram", () => {
  it("returns an empty distribution when no chain has a finite score", () => {
    const result = buildHistogramData([makeChain("a", null), makeChain("b", null)], "cv_val_score");
    expect(result.bins).toEqual([]);
    expect(result.total_chains).toBe(0);
    expect(result.min_score).toBeNull();
    expect(result.max_score).toBeNull();
    expect(result.mean_score).toBeNull();
    expect(result.score_column).toBe("cv_val_score");
  });

  it("collapses to a single bin when every score is identical", () => {
    const chains = [makeChain("a", 0.2), makeChain("b", 0.2), makeChain("c", 0.2)];
    const result = buildHistogramData(chains, "cv_val_score");
    expect(result.bins).toHaveLength(1);
    expect(result.bins[0]).toMatchObject({ bin_start: 0.2, bin_end: 0.2, count: 3 });
    expect(result.bins[0].chain_ids).toEqual(["a", "b", "c"]);
    expect(result.mean_score).toBeCloseTo(0.2);
  });

  it("buckets finite scores into equal-width bins and keeps min/max/mean", () => {
    const chains = [
      makeChain("a", 0),
      makeChain("b", 5),
      makeChain("c", 10),
      makeChain("skip", null),
    ];
    const result = buildHistogramData(chains, "cv_val_score", 5);

    expect(result.total_chains).toBe(3);
    expect(result.min_score).toBe(0);
    expect(result.max_score).toBe(10);
    expect(result.mean_score).toBeCloseTo(5);
    expect(result.bins).toHaveLength(5);

    const totalCount = result.bins.reduce((sum, bin) => sum + bin.count, 0);
    expect(totalCount).toBe(3);
    const allIds = result.bins.flatMap(bin => bin.chain_ids);
    expect(allIds.sort()).toEqual(["a", "b", "c"]);
    // The maximum-valued chain lands in the last bin (inclusive upper edge).
    expect(result.bins[result.bins.length - 1].chain_ids).toContain("c");
  });

  it("clamps the bin count to at least five even with few scores", () => {
    const chains = [makeChain("a", 1), makeChain("b", 9)];
    const result = buildHistogramData(chains, "cv_val_score", 12);
    expect(result.bins).toHaveLength(5);
  });

  it("is re-exported unchanged from the analytics barrel", () => {
    expect(buildHistogramDataReexport).toBe(buildHistogramData);
  });
});
