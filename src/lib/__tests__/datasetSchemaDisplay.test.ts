import { describe, expect, it } from "vitest";

import {
  formatDatasetPreviewAvailabilityLabel,
  formatDatasetPreviewSchemaAvailabilitySummary,
  formatDatasetSchemaTaskTypeLabel,
  formatDatasetSourceCountLabel,
  formatDatasetSourceModeLabel,
  formatDatasetTargetCountLabel,
} from "../datasetSchemaDisplay";

describe("datasetSchemaDisplay", () => {
  it("formats schema task, source mode, and target count labels", () => {
    expect(formatDatasetSchemaTaskTypeLabel("regression")).toBe("regression");
    expect(formatDatasetSchemaTaskTypeLabel("binary_classification")).toBe("binary classification");
    expect(formatDatasetSchemaTaskTypeLabel(undefined)).toBe("unknown task");
    expect(formatDatasetSourceModeLabel(true)).toBe("multi-source");
    expect(formatDatasetSourceModeLabel(false)).toBe("single-source");
    expect(formatDatasetSourceModeLabel(undefined)).toBe("Unknown source mode");
    expect(formatDatasetPreviewAvailabilityLabel(true)).toBe("Preview available");
    expect(formatDatasetPreviewAvailabilityLabel(false)).toBe("Preview unavailable");
    expect(formatDatasetPreviewAvailabilityLabel(undefined)).toBe("Unknown preview availability");
    expect(formatDatasetSourceCountLabel(1)).toBe("1 source");
    expect(formatDatasetSourceCountLabel(4)).toBe("4 sources");
    expect(formatDatasetSourceCountLabel(undefined)).toBe("Unknown sources");
    expect(formatDatasetTargetCountLabel(1)).toBe("1 target");
    expect(formatDatasetTargetCountLabel(3)).toBe("3 targets");
    expect(formatDatasetTargetCountLabel(undefined)).toBe("Unknown targets");
  });

  it("formats a compact preview schema and source availability summary", () => {
    expect(formatDatasetPreviewSchemaAvailabilitySummary({
      previewAvailable: true,
      isMultiSource: true,
      sourceCount: 2,
      targetCount: 1,
    })).toBe("Preview available / multi-source / 2 sources / 1 target");
  });

  it("keeps unknown preview schema and source availability explicit", () => {
    expect(formatDatasetPreviewSchemaAvailabilitySummary({})).toBe(
      "Unknown preview availability / Unknown source mode / Unknown sources / Unknown targets",
    );
  });
});
