import { describe, expect, it } from "vitest";

import { createPlaygroundQueryKey } from "../playground/hashing";

describe("playground hashing", () => {
  it("includes repetition-sensitive data signature in the query key", () => {
    const baseArgs = [
      [[1, 2], [3, 4]],
      [10, 20],
      [],
      { method: "all", n_samples: 2, seed: 42 },
      { compute_repetitions: true },
    ] as const;

    const keyA = createPlaygroundQueryKey(...baseArgs, "rep:bio_sample");
    const keyB = createPlaygroundQueryKey(...baseArgs, "rep:sample_group");

    expect(keyA).not.toEqual(keyB);
  });
});
