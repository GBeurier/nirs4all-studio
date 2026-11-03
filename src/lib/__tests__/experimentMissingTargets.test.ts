import { describe, expect, it } from "vitest";

import {
  canRemoveMissingTargetSamples,
  DEFAULT_MISSING_TARGET_POLICY,
  resolveMissingTargetPolicy,
  savedMissingTargetPolicy,
} from "@/lib/experimentMissingTargets";
import type { DatasetConfig, NaPolicy } from "@/types/datasets";

const fileConfig = { delimiter: ";", decimal_separator: ".", has_header: true } as DatasetConfig;
const multimodalConfig = { ...fileConfig, dataset_document: { schema: "nirs4all.studio-multimodal-dataset.v1" } };
const withTargetPolicy = (yPolicy?: NaPolicy, globalPolicy?: NaPolicy): DatasetConfig => ({
  ...fileConfig,
  global_params: globalPolicy ? { na_policy: globalPolicy } : undefined,
  files: [
    { path: "X.csv", type: "X", split: "train", source: null, overrides: { na_policy: "abort" } },
    { path: "Y.csv", type: "Y", split: "train", source: null, overrides: yPolicy ? { na_policy: yPolicy } : undefined },
  ],
});

describe("experimentMissingTargets", () => {
  it("defaults to excluding missing targets from training and predicting them", () => {
    expect(DEFAULT_MISSING_TARGET_POLICY).toBe("predict");
    expect(savedMissingTargetPolicy([{ config: withTargetPolicy("ignore") }])).toBe("predict");
    expect(savedMissingTargetPolicy([{ config: withTargetPolicy(undefined, "auto") }])).toBe("predict");
    expect(savedMissingTargetPolicy([{ config: fileConfig }])).toBe("predict");
    expect(savedMissingTargetPolicy([])).toBe("predict");
  });

  it("preselects removal only when every saved target policy already removes those samples", () => {
    expect(savedMissingTargetPolicy([{ config: withTargetPolicy("remove_sample") }])).toBe("remove");
    expect(savedMissingTargetPolicy([{ config: withTargetPolicy(undefined, "remove_sample") }])).toBe("remove");
    expect(savedMissingTargetPolicy([
      { config: withTargetPolicy("remove_sample") },
      { config: withTargetPolicy("ignore") },
    ])).toBe("predict");
    expect(savedMissingTargetPolicy([{ config: { ...fileConfig, train_y: "Y.csv", train_y_params: { na_policy: "remove_sample" } } }])).toBe("remove");
  });

  it("resolves saved policies with the loader's precedence and aliases", () => {
    // Top-level settings override global_params, as in the dataset loader.
    expect(savedMissingTargetPolicy([{ config: { ...withTargetPolicy(undefined, "remove_sample"), na_policy: "ignore" } }])).toBe("predict");
    expect(savedMissingTargetPolicy([{ config: { ...withTargetPolicy(undefined, "ignore"), na_policy: "remove_sample" } }])).toBe("remove");
    const nested = (policy: string) => ({
      ...fileConfig,
      files: [{ path: "Y.csv", type: "Y" as const, split: "train" as const, source: null, overrides: { na: { policy } } as unknown as DatasetConfig["global_params"] }],
    });
    expect(savedMissingTargetPolicy([{ config: nested("remove_sample") }])).toBe("remove");
    expect(savedMissingTargetPolicy([{ config: nested("drop") }])).toBe("remove");
    expect(savedMissingTargetPolicy([{ config: nested("keep") }])).toBe("predict");
    // A present but null top-level policy resets the global one (the loader then keeps the rows).
    expect(savedMissingTargetPolicy([{ config: { ...withTargetPolicy(undefined, "remove_sample"), na_policy: null } as unknown as DatasetConfig }])).toBe("predict");
    // The stored-config translator ignores a root-level nested `na`.
    expect(savedMissingTargetPolicy([{ config: { ...withTargetPolicy(undefined, "remove_sample"), na: { policy: "keep" } } as unknown as DatasetConfig }])).toBe("remove");
    // Target file types are matched case-insensitively, like normalize_file_type.
    const lower = withTargetPolicy("remove_sample");
    expect(savedMissingTargetPolicy([{ config: { ...lower, files: lower.files!.map((file) => ({ ...file, type: file.type.toLowerCase() as "Y" })) } }])).toBe("remove");
  });

  it("allows removal only when no selected dataset is a multimodal cohort document", () => {
    expect(canRemoveMissingTargetSamples([])).toBe(true);
    expect(canRemoveMissingTargetSamples([{ config: fileConfig }, {}])).toBe(true);
    expect(canRemoveMissingTargetSamples([{ config: fileConfig }, { config: multimodalConfig }])).toBe(false);
  });

  it("keeps the user's explicit choice unless removal is unavailable", () => {
    const removing = [{ config: withTargetPolicy("remove_sample") }];
    expect(resolveMissingTargetPolicy(null, removing)).toBe("remove");
    expect(resolveMissingTargetPolicy("predict", removing)).toBe("predict");
    expect(resolveMissingTargetPolicy("remove", [{ config: fileConfig }])).toBe("remove");
    expect(resolveMissingTargetPolicy(null, [{ config: fileConfig }])).toBe("predict");
    expect(resolveMissingTargetPolicy("remove", [{ config: multimodalConfig }])).toBe("predict");
  });
});
