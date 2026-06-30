import { describe, expect, it } from "vitest";

import {
  chainHasAnyArtifact,
  chainHasRefitArtifact,
  foldArtifactKey,
  foldIdBase,
  foldLabel,
  hasArtifactForFold,
  scoreCardTypeForFoldId,
} from "../fold-utils";

describe("fold-utils", () => {
  it("normalizes fold ids and labels repetition-aggregated twins", () => {
    expect(foldIdBase("final_agg")).toBe("final");
    expect(foldLabel("final")).toBe("Final (refit)");
    expect(foldLabel("final_agg")).toBe("Final (refit) (agg)");
    expect(foldLabel("w_avg_agg")).toBe("Weighted Avg (agg)");
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
