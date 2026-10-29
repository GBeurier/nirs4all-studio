/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";

import {
  chainHasAnyArtifact,
  chainHasRefitArtifact,
  buildFoldTree,
  foldArtifactKey,
  foldIdBase,
  foldLabel,
  hasArtifactForFold,
  scoreCardTypeForFoldId,
  isNumberedFold,
  predictionScores,
} from "../fold-utils";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("fold-utils", () => {
  it("does not display a classification score under a regression metric label", () => {
    const prediction = { val_score: 0.8, partition: "val" } as Parameters<typeof predictionScores>[0];
    expect(predictionScores(prediction, ["rmse", "balanced_accuracy"], "balanced_accuracy"))
      .toEqual({ rmse: null, balanced_accuracy: 0.8 });
  });

  it("labels native macro scores as CV summaries without a pooled predictor", async () => {
    expect(foldLabel("macro")).toBe("Mean CV score");
    expect(scoreCardTypeForFoldId("macro")).toBe("crossval");
    expect(isNumberedFold("macro")).toBe(false);
    expect(hasArtifactForFold("macro", { fold_0: "a", fold_1: "b", fold_macro: "invalid" })).toBe(false);
    const predictions = ["0", "macro", "1"].map(fold_id => ({ fold_id, partition: "val" } as Parameters<typeof buildFoldTree>[0][number]));
    const tree = buildFoldTree(predictions);
    expect(tree?.prediction.fold_id).toBe("macro");
    expect(tree?.children.map(child => child.prediction.fold_id)).toEqual(["0", "1"]);
    await i18n.changeLanguage("fr");
    expect(foldLabel("macro")).toBe("Moyenne des scores CV");
  });

  it("localises fold labels in French", async () => {
    await i18n.changeLanguage("fr");
    expect(foldLabel("3")).toBe("Pli 3");
    expect(foldLabel("final_agg")).toBe("Final (réajusté) (agr.)");
  });

  it("normalizes fold ids and labels repetition-aggregated twins", () => {
    expect(foldIdBase("final_agg")).toBe("final");
    expect(foldLabel("final")).toBe("Final (refit)");
    expect(foldLabel("final_agg")).toBe("Final (refit) (agg)");
    expect(foldLabel("w_avg_agg")).toBe("Weighted Avg (agg)");
    expect(foldLabel("3")).toBe("Fold 3");
  });

  it("centralizes fold id to score-card type decisions", () => {
    expect(scoreCardTypeForFoldId("final")).toBe("refit");
    expect(scoreCardTypeForFoldId("final_agg")).toBe("refit");
    expect(scoreCardTypeForFoldId("avg")).toBe("crossval");
    expect(scoreCardTypeForFoldId("w_avg_agg")).toBe("crossval");
    expect(scoreCardTypeForFoldId("3")).toBe("train");
    expect(scoreCardTypeForFoldId(null)).toBe("train");
  });

  it("keeps exact refit artifact checks separate from fold card type", () => {
    const artifacts = {
      fold_final: "artifact-final",
      fold_0: "artifact-fold-0",
    };

    expect(foldArtifactKey("final")).toBe("fold_final");
    expect(hasArtifactForFold("final", artifacts)).toBe(true);
    expect(hasArtifactForFold("0", artifacts)).toBe(true);
    expect(hasArtifactForFold("final_agg", artifacts)).toBe(false);
    expect(chainHasAnyArtifact(artifacts)).toBe(true);
    expect(chainHasRefitArtifact(artifacts)).toBe(true);
  });
});
