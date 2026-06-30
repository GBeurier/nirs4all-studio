import { describe, expect, it } from "vitest";
import {
  deriveQuickViewLoadState,
  formatNumber,
  getEffectivePartition,
  getMetadataCloudItemStyle,
  getQuickViewCounts,
  getQuickViewHasTest,
  getWavelengthRangeLabel,
  getWavelengthRangeTitle,
  getWavelengthResolutionLabel,
  getWavelengthUnitSuffix,
  selectSpectraPreview,
  selectTargetDistribution,
} from "../DatasetQuickViewData";
import type { Dataset, PreviewDataResponse, SpectraPreview } from "@/types/datasets";

const spectra = (wavelengths: number[]): SpectraPreview => ({
  wavelengths,
  mean_spectrum: [],
  std_spectrum: [],
  min_spectrum: [],
  max_spectrum: [],
});

describe("formatNumber", () => {
  it("renders -- for nullish and a locale string otherwise", () => {
    expect(formatNumber(null)).toBe("--");
    expect(formatNumber(undefined)).toBe("--");
    expect(formatNumber(1234)).toBe((1234).toLocaleString());
    expect(formatNumber(0)).toBe((0).toLocaleString());
  });
});

describe("deriveQuickViewLoadState", () => {
  const base = {
    datasetId: "d1",
    workspaceReady: true,
    preview: undefined as PreviewDataResponse | null | undefined,
    queryLoading: false,
    isFetching: false,
    queryError: undefined as unknown,
  };

  it("waits for the workspace when not ready and no preview yet", () => {
    const s = deriveQuickViewLoadState({ ...base, workspaceReady: false });
    expect(s.waitingForWorkspace).toBe(true);
    expect(s.loading).toBe(true);
    expect(s.error).toBeNull();
  });

  it("does not wait once a preview is cached", () => {
    const s = deriveQuickViewLoadState({
      ...base,
      workspaceReady: false,
      preview: { success: true, summary: {} } as PreviewDataResponse,
    });
    expect(s.waitingForWorkspace).toBe(false);
    expect(s.loading).toBe(false);
  });

  it("shows the spinner during the first load but not a background refetch", () => {
    expect(deriveQuickViewLoadState({ ...base, queryLoading: true }).loading).toBe(true);
    expect(deriveQuickViewLoadState({ ...base, isFetching: true }).loading).toBe(true);
    const withCache = deriveQuickViewLoadState({
      ...base,
      isFetching: true,
      preview: { success: true, summary: {} } as PreviewDataResponse,
    });
    expect(withCache.loading).toBe(false);
  });

  it("prefers a thrown query error, then the preview error", () => {
    expect(
      deriveQuickViewLoadState({ ...base, queryError: new Error("boom") }).error,
    ).toBe("boom");
    expect(
      deriveQuickViewLoadState({
        ...base,
        preview: { success: false, error: "bad", summary: {} } as PreviewDataResponse,
      }).error,
    ).toBe("bad");
  });
});

describe("getQuickViewCounts", () => {
  it("prefers dataset metadata, falling back to the preview summary", () => {
    const dataset = { num_samples: 100, n_sources: 2 } as Dataset;
    const preview = {
      summary: { num_features: 256, train_samples: 80, test_samples: 20 },
    } as PreviewDataResponse;
    expect(getQuickViewCounts(dataset, preview)).toEqual({
      numSamples: 100,
      numFeatures: 256,
      nSources: 2,
      trainCount: 80,
      testCount: 20,
    });
  });

  it("defaults nSources to 1 when unknown", () => {
    expect(getQuickViewCounts({} as Dataset, null).nSources).toBe(1);
  });
});

describe("getQuickViewHasTest / getEffectivePartition", () => {
  it("detects a test partition from spectra, distribution, or a positive count", () => {
    expect(getQuickViewHasTest(null, 5)).toBe(true);
    expect(getQuickViewHasTest(null, 0)).toBe(false);
    expect(
      getQuickViewHasTest(
        { spectra_preview_by_partition: { test: spectra([1]) } } as PreviewDataResponse,
        undefined,
      ),
    ).toBe(true);
    expect(
      getQuickViewHasTest(
        { target_distribution_by_partition: { test: { type: "regression" } } } as PreviewDataResponse,
        undefined,
      ),
    ).toBe(true);
  });

  it("collapses non-train partitions to train when there is no test", () => {
    expect(getEffectivePartition("all", false)).toBe("train");
    expect(getEffectivePartition("test", false)).toBe("train");
    expect(getEffectivePartition("all", true)).toBe("all");
    expect(getEffectivePartition("test", true)).toBe("test");
  });
});

describe("selectSpectraPreview", () => {
  it("returns undefined without a preview", () => {
    expect(selectSpectraPreview(null, 0, "all")).toBeUndefined();
  });

  it("uses per-source partitions for multi-source datasets with train fallback", () => {
    const preview = {
      summary: { n_sources: 2 },
      spectra_per_source_by_partition: {
        0: { train: spectra([10]) },
      },
      spectra_per_source: { 0: spectra([99]) },
    } as unknown as PreviewDataResponse;
    expect(selectSpectraPreview(preview, 0, "all")?.wavelengths).toEqual([10]);
  });

  it("falls back to the global preview for single-source datasets", () => {
    const preview = {
      summary: { n_sources: 1 },
      spectra_preview: spectra([1, 2, 3]),
    } as PreviewDataResponse;
    expect(selectSpectraPreview(preview, 0, "test")?.wavelengths).toEqual([1, 2, 3]);
  });
});

describe("selectTargetDistribution", () => {
  it("prefers the partition, then train, then the global distribution", () => {
    const preview = {
      target_distribution_by_partition: {
        train: { type: "regression", min: 1 },
      },
      target_distribution: { type: "classification" },
    } as PreviewDataResponse;
    expect(selectTargetDistribution(preview, "test")?.type).toBe("regression");
    expect(selectTargetDistribution({} as PreviewDataResponse, "test")).toBeUndefined();
  });
});

describe("metadata cloud styling", () => {
  it("is deterministic and rotates through three styles", () => {
    expect(getMetadataCloudItemStyle("ab", 0)).toBe(getMetadataCloudItemStyle("ab", 0));
    const variants = new Set([
      getMetadataCloudItemStyle("", 0),
      getMetadataCloudItemStyle("", 1),
      getMetadataCloudItemStyle("", 2),
    ]);
    expect(variants.size).toBe(3);
  });
});

describe("wavelength labels", () => {
  it("builds the unit suffix", () => {
    expect(getWavelengthUnitSuffix("nm")).toBe(" nm");
    expect(getWavelengthUnitSuffix("")).toBe("");
  });

  it("switches the range title to wavenumber for cm⁻¹", () => {
    expect(getWavelengthRangeTitle("cm⁻¹")).toBe("Wavenumber Range");
    expect(getWavelengthRangeTitle("nm")).toBe("Wavelength Range");
  });

  it("renders range and resolution labels with a fallback", () => {
    expect(getWavelengthRangeLabel(undefined, " nm")).toBe("--");
    expect(getWavelengthRangeLabel(spectra([]), " nm")).toBe("--");
    expect(getWavelengthRangeLabel(spectra([400.4, 2500.9]), " nm")).toBe("400 - 2501 nm");
    expect(getWavelengthResolutionLabel(spectra([10]), " nm")).toBe("--");
    expect(getWavelengthResolutionLabel(spectra([0, 10, 20, 30]), " nm")).toBe("10.00 nm");
  });
});
