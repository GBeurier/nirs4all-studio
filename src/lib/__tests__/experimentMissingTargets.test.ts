import { describe, expect, it } from "vitest";

import {
  canRemoveMissingTargetSamples,
  DEFAULT_MISSING_TARGET_POLICY,
  resolveMissingTargetPolicy,
} from "@/lib/experimentMissingTargets";
import type { DatasetConfig } from "@/types/datasets";

const fileConfig = { delimiter: ";", decimal_separator: ".", has_header: true } as DatasetConfig;
const multimodalConfig = { ...fileConfig, dataset_document: { schema: "nirs4all.studio-multimodal-dataset.v1" } };

describe("experimentMissingTargets", () => {
  it("defaults to excluding missing targets from training and predicting them", () => {
    expect(DEFAULT_MISSING_TARGET_POLICY).toBe("predict");
  });

  it("allows removal only when no selected dataset is a multimodal cohort document", () => {
    expect(canRemoveMissingTargetSamples([])).toBe(true);
    expect(canRemoveMissingTargetSamples([{ config: fileConfig }, {}])).toBe(true);
    expect(canRemoveMissingTargetSamples([{ config: fileConfig }, { config: multimodalConfig }])).toBe(false);
  });

  it("keeps the user's choice unless removal is unavailable", () => {
    expect(resolveMissingTargetPolicy("remove", true)).toBe("remove");
    expect(resolveMissingTargetPolicy("predict", true)).toBe("predict");
    expect(resolveMissingTargetPolicy("remove", false)).toBe("predict");
  });
});
