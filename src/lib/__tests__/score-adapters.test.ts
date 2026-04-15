import { describe, expect, it } from "vitest";

import {
  buildFoldTrainCards,
  chainSummaryToRow,
  collapseStandaloneRefitSummaries,
  datasetChainsToRows,
  enrichCrossvalRow,
  predictionRecordToRow,
} from "../score-adapters";
import type { TopChainResult } from "@/types/enriched-runs";
import type { ChainSummary, PartitionPrediction } from "@/types/aggregated-predictions";
import type { PredictionRecord } from "@/types/linked-workspaces";

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
    cv_source_chain_id: overrides.cv_source_chain_id ?? null,
    final_test_score: overrides.final_test_score ?? null,
    final_train_score: overrides.final_train_score ?? null,
    final_scores: overrides.final_scores ?? {},
    final_agg_test_score: overrides.final_agg_test_score ?? null,
    final_agg_train_score: overrides.final_agg_train_score ?? null,
    final_agg_scores: overrides.final_agg_scores ?? null,
    best_params: overrides.best_params ?? null,
    variant_params: overrides.variant_params ?? null,
    is_refit_only: overrides.is_refit_only,
    synthetic_refit: overrides.synthetic_refit,
  };
}

function makePredictionRecord(overrides: Partial<PredictionRecord>): PredictionRecord {
  return {
    id: overrides.id ?? "pred",
    source_dataset: overrides.source_dataset ?? "dataset_a",
    source_file: overrides.source_file ?? "pred.meta.parquet",
    dataset_name: overrides.dataset_name ?? "dataset_a",
    model_name: overrides.model_name ?? "PLSRegression",
    partition: overrides.partition ?? "test",
    preprocessings: overrides.preprocessings ?? "SNV",
    scores: overrides.scores ?? { test: { rmse: 0.24 } },
    ...overrides,
  };
}

function makePartitionPrediction(overrides: Partial<PartitionPrediction>): PartitionPrediction {
  return {
    prediction_id: overrides.prediction_id ?? "ppred",
    pipeline_id: overrides.pipeline_id ?? "pipe",
    chain_id: overrides.chain_id ?? "chain",
    dataset_name: overrides.dataset_name ?? "dataset_a",
    model_name: overrides.model_name ?? "PLSRegression",
    model_class: overrides.model_class ?? "PLSRegression",
    fold_id: overrides.fold_id ?? "0",
    partition: overrides.partition ?? "test",
    val_score: overrides.val_score ?? null,
    test_score: overrides.test_score ?? null,
    train_score: overrides.train_score ?? null,
    scores: overrides.scores ?? null,
    best_params: overrides.best_params ?? null,
    metric: overrides.metric ?? "rmse",
    task_type: overrides.task_type ?? "regression",
    n_samples: overrides.n_samples ?? 12,
    n_features: overrides.n_features ?? 4,
    preprocessings: overrides.preprocessings ?? "SNV",
  };
}

describe("datasetChainsToRows", () => {
  it("preserves extended regression metrics from final score payloads", () => {
    const row = datasetChainsToRows([
      makeChain({
        chain_id: "refit-extended",
        final_test_score: 0.19,
        final_scores: {
          test: {
            rmse: 0.19,
            nrmse: 0.04,
            sep: 0.17,
            rpd: 5.1,
            pearson_r: 0.93,
            spearman_r: 0.91,
            explained_variance: 0.88,
            max_error: 0.42,
            median_ae: 0.11,
            nmse: 0.02,
            nmae: 0.03,
            consistency: 0.81,
          },
        },
      }),
    ], "rmse", "regression")[0];

    expect(row?.testScores.nrmse).toBe(0.04);
    expect(row?.testScores.sep).toBe(0.17);
    expect(row?.testScores.rpd).toBe(5.1);
    expect(row?.testScores.pearson_r).toBe(0.93);
    expect(row?.testScores.spearman_r).toBe(0.91);
    expect(row?.testScores.explained_variance).toBe(0.88);
    expect(row?.testScores.max_error).toBe(0.42);
    expect(row?.testScores.median_ae).toBe(0.11);
    expect(row?.testScores.nmse).toBe(0.02);
    expect(row?.testScores.nmae).toBe(0.03);
    expect(row?.testScores.consistency).toBe(0.81);
  });

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

  it("adds an aggregated refit twin next to the raw refit row", () => {
    const rows = datasetChainsToRows([
      makeChain({
        chain_id: "refit-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        final_test_score: 0.19,
        final_scores: { test: { rmse: 0.19 } },
        final_agg_test_score: 0.17,
        final_agg_train_score: 0.11,
        final_agg_scores: { test: { rmse: 0.17 }, train: { rmse: 0.11 } },
        variant_params: { n_components: 8 },
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
        variant_params: { n_components: 8 },
      }),
    ], "rmse", "regression");

    expect(rows).toHaveLength(2);
    expect(rows[0]?.cardType).toBe("refit");
    expect(rows[0]?.children?.[0]?.chainId).toBe("cv-snv");
    expect(rows[0]?.foldId).toBe("final");
    expect(rows[1]?.cardType).toBe("refit");
    expect(rows[1]?.foldId).toBe("final_agg");
    expect(rows[1]?.primaryTestScore).toBe(0.17);
    expect(rows[1]?.primaryTrainScore).toBe(0.11);
    expect(rows[1]?.testScores?.rmse).toBe(0.17);
    expect(rows[1]?.children?.[0]?.foldId).toBe("avg_agg");
    expect(rows[1]?.children?.[0]?.chainId).toBe("cv-snv");
  });

  it("treats synthetic refits as non-exportable fallback rows", () => {
    const row = datasetChainsToRows([
      makeChain({
        chain_id: "cv-only",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        avg_val_score: 0.22,
        avg_test_score: 0.23,
        avg_train_score: 0.12,
        fold_count: 5,
        scores: { val: { rmse: 0.22 }, test: { rmse: 0.23 } },
        final_test_score: 0.23,
        final_train_score: 0.12,
        final_scores: { val: { rmse: 0.22 }, test: { rmse: 0.23 }, train: { rmse: 0.12 } },
        synthetic_refit: true,
      }),
    ], "rmse", "regression")[0];

    expect(row?.cardType).toBe("refit");
    expect(row?.primaryTestScore).toBe(0.23);
    expect(row?.children?.[0]?.cardType).toBe("crossval");
    expect(row?.hasRefitArtifact).toBe(false);
  });

  it("keeps standalone refits as a single displayed model with no synthetic CV branch", () => {
    const rows = datasetChainsToRows([
      makeChain({
        chain_id: "refit-only",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "MinMax",
        final_test_score: 0.21,
        final_train_score: 0.11,
        final_scores: { test: { rmse: 0.21 }, train: { rmse: 0.11 } },
        is_refit_only: true,
      }),
      makeChain({
        chain_id: "cv-duplicate",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "MinMax",
        avg_val_score: 0.24,
        avg_test_score: 0.25,
        fold_count: 2,
        scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
      }),
    ], "rmse", "regression");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.cardType).toBe("refit");
    expect(rows[0]?.children).toEqual([]);
    expect(rows[0]?.foldCount).toBe(0);
    expect(rows[0]?.primaryValScore).toBeNull();
  });

  it("reuses the backend CV source chain id when only the refit summary is present", () => {
    const rows = datasetChainsToRows([
      makeChain({
        chain_id: "refit-only",
        cv_source_chain_id: "cv-chain",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        avg_val_score: 0.24,
        avg_test_score: 0.25,
        fold_count: 7,
        scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
        final_test_score: 0.21,
        final_train_score: 0.11,
        final_scores: { test: { rmse: 0.21 }, train: { rmse: 0.11 } },
        final_agg_test_score: 0.2,
        final_agg_train_score: 0.1,
        final_agg_scores: { test: { rmse: 0.2 }, train: { rmse: 0.1 } },
      }),
    ], "rmse", "regression");

    expect(rows).toHaveLength(2);
    expect(rows[0]?.children?.[0]?.chainId).toBe("cv-chain");
    expect(rows[0]?.children?.[0]?.foldId).toBe("avg");
    expect(rows[1]?.children?.[0]?.chainId).toBe("cv-chain");
    expect(rows[1]?.children?.[0]?.foldId).toBe("avg_agg");
  });
});

function makeChainSummary(overrides: Partial<ChainSummary>): ChainSummary {
  return {
    run_id: overrides.run_id ?? "run",
    pipeline_id: overrides.pipeline_id ?? "pipe",
    chain_id: overrides.chain_id ?? "chain",
    model_name: overrides.model_name ?? "PLSRegression",
    model_class: overrides.model_class ?? "PLSRegression",
    preprocessings: overrides.preprocessings ?? "SNV",
    branch_path: overrides.branch_path ?? null,
    source_index: overrides.source_index ?? null,
    model_step_idx: overrides.model_step_idx ?? 1,
    metric: overrides.metric ?? "rmse",
    task_type: overrides.task_type ?? "regression",
    dataset_name: overrides.dataset_name ?? "dataset_a",
    best_params: overrides.best_params ?? null,
    cv_val_score: overrides.cv_val_score ?? null,
    cv_test_score: overrides.cv_test_score ?? null,
    cv_train_score: overrides.cv_train_score ?? null,
    cv_fold_count: overrides.cv_fold_count ?? 0,
    cv_scores: overrides.cv_scores ?? null,
    cv_source_chain_id: overrides.cv_source_chain_id ?? null,
    final_test_score: overrides.final_test_score ?? null,
    final_train_score: overrides.final_train_score ?? null,
    final_scores: overrides.final_scores ?? null,
    final_agg_test_score: overrides.final_agg_test_score ?? null,
    final_agg_train_score: overrides.final_agg_train_score ?? null,
    final_agg_scores: overrides.final_agg_scores ?? null,
    synthetic_refit: overrides.synthetic_refit ?? false,
    is_refit_only: overrides.is_refit_only ?? false,
    pipeline_status: overrides.pipeline_status ?? "completed",
    fold_artifacts: overrides.fold_artifacts ?? null,
  };
}

describe("collapseStandaloneRefitSummaries", () => {
  it("drops matching CV duplicates and clears synthetic CV metadata from standalone refits", () => {
    const rows = collapseStandaloneRefitSummaries([
      makeChainSummary({
        chain_id: "refit-only",
        preprocessings: "MinMax",
        final_test_score: 0.21,
        final_train_score: 0.11,
        cv_val_score: 0.24,
        cv_test_score: 0.25,
        cv_fold_count: 2,
        cv_scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
        is_refit_only: true,
      }),
      makeChainSummary({
        chain_id: "cv-duplicate",
        preprocessings: "MinMax",
        final_test_score: null,
        cv_val_score: 0.24,
        cv_test_score: 0.25,
        cv_fold_count: 2,
        cv_scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.chain_id).toBe("refit-only");
    expect(rows[0]?.cv_val_score).toBeNull();
    expect(rows[0]?.cv_fold_count).toBe(0);
    expect(rows[0]?.cv_scores).toBeNull();
  });
});

describe("chainSummaryToRow", () => {
  it("uses the matched CV source chain id for refit summaries", () => {
    const row = chainSummaryToRow(makeChainSummary({
      chain_id: "refit-only",
      cv_source_chain_id: "cv-chain",
      cv_val_score: 0.24,
      cv_test_score: 0.25,
      cv_fold_count: 7,
      cv_scores: { val: { rmse: 0.24 }, test: { rmse: 0.25 } },
      final_test_score: 0.21,
      final_train_score: 0.11,
      final_scores: { test: { rmse: 0.21 }, train: { rmse: 0.11 } },
    }));

    expect(row.cardType).toBe("refit");
    expect(row.children?.[0]?.chainId).toBe("cv-chain");
  });
});

describe("predictionRecordToRow", () => {
  it("maps final folds to refit rows and average folds to crossval rows", () => {
    expect(predictionRecordToRow(makePredictionRecord({
      id: "pred-final",
      fold_id: "final",
      model_artifact_id: "artifact-final",
    }))).toMatchObject({
      cardType: "refit",
      foldId: "final",
      hasRefitArtifact: true,
    });

    expect(predictionRecordToRow(makePredictionRecord({
      id: "pred-final-agg",
      fold_id: "final_agg",
      model_artifact_id: "artifact-final-agg",
    }))).toMatchObject({
      cardType: "refit",
      foldId: "final_agg",
      hasRefitArtifact: false,
    });

    expect(predictionRecordToRow(makePredictionRecord({
      id: "pred-avg",
      fold_id: "avg",
    }))).toMatchObject({
      cardType: "crossval",
      foldId: "avg",
    });

    expect(predictionRecordToRow(makePredictionRecord({
      id: "pred-wavg-agg",
      fold_id: "w_avg_agg",
    }))).toMatchObject({
      cardType: "crossval",
      foldId: "w_avg_agg",
    });

    expect(predictionRecordToRow(makePredictionRecord({
      id: "pred-fold",
      fold_id: "2",
      partition: "val",
    }))).toMatchObject({
      cardType: "train",
      foldId: "2",
    });
  });

  it("parses stringified scores and params from store-backed prediction records", () => {
    const row = predictionRecordToRow(makePredictionRecord({
      fold_id: "final",
      scores: JSON.stringify({
        test: { rmse: 0.24, r2: 0.91, rpd: 4.2 },
        train: { rmse: 0.11 },
      }),
      best_params: JSON.stringify({ n_components: 8 }),
      test_score: 0.24,
      train_score: 0.11,
    }));

    expect(row.cardType).toBe("refit");
    expect(row.testScores.rmse).toBe(0.24);
    expect(row.testScores.r2).toBe(0.91);
    expect(row.testScores.rpd).toBe(4.2);
    expect(row.trainScores.rmse).toBe(0.11);
    expect(row.bestParams).toEqual({ n_components: 8 });
  });
});

describe("aggregated crossval drill-down", () => {
  it("uses only aggregated averages and aggregated folds for aggregated refit twins", () => {
    const aggregatedCvRow = datasetChainsToRows([
      makeChain({
        chain_id: "refit-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        final_test_score: 0.19,
        final_scores: { test: { rmse: 0.19 } },
        final_agg_test_score: 0.17,
        final_agg_train_score: 0.11,
        final_agg_scores: { test: { rmse: 0.17 }, train: { rmse: 0.11 } },
      }),
      makeChain({
        chain_id: "cv-snv",
        model_name: "PLSRegression",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        avg_val_score: 0.22,
        avg_test_score: 0.23,
        fold_count: 2,
        scores: { val: { rmse: 0.22 }, test: { rmse: 0.23 } },
      }),
    ], "rmse", "regression")[1]?.children?.[0];

    expect(aggregatedCvRow?.foldId).toBe("avg_agg");

    const predictions = [
      makePartitionPrediction({ prediction_id: "avg-raw-val", chain_id: "cv-snv", fold_id: "avg", partition: "val", val_score: 0.22, scores: { val: { rmse: 0.22 } } }),
      makePartitionPrediction({ prediction_id: "avg-agg-val", chain_id: "cv-snv", fold_id: "avg_agg", partition: "val", val_score: 0.18, scores: { val: { rmse: 0.18 } } }),
      makePartitionPrediction({ prediction_id: "avg-raw-test", chain_id: "cv-snv", fold_id: "avg", partition: "test", test_score: 0.23, scores: { test: { rmse: 0.23 } } }),
      makePartitionPrediction({ prediction_id: "avg-agg-test", chain_id: "cv-snv", fold_id: "avg_agg", partition: "test", test_score: 0.19, scores: { test: { rmse: 0.19 } } }),
      makePartitionPrediction({ prediction_id: "fold-0-agg", chain_id: "cv-snv", fold_id: "0_agg", partition: "test", test_score: 0.2, scores: { test: { rmse: 0.2 } } }),
      makePartitionPrediction({ prediction_id: "fold-1-agg", chain_id: "cv-snv", fold_id: "1_agg", partition: "test", test_score: 0.18, scores: { test: { rmse: 0.18 } } }),
      makePartitionPrediction({ prediction_id: "fold-0-raw", chain_id: "cv-snv", fold_id: "0", partition: "test", test_score: 0.28, scores: { test: { rmse: 0.28 } } }),
    ];

    const enriched = enrichCrossvalRow(aggregatedCvRow!, predictions);
    expect(enriched.primaryValScore).toBe(0.18);
    expect(enriched.primaryTestScore).toBe(0.19);
    expect(enriched.foldCount).toBe(2);

    const aggregatedFolds = buildFoldTrainCards(predictions, undefined, "aggregated");
    expect(aggregatedFolds).toHaveLength(2);
    expect(aggregatedFolds.map(row => row.foldId)).toEqual(["0_agg", "1_agg"]);
  });
});
