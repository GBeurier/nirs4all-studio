import { describe, expect, it } from "vitest";

import type { UnifiedOperator } from "@/types/playground";

import { createPlaygroundQueryKey } from "../playground/hashing";

describe("playground hashing", () => {
  it("includes repetition-sensitive data signature in the query key", () => {
    const spectra = [[1, 2], [3, 4]];
    const targets = [10, 20];
    const operators: UnifiedOperator[] = [];
    const sampling = { method: "all" as const, n_samples: 2, seed: 42 };
    const executeOptions = { compute_repetitions: true };

    const keyA = createPlaygroundQueryKey(spectra, targets, operators, sampling, executeOptions, "rep:bio_sample");
    const keyB = createPlaygroundQueryKey(spectra, targets, operators, sampling, executeOptions, "rep:sample_group");

    expect(keyA).not.toEqual(keyB);
  });
});
