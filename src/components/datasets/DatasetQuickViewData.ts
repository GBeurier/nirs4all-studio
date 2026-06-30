/**
 * Pure read-model helpers for {@link DatasetQuickView}.
 *
 * Everything here is side-effect free: loading/error derivation, count
 * resolution, partition selection, spectra/target preview fallbacks, and the
 * label/style decisions the panel renders. React state, hooks, callbacks, and
 * JSX stay in the component; this module is unit-testable in isolation.
 */
import type {
  Dataset,
  PartitionKey,
  PreviewDataResponse,
  SpectraPreview,
  TargetDistribution,
} from "@/types/datasets";
import {
  getEffectivePreviewPartition,
  getPreviewSampleMetadata,
  hasDatasetPreviewTestPartition,
  selectDatasetSpectraPreview,
  selectDatasetTargetDistribution,
} from "./DatasetPreviewData";

export function formatNumber(num: number | undefined | null): string {
  if (num == null) return "--";
  return num.toLocaleString();
}

export interface QuickViewLoadState {
  /** Workspace not yet restored for an existing dataset; show "Loading workspace…". */
  waitingForWorkspace: boolean;
  /** Whether the overview/spectra/targets panes should show the spinner. */
  loading: boolean;
  /** Resolved error message, or null when there is none. */
  error: string | null;
}

/**
 * Derive the spinner/error read-model from the React Query + workspace state.
 *
 * The spinner shows only on the very first load for a dataset id; a background
 * refetch keeps previous content visible (stale-while-revalidate).
 */
export function deriveQuickViewLoadState({
  datasetId,
  workspaceReady,
  preview,
  queryLoading,
  isFetching,
  queryError,
}: {
  datasetId: string | undefined;
  workspaceReady: boolean;
  preview: PreviewDataResponse | null | undefined;
  queryLoading: boolean;
  isFetching: boolean;
  queryError: unknown;
}): QuickViewLoadState {
  const waitingForWorkspace = !!datasetId && !workspaceReady && !preview;
  const loading = waitingForWorkspace || queryLoading || (isFetching && !preview);
  const error =
    queryError instanceof Error ? queryError.message : preview?.error ?? null;
  return { waitingForWorkspace, loading, error };
}

export interface QuickViewCounts {
  numSamples: number | undefined;
  numFeatures: number | undefined;
  nSources: number;
  trainCount: number | undefined;
  testCount: number | undefined;
}

/** Resolve the header stat counts, preferring dataset metadata over preview summary. */
export function getQuickViewCounts(
  dataset: Pick<
    Dataset,
    "num_samples" | "num_features" | "n_sources" | "train_samples" | "test_samples"
  >,
  preview: Pick<PreviewDataResponse, "summary"> | null | undefined,
): QuickViewCounts {
  const metadata = getPreviewSampleMetadata({ dataset, preview });

  return {
    numSamples: metadata.totalCount,
    numFeatures: dataset.num_features ?? preview?.summary?.num_features,
    nSources: metadata.sourceCount,
    trainCount: metadata.trainCount,
    testCount: metadata.testCount,
  };
}

/** Whether the dataset has a usable test partition (spectra, distribution, or count). */
export function getQuickViewHasTest(
  preview:
    | Pick<
        PreviewDataResponse,
        "spectra_preview_by_partition" | "target_distribution_by_partition"
      >
    | null
    | undefined,
  testCount: number | null | undefined,
): boolean {
  return hasDatasetPreviewTestPartition(preview, testCount);
}

/** Collapse the selected partition to "train" when no test partition is available. */
export function getEffectivePartition(partition: PartitionKey, hasTest: boolean): PartitionKey {
  return getEffectivePreviewPartition(partition, hasTest);
}

/**
 * Pick the spectra preview for the selected source/partition, falling back to
 * the train partition and then the un-partitioned preview.
 */
export function selectSpectraPreview(
  preview: PreviewDataResponse | null | undefined,
  selectedSource: number,
  effectivePartition: PartitionKey,
): SpectraPreview | undefined {
  return selectDatasetSpectraPreview(preview, selectedSource, effectivePartition);
}

/** Pick the target distribution for the partition, with train/global fallbacks. */
export function selectTargetDistribution(
  preview:
    | Pick<PreviewDataResponse, "target_distribution_by_partition" | "target_distribution">
    | null
    | undefined,
  effectivePartition: PartitionKey,
): TargetDistribution | undefined {
  return selectDatasetTargetDistribution(preview, effectivePartition);
}

/**
 * Tailwind class sets for the metadata cloud. Visual weight is rotated through
 * three styles to give the wrapping field list an organic feel.
 */
const METADATA_CLOUD_STYLES = [
  "text-[11px] px-2 py-0.5 bg-background/70 border-border text-foreground",
  "text-[10px] px-1.5 py-0.5 bg-primary/10 border-primary/20 text-primary",
  "text-[10px] px-2 py-[1px] bg-background border-border/60 text-muted-foreground",
] as const;

/** Deterministic style class for a metadata field, keyed by index + name length. */
export function getMetadataCloudItemStyle(columnName: string, index: number): string {
  const variant = (index + columnName.length) % METADATA_CLOUD_STYLES.length;
  return METADATA_CLOUD_STYLES[variant];
}

/** Suffix appended to wavelength/resolution figures (a leading space + symbol). */
export function getWavelengthUnitSuffix(unitSymbol: string): string {
  return unitSymbol ? ` ${unitSymbol}` : "";
}

/** Label for the spectral-range card, switching to wavenumber for cm⁻¹ units. */
export function getWavelengthRangeTitle(unitSymbol: string): string {
  return unitSymbol === "cm⁻¹" ? "Wavenumber Range" : "Wavelength Range";
}

/** "min - max[ unit]" range label, or "--" when no spectra are available. */
export function getWavelengthRangeLabel(
  spectra: SpectraPreview | undefined,
  unitSuffix: string,
): string {
  if (!spectra || spectra.wavelengths.length === 0) return "--";
  return `${Math.min(...spectra.wavelengths).toFixed(0)} - ${Math.max(
    ...spectra.wavelengths,
  ).toFixed(0)}${unitSuffix}`;
}

/** Average inter-wavelength resolution label, or "--" when undeterminable. */
export function getWavelengthResolutionLabel(
  spectra: SpectraPreview | undefined,
  unitSuffix: string,
): string {
  if (!spectra || spectra.wavelengths.length <= 1) return "--";
  const range = Math.max(...spectra.wavelengths) - Math.min(...spectra.wavelengths);
  return `${(range / (spectra.wavelengths.length - 1)).toFixed(2)}${unitSuffix}`;
}
