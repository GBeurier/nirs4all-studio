import type { Dataset } from "@/types/datasets";
import type { MissingTargetPolicy } from "@/types/runs";

/** The library excludes samples without a target from fitting and predicts them. */
export const DEFAULT_MISSING_TARGET_POLICY: MissingTargetPolicy = "predict";

/**
 * Removing samples at load rewrites a file dataset's target NA policy for the
 * run. A linked multimodal cohort document is executed as saved, so its
 * samples without a target can only be predicted.
 */
export function canRemoveMissingTargetSamples(datasets: Array<Pick<Dataset, "config">>): boolean {
  return datasets.every((dataset) => dataset.config?.dataset_document === undefined);
}

export function resolveMissingTargetPolicy(
  choice: MissingTargetPolicy,
  removalAvailable: boolean,
): MissingTargetPolicy {
  return removalAvailable ? choice : DEFAULT_MISSING_TARGET_POLICY;
}
