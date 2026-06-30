import { describe, expect, it } from "vitest";
import {
  getDatasetSpectraPreviewReadModel,
  getEffectivePreviewPartition,
  getPreviewSampleMetadata,
  hasDatasetPreviewTestPartition,
  selectDatasetSpectraPreview,
  selectDatasetTargetDistribution,
} from "../DatasetPreviewData";
import type { Dataset, PreviewDataResponse, SpectraPreview, TargetDistribution } from "@/types/datasets";

const baseSummary: PreviewDataResponse["summary"] = {
  num_samples: 100,
  num_features: 12,
  n_sources: 1,
  train_samples: 80,
  test_samples: 20,
  has_targets: true,
  has_metadata: false,
};

function preview(
  overrides: Partial<Omit<PreviewDataResponse, "summary">> & {
    summary?: Partial<PreviewDataResponse["summary"]>;
  } = {},
): PreviewDataResponse {
  const { summary, ...rest } = overrides;
  return {
    success: true,
    summary: { ...baseSummary, ...summary },
    ...rest,
  };
}

function spectra(wavelengths: number[], nSamples?: number): SpectraPreview {
  return {
    wavelengths,
    mean_spectrum: wavelengths,
    std_spectrum: [],
    min_spectrum: wavelengths,
    max_spectrum: wavelengths,
    n_samples: nSamples,
  };
}

const trainDistribution: TargetDistribution = {
  type: "regression",
  n_samples: 80,
  min: 1,
  max: 4,
};

const globalDistribution: TargetDistribution = {
  type: "regression",
  n_samples: 100,
  min: 0,
  max: 5,
};

describe("DatasetPreviewData", () => {
  it("collapses all and test to train when no test preview exists", () => {
    const trainSpectra = spectra([10], 80);
    const data = preview({
      summary: { test_samples: 0 },
      spectra_preview_by_partition: { train: trainSpectra },
    });

    expect(hasDatasetPreviewTestPartition(data, 0)).toBe(false);
    expect(getEffectivePreviewPartition("all", false)).toBe("train");
    expect(getEffectivePreviewPartition("test", false)).toBe("train");

    const model = getDatasetSpectraPreviewReadModel(data, "all", 0);
    expect(model.effectivePartition).toBe("train");
    expect(model.spectra).toBe(trainSpectra);
  });

  it("uses per-source spectra partitions with train fallback before global data", () => {
    const globalSpectra = spectra([999], 100);
    const sourceTrainSpectra = spectra([1100], 40);
    const data = preview({
      summary: { n_sources: 2, test_samples: 0 },
      spectra_preview: globalSpectra,
      spectra_per_source_by_partition: {
        1: { train: sourceTrainSpectra },
      },
    });

    expect(selectDatasetSpectraPreview(data, 1, "all")).toBe(sourceTrainSpectra);

    const model = getDatasetSpectraPreviewReadModel(data, "all", 1);
    expect(model.hasPerSource).toBe(true);
    expect(model.sourceCount).toBe(2);
    expect(model.spectra).toBe(sourceTrainSpectra);
  });

  it("falls back through partition maps to train and then the global preview", () => {
    const trainSpectra = spectra([800], 80);
    const globalSpectra = spectra([900], 100);

    expect(
      selectDatasetSpectraPreview(
        preview({
          spectra_preview: globalSpectra,
          spectra_preview_by_partition: { train: trainSpectra },
        }),
        0,
        "test",
      ),
    ).toBe(trainSpectra);

    expect(
      selectDatasetSpectraPreview(
        preview({
          spectra_preview: globalSpectra,
          spectra_preview_by_partition: {},
        }),
        0,
        "test",
      ),
    ).toBe(globalSpectra);
  });

  it("resolves target distributions with partition, train, and global fallbacks", () => {
    expect(
      selectDatasetTargetDistribution(
        preview({
          target_distribution: globalDistribution,
          target_distribution_by_partition: { train: trainDistribution },
        }),
        "all",
      ),
    ).toBe(trainDistribution);

    expect(
      selectDatasetTargetDistribution(
        preview({
          target_distribution: globalDistribution,
          target_distribution_by_partition: {},
        }),
        "test",
      ),
    ).toBe(globalDistribution);
  });

  it("resolves sample count and source metadata consistently", () => {
    const dataset = {
      num_samples: 120,
      train_samples: 70,
      test_samples: 30,
      n_sources: 3,
    } as Dataset;
    const data = preview({
      summary: {
        num_samples: 100,
        train_samples: 80,
        test_samples: 20,
        n_sources: 2,
      },
      spectra_per_source: {
        0: spectra([700], 11),
      },
    });

    expect(getPreviewSampleMetadata({ dataset, preview: data })).toEqual({
      totalCount: 120,
      trainCount: 80,
      testCount: 20,
      sourceCount: 3,
    });

    expect(getDatasetSpectraPreviewReadModel(data, "train", 0)).toMatchObject({
      sourceCount: 2,
      hasPerSource: true,
      spectraSampleCount: 11,
    });
  });
});
