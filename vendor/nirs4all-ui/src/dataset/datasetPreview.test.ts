import { describe, expect, it } from "vitest";

import {
  buildDatasetPreview,
  formatDatasetCount,
  formatDatasetSpectralRange,
  formatDatasetTaskLabel,
  normalizeDatasetSplitCounts,
  parseDatasetCount,
  resolveDatasetTaskKind,
} from "./datasetPreview.js";

describe("dataset preview foundation", () => {
  it("parses counts and task labels without app-specific dataset objects", () => {
    expect(parseDatasetCount("128.9")).toBe(128);
    expect(parseDatasetCount(-1)).toBeNull();
    expect(formatDatasetCount(1, "sample")).toBe("1 sample");
    expect(formatDatasetCount(1200, "spectrum", "spectra")).toBe("1,200 spectra");
    expect(resolveDatasetTaskKind("binary_classification")).toBe("classification");
    expect(resolveDatasetTaskKind("regression")).toBe("regression");
    expect(formatDatasetTaskLabel("multi_task")).toBe("Mixed tasks");
  });

  it("normalizes split counts with percentages", () => {
    expect(normalizeDatasetSplitCounts({
      calibration: 80,
      validation: "20",
      ignored: null,
    }, 100)).toEqual([
      {
        id: "calibration",
        label: "Calibration",
        count: 80,
        countLabel: "80 samples",
        percentage: 80,
        percentageLabel: "80%",
      },
      {
        id: "validation",
        label: "Validation",
        count: 20,
        countLabel: "20 samples",
        percentage: 20,
        percentageLabel: "20%",
      },
    ]);
  });

  it("formats spectral ranges from tuples and objects", () => {
    expect(formatDatasetSpectralRange([1700, 900])).toBe("900-1,700 nm");
    expect(formatDatasetSpectralRange({ min: 1100.25, max: 2200.5, unit: "cm-1" }))
      .toBe("1,100.25-2,200.5 cm-1");
    expect(formatDatasetSpectralRange({ start: 900 })).toBe("from 900 nm");
  });

  it("builds a reusable dataset preview view", () => {
    expect(buildDatasetPreview({
      id: "corn-v1",
      title: "Corn NIR calibration",
      description: "Moisture and protein reference set.",
      taskType: "regression",
      sampleCount: 120,
      wavelengthCount: 256,
      targetCount: 2,
      splitCounts: [
        { id: "calibration", label: "Calibration", count: 90 },
        { id: "validation", label: "Validation", count: 30 },
      ],
      spectralRange: { start: 900, end: 1700 },
      tags: ["NIR", "bench-top", "NIR"],
    })).toMatchObject({
      id: "corn-v1",
      title: "Corn NIR calibration",
      taskKind: "regression",
      taskLabel: "Regression",
      sampleCountLabel: "120 samples",
      featureCountLabel: "256 features",
      targetCountLabel: "2 targets",
      spectralRangeLabel: "900-1,700 nm",
      splitSummaryLabel: "Calibration 75%, Validation 25%",
      tags: ["NIR", "bench-top"],
      badges: [
        { id: "task", label: "Regression", tone: "default" },
        { id: "range", label: "900-1,700 nm", tone: "muted" },
        { id: "splits", label: "Calibration 75%, Validation 25%", tone: "muted" },
        { id: "tag-nir", label: "NIR", tone: "default" },
        { id: "tag-bench-top", label: "bench-top", tone: "default" },
      ],
    });
  });
});
