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

/**
 * The answer preselected for the selected datasets: "remove" only when every
 * target file of every dataset is already saved with `remove_sample`, so a run
 * never brings back samples the user chose to remove when importing.
 */
export function savedMissingTargetPolicy(datasets: Array<Pick<Dataset, "config">>): MissingTargetPolicy {
  const policies = datasets.flatMap((dataset) => {
    const config = dataset.config;
    if (!config || config.dataset_document !== undefined) return [undefined];
    const globalPolicy = config.global_params?.na_policy ?? config.na_policy;
    const targetFiles = (config.files ?? []).filter((file) => file.type === "Y");
    if (targetFiles.length > 0) return targetFiles.map((file) => file.overrides?.na_policy ?? globalPolicy);
    const flatPolicies = [
      config.train_y ? config.train_y_params?.na_policy ?? globalPolicy : null,
      config.test_y ? config.test_y_params?.na_policy ?? globalPolicy : null,
    ].filter((policy) => policy !== null);
    return flatPolicies.length > 0 ? flatPolicies : [globalPolicy];
  });
  return policies.length > 0 && policies.every((policy) => policy === "remove_sample") ? "remove" : DEFAULT_MISSING_TARGET_POLICY;
}

/** The user's explicit answer wins; otherwise the datasets' saved policy decides. */
export function resolveMissingTargetPolicy(
  choice: MissingTargetPolicy | null,
  datasets: Array<Pick<Dataset, "config">>,
): MissingTargetPolicy {
  if (!canRemoveMissingTargetSamples(datasets)) return DEFAULT_MISSING_TARGET_POLICY;
  return choice ?? savedMissingTargetPolicy(datasets);
}
