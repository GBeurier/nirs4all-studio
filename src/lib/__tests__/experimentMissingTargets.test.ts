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
