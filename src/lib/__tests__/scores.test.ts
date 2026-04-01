import { describe, expect, it } from "vitest";

import { getBestCvEntry, getBestFinalEntry } from "../scores";

describe("score selection helpers", () => {
  it("picks the lowest final score for lower-is-better metrics", () => {
    const chains = [
      { chain_id: "a", final_test_score: 0.42, avg_val_score: 0.11 },
      { chain_id: "b", final_test_score: 0.18, avg_val_score: 0.27 },
      { chain_id: "c", final_test_score: null, avg_val_score: 0.09 },
    ];

    expect(getBestFinalEntry(chains, "rmse")?.chain_id).toBe("b");
  });

  it("picks the highest CV score for higher-is-better metrics", () => {
    const chains = [
      { chain_id: "a", final_test_score: 0.88, avg_val_score: 0.81 },
      { chain_id: "b", final_test_score: 0.91, avg_val_score: 0.79 },
      { chain_id: "c", final_test_score: null, avg_val_score: 0.93 },
    ];

    expect(getBestCvEntry(chains, "accuracy")?.chain_id).toBe("c");
  });
});
