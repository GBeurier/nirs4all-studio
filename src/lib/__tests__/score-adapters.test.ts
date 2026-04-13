import { describe, expect, it } from "vitest";

import { datasetChainsToRows } from "../score-adapters";
import type { TopChainResult } from "@/types/enriched-runs";

function makeChain(overrides: Partial<TopChainResult>): TopChainResult {
  return {
    chain_id: overrides.chain_id ?? "chain",
    run_id: overrides.run_id,
    pipeline_id: overrides.pipeline_id,
    pipeline_name: overrides.pipeline_name ?? null,
    model_name: overrides.model_name ?? "PLSRegression",
    model_class: overrides.model_class ?? "PLSRegression",
    preprocessings: overrides.preprocessings ?? "",
    avg_val_score: overrides.avg_val_score ?? null,
    avg_test_score: overrides.avg_test_score ?? null,
    avg_train_score: overrides.avg_train_score ?? null,
    fold_count: overrides.fold_count ?? 0,
    scores: overrides.scores ?? { val: {}, test: {} },
    final_test_score: overrides.final_test_score ?? null,
    final_train_score: overrides.final_train_score ?? null,
    final_scores: overrides.final_scores ?? {},
    best_params: overrides.best_params ?? null,
    variant_params: overrides.variant_params ?? null,
    is_refit_only: overrides.is_refit_only,
  };
}

describe("datasetChainsToRows", () => {
  it("pairs refit rows with the matching CV variant even when preprocessing spacing differs", () => {
    const rows = datasetChainsToRows([
      makeChain({
        chain_id: "refit-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV > SG(11,2)",
        final_test_score: 0.21,
        final_scores: { rmse: 0.21 },
      }),
      makeChain({
        chain_id: "cv-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV>SG(11,2)",
        avg_val_score: 0.24,
        avg_test_score: 0.25,
        fold_count: 5,
        scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
        best_params: { n_components: 8 },
      }),
      makeChain({
        chain_id: "cv-msc",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "MSC",
        avg_val_score: 0.18,
        avg_test_score: 0.2,
        fold_count: 5,
        scores: { val: { rmse: 0.18 }, test: { rmse: 0.2 } },
      }),
    ], "rmse", "regression");

    expect(rows).toHaveLength(2);
    expect(rows[0]?.cardType).toBe("refit");
    expect(rows[0]?.children).toHaveLength(1);
    expect(rows[0]?.children?.[0]?.chainId).toBe("cv-snv");
    expect(rows[1]?.cardType).toBe("crossval");
    expect(rows[1]?.chainId).toBe("cv-msc");
  });

  it("keeps CV variants with different preprocessing chains visible", () => {
    const rows = datasetChainsToRows([
      makeChain({
        chain_id: "refit-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        final_test_score: 0.19,
        final_scores: { rmse: 0.19 },
      }),
      makeChain({
        chain_id: "cv-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        avg_val_score: 0.22,
        avg_test_score: 0.23,
        fold_count: 5,
        scores: { val: { rmse: 0.22 }, test: { rmse: 0.23 } },
      }),
      makeChain({
        chain_id: "cv-msc",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "MSC",
        avg_val_score: 0.24,
        avg_test_score: 0.25,
        fold_count: 5,
        scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
      }),
    ], "rmse", "regression");

    const cvRows = rows.filter(row => row.cardType === "crossval");
    expect(cvRows).toHaveLength(1);
    expect(cvRows[0]?.chainId).toBe("cv-msc");
  });
});
