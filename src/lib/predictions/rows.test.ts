import { describe, expect, it } from "vitest";

import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";
import {
  buildPredictionModelRows,
  createRowComparator,
  foldSortValue,
  predictionGroupKey,
  rowDataVisibility,
  rowFoldVisibility,
} from "./rows";

function makePred(overrides: Partial<PredictionRecord>): PredictionRecord {
  return {
    id: overrides.id ?? "pred",
    source_dataset: overrides.source_dataset ?? "dataset_a",
    source_file: overrides.source_file ?? "pred.meta.parquet",
    dataset_name: overrides.dataset_name ?? "dataset_a",
    model_name: overrides.model_name ?? "PLSRegression",
    partition: overrides.partition ?? "test",
    ...overrides,
  };
}

function makeRow(overrides: Partial<ScoreCardRow>): ScoreCardRow {
  return {
    id: overrides.id ?? "row",
    chainId: overrides.chainId ?? "chain",
    modelName: overrides.modelName ?? "PLSRegression",
    modelClass: overrides.modelClass ?? "PLSRegression",
    preprocessings: overrides.preprocessings ?? null,
    bestParams: overrides.bestParams ?? null,
    cardType: overrides.cardType ?? "refit",
    metric: overrides.metric ?? "rmse",
    testScores: overrides.testScores ?? {},
    valScores: overrides.valScores ?? {},
    trainScores: overrides.trainScores ?? {},
    primaryTestScore: overrides.primaryTestScore ?? null,
    primaryValScore: overrides.primaryValScore ?? null,
    primaryTrainScore: overrides.primaryTrainScore ?? null,
    hasRefitArtifact: overrides.hasRefitArtifact ?? false,
    ...overrides,
  };
}

describe("predictionGroupKey", () => {
  it("groups records that share dataset, trace, and fold", () => {
    const a = makePred({ trace_id: "t1", fold_id: "final", partition: "test" });
    const b = makePred({ trace_id: "t1", fold_id: "final", partition: "val" });
    expect(predictionGroupKey(a)).toBe(predictionGroupKey(b));
  });

  it("separates records that differ by fold", () => {
    const a = makePred({ trace_id: "t1", fold_id: "0" });
    const b = makePred({ trace_id: "t1", fold_id: "1" });
    expect(predictionGroupKey(a)).not.toBe(predictionGroupKey(b));
  });
});

describe("buildPredictionModelRows", () => {
  it("merges test/val/train partitions of a group into one row, preferring test as primary", () => {
    const preds: PredictionRecord[] = [
      makePred({
        id: "p-test",
        trace_id: "trace-1",
        fold_id: "final",
        partition: "test",
        test_score: 0.21,
        n_samples: 40,
        scores: { test: { rmse: 0.21, r2: 0.9 } },
        model_classname: "sklearn.PLS",
        preprocessings: "SNV",
        model_artifact_id: "artifact-1",
      }),
      makePred({
        id: "p-val",
        trace_id: "trace-1",
        fold_id: "final",
        partition: "val",
        val_score: 0.3,
        n_samples: 20,
        scores: { val: { rmse: 0.3 } },
      }),
      makePred({
        id: "p-train",
        trace_id: "trace-1",
        fold_id: "final",
        partition: "train",
        train_score: 0.1,
        n_samples: 80,
        scores: { train: { rmse: 0.1 } },
      }),
    ];

    const rows = buildPredictionModelRows(preds);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Primary is the test record
    expect(row.id).toBe("p-test");
    expect(row.primaryTestScore).toBe(0.21);
    // Merged-in partitions
    expect(row.primaryValScore).toBe(0.3);
    expect(row.primaryTrainScore).toBe(0.1);
    expect(row.testScores.rmse).toBe(0.21);
    expect(row.valScores.rmse).toBe(0.3);
    expect(row.trainScores.rmse).toBe(0.1);
    // Sample counts: eval prefers test, train uses train record
    expect(row.nSamplesEval).toBe(40);
    expect(row.nSamplesTrain).toBe(80);
    // partition collapsed
    expect(row.partition).toBeUndefined();
    // refit artifact derived from predict chain mapping
    expect(row.hasRefitArtifact).toBe(true);
    expect(row.predictChainId).toBe("trace-1");
  });

  it("produces one row per distinct group (dataset/trace/fold)", () => {
    const preds: PredictionRecord[] = [
      makePred({ id: "a", trace_id: "trace-1", fold_id: "0", partition: "test" }),
      makePred({ id: "b", trace_id: "trace-1", fold_id: "1", partition: "test" }),
      makePred({ id: "c", trace_id: "trace-2", fold_id: "0", partition: "test" }),
    ];
    const rows = buildPredictionModelRows(preds);
    expect(rows).toHaveLength(3);
  });

  it("falls back to val then train as primary when test is absent", () => {
    const valOnly = buildPredictionModelRows([
      makePred({ id: "v", trace_id: "t", fold_id: "final", partition: "val", val_score: 0.5, scores: { val: { rmse: 0.5 } } }),
    ]);
    expect(valOnly[0].id).toBe("v");

    const trainOnly = buildPredictionModelRows([
      makePred({ id: "tr", trace_id: "t2", fold_id: "final", partition: "train", train_score: 0.2, scores: { train: { rmse: 0.2 } } }),
    ]);
    expect(trainOnly[0].id).toBe("tr");
  });
});

describe("foldSortValue ordering", () => {
  it("ranks named folds (final < avg < w_avg) ahead of numeric folds", () => {
    expect(foldSortValue("final")).toBeLessThan(foldSortValue("avg"));
    expect(foldSortValue("avg")).toBeLessThan(foldSortValue("w_avg"));
    expect(foldSortValue("w_avg")).toBeLessThan(foldSortValue("0"));
    expect(foldSortValue("0")).toBeLessThan(foldSortValue("1"));
  });

  it("places undefined folds last", () => {
    expect(foldSortValue(undefined)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("rowFoldVisibility / rowDataVisibility", () => {
  it("maps card type to fold visibility bucket", () => {
    expect(rowFoldVisibility(makeRow({ cardType: "refit" }))).toBe("refits");
    expect(rowFoldVisibility(makeRow({ cardType: "crossval" }))).toBe("averages");
    expect(rowFoldVisibility(makeRow({ cardType: "train" }))).toBe("folds");
  });

  it("classifies raw vs aggregated by fold-id base equality", () => {
    expect(rowDataVisibility(makeRow({ foldId: "0" }))).toBe("raw");
    expect(rowDataVisibility(makeRow({ foldId: undefined }))).toBe("raw");
  });
});

describe("createRowComparator", () => {
  it("sorts ascending by primary test score, undefined-as-infinity last", () => {
    const rows = [
      makeRow({ id: "hi", primaryTestScore: 0.9 }),
      makeRow({ id: "lo", primaryTestScore: 0.1 }),
      makeRow({ id: "none", primaryTestScore: null }),
    ];
    const sorted = [...rows].sort(createRowComparator("test_score", "asc"));
    expect(sorted.map(r => r.id)).toEqual(["lo", "hi", "none"]);
  });

  it("reverses for descending order", () => {
    const rows = [
      makeRow({ id: "hi", primaryTestScore: 0.9 }),
      makeRow({ id: "lo", primaryTestScore: 0.1 }),
    ];
    const sorted = [...rows].sort(createRowComparator("test_score", "desc"));
    expect(sorted.map(r => r.id)).toEqual(["hi", "lo"]);
  });

  it("sorts by a metric: key resolving across test score maps", () => {
    const rows = [
      makeRow({ id: "b", testScores: { r2: 0.5 } }),
      makeRow({ id: "a", testScores: { r2: 0.99 } }),
    ];
    const sorted = [...rows].sort(createRowComparator("metric:r2", "desc"));
    expect(sorted.map(r => r.id)).toEqual(["a", "b"]);
  });

  it("falls back to aggregated/avg test maps when raw test map lacks the key", () => {
    const rows = [
      makeRow({ id: "via-agg", testScores: {}, aggregatedTestScores: { rmse: 0.2 } }),
      makeRow({ id: "via-raw", testScores: { rmse: 0.8 } }),
    ];
    const sorted = [...rows].sort(createRowComparator("metric:rmse", "asc"));
    expect(sorted.map(r => r.id)).toEqual(["via-agg", "via-raw"]);
  });

  it("orders fold sort by fold rank", () => {
    const rows = [
      makeRow({ id: "f1", foldId: "1" }),
      makeRow({ id: "final", foldId: "final" }),
      makeRow({ id: "f0", foldId: "0" }),
    ];
    const sorted = [...rows].sort(createRowComparator("fold", "asc"));
    expect(sorted.map(r => r.id)).toEqual(["final", "f0", "f1"]);
  });

  it("orders card_type refit < crossval < train", () => {
    const rows = [
      makeRow({ id: "train", cardType: "train" }),
      makeRow({ id: "refit", cardType: "refit" }),
      makeRow({ id: "crossval", cardType: "crossval" }),
    ];
    const sorted = [...rows].sort(createRowComparator("card_type", "asc"));
    expect(sorted.map(r => r.id)).toEqual(["refit", "crossval", "train"]);
  });
});
