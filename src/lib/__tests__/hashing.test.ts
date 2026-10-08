import { describe, expect, it } from "vitest";

import type { UnifiedOperator } from "@/types/playground";

import { createPlaygroundQueryKey, getSpectralDataIdentity, hashData, hashPipeline, isPlaygroundPipelineCacheable } from "../playground/hashing";

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

  it("distinguishes values outside the old sampled rows/columns and small changes", () => {
    const spectra = Array.from({ length: 60 }, () => Array.from({ length: 700 }, () => 1));
    const changed = spectra.map(row => [...row]);
    changed[12][123] += 0.000001;
    expect(hashData(spectra)).not.toEqual(hashData(changed));
  });

  it("assigns independent identities to complete immutable snapshots", () => {
    const data = { spectra: [[1, 2]], wavelengths: [100, 200], y: [1] };
    expect(getSpectralDataIdentity(data)).toBe(getSpectralDataIdentity(data));
    expect(getSpectralDataIdentity({ ...data, wavelengths: [300, 400] })).not.toBe(getSpectralDataIdentity(data));
    expect(getSpectralDataIdentity({ ...data, metadata: [{ group: 'other' }] })).not.toBe(getSpectralDataIdentity(data));
  });

  it("includes class paths and canonically ordered nested parameters", () => {
    const op: UnifiedOperator = { id: 'a', type: 'preprocessing', name: 'Filter', classPath: 'a.Filter', enabled: true, params: { nested: { a: 1, b: 2 } } };
    expect(hashPipeline([op])).toBe(hashPipeline([{ ...op, params: { nested: { b: 2, a: 1 } } }]));
    expect(hashPipeline([op])).not.toBe(hashPipeline([{ ...op, classPath: 'b.Filter' }]));
  });

  it("ignores disabled parameters and forbids unseeded stochastic reuse", () => {
    const op: UnifiedOperator = { id: 'a', type: 'augmentation', name: 'GaussianNoise', enabled: false, params: { sigma: 1 } };
    expect(createPlaygroundQueryKey([[1]], [], [op])).toEqual(createPlaygroundQueryKey([[1]], [], [{ ...op, params: { sigma: 2 } }]));
    expect(isPlaygroundPipelineCacheable([{ ...op, enabled: true }])).toBe(false);
    expect(isPlaygroundPipelineCacheable([{ ...op, enabled: true, params: { random_state: 42 } }])).toBe(false);
    expect(isPlaygroundPipelineCacheable([{ ...op, enabled: true, type: 'preprocessing', name: 'MysteryTransform', classPath: 'custom.MysteryTransform' }])).toBe(false);
    expect(isPlaygroundPipelineCacheable([{ ...op, enabled: true, type: 'preprocessing', classPath: 'sklearn.preprocessing.StandardScaler' }])).toBe(true);
  });
});
