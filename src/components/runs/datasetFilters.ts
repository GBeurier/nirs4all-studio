import type { EnrichedDatasetRun } from "@/types/enriched-runs";

// Matches dataset suffixes like "..._Xcal", "..._X_cal", "..._XVal", "..._X_Val" or exact names
const PARASITIC_DATASET_SUFFIX_RE = /(?:^|_)(?:X_?cal|X_?val)$/i;

export function isParasiticDatasetName(datasetName: string): boolean {
  return PARASITIC_DATASET_SUFFIX_RE.test(datasetName);
}

export function filterParasiticDatasets(datasets: EnrichedDatasetRun[]): EnrichedDatasetRun[] {
  return datasets.filter((dataset) => !isParasiticDatasetName(dataset.dataset_name));
}
