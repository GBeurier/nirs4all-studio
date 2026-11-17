import type { Dataset } from "@/types/datasets";
import type { MissingSpectraFillMethod, MissingSpectraPolicy } from "@/types/runs";

/** A selected dataset whose spectra keep missing values, as counted when it was last inspected. */
export interface MissingSpectraCount {
  datasetId: string;
  datasetName: string;
  samples: number;
  values: number;
  totalSamples: number | null;
}

/** What the review step needs to ask about missing spectral values. */
export interface MissingSpectraReview {
  counts: MissingSpectraCount[];
  /** The run's answer; `null` until the user picks one. */
  choice: MissingSpectraPolicy | null;
  onChange: (choice: MissingSpectraPolicy) => void;
}

/** The replacement methods of the library that need no statistic across samples. */
export const MISSING_SPECTRA_FILL_METHODS: MissingSpectraFillMethod[] = ["value", "forward_fill", "backward_fill"];

type SpectraDataset = Pick<Dataset, "id" | "name" | "missing_spectra" | "num_samples"> & {
  config?: { na_policy?: unknown; global_params?: { na_policy?: unknown } | null } | null;
};

/** The selected datasets that keep missing spectral values. One without any asks nothing. */
export function missingSpectraCounts(datasets: SpectraDataset[]): MissingSpectraCount[] {
  return datasets.flatMap((dataset) => {
    const missing = dataset.missing_spectra;
    if (!missing || !(missing.samples > 0)) return [];
    return [{
      datasetId: dataset.id,
      datasetName: dataset.name,
      samples: missing.samples,
      values: missing.values,
      totalSamples: typeof dataset.num_samples === "number" ? dataset.num_samples : null,
    }];
  });
}

/**
 * The answer saved with the datasets, if they have one: a dataset whose NA
 * handling says "ignore" explicitly keeps its missing values for the pipeline.
 * "Auto" is no answer; removal and replacement saved with a dataset are applied
 * at load, so such a dataset has no missing value left to ask about.
 */
export function savedMissingSpectraChoice(datasets: SpectraDataset[]): MissingSpectraPolicy | null {
  const affected = datasets.filter((dataset) => (dataset.missing_spectra?.samples ?? 0) > 0);
  const keeps = (dataset: SpectraDataset) => (dataset.config?.global_params?.na_policy ?? dataset.config?.na_policy) === "ignore";
  return affected.length > 0 && affected.every(keeps) ? { policy: "keep" } : null;
}

/** The run's answer: the user's, else the datasets' saved one; `null` when nothing is asked or answered. */
export function resolveMissingSpectraChoice(
  choice: MissingSpectraPolicy | null,
  datasets: SpectraDataset[],
): MissingSpectraPolicy | null {
  if (missingSpectraCounts(datasets).length === 0) return null;
  return choice ?? savedMissingSpectraChoice(datasets);
}
