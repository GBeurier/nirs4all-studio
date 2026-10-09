import { describe, expect, it } from "vitest";

import { getDatasetTaskLabel as label } from "../datasetTask";
import { tEn } from "./support/enTranslator";

const getDatasetTaskLabel = (taskType: string | null | undefined, options?: Parameters<typeof label>[2]) => label(taskType, tEn, options);

describe("getDatasetTaskLabel", () => {
  it("renders compact labels for explicit classification task types", () => {
    expect(getDatasetTaskLabel("binary_classification", { short: true })).toBe("Classif");
    expect(getDatasetTaskLabel("multiclass_classification", { short: true })).toBe("Multi");
  });

  it("handles legacy generic classification values using numClasses", () => {
    expect(getDatasetTaskLabel("classification", { numClasses: 2 })).toBe("Classification");
    expect(getDatasetTaskLabel("classification", { short: true, numClasses: 4 })).toBe("Multi");
  });

  it("renders auto and unknown values safely", () => {
    expect(getDatasetTaskLabel("auto")).toBe("Auto");
    expect(getDatasetTaskLabel(undefined)).toBe("--");
    expect(getDatasetTaskLabel("custom_task")).toBe("Custom Task");
  });
});
