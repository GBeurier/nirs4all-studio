/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";

import {
  chainHasAnyArtifact,
  chainHasRefitArtifact,
  foldArtifactKey,
  foldIdBase,
  foldLabel,
  hasArtifactForFold,
  scoreCardTypeForFoldId,
} from "../fold-utils";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("fold-utils", () => {
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
