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
 * Mirrors the loader's `_na_policy`: a present `na_policy` key wins (even when
 * null), then a nested `na.policy`, else the fallback; `drop`/`keep` are aliases.
 */
function naPolicyOf(params: unknown, fallback: string | null): string | null {
  if (!params || typeof params !== "object") return fallback;
  const record = params as Record<string, unknown>;
  const nested = record.na && typeof record.na === "object" ? record.na as Record<string, unknown> : null;
  const raw = "na_policy" in record ? record.na_policy : nested && "policy" in nested ? nested.policy : fallback;
  if (typeof raw !== "string") return null;
  const policy = raw.trim().toLowerCase();
  return policy === "drop" ? "remove_sample" : policy === "keep" ? "ignore" : policy;
}

/** The loader keeps target rows (`ignore`) when the effective policy is unset or `auto`. */
const effectiveTargetPolicy = (policy: string | null) => (policy === null || policy === "auto" ? "ignore" : policy);

/**
 * The answer preselected for the selected datasets: "remove" only when every
 * target file of every dataset is already saved with `remove_sample`, so a run
 * never brings back samples the user chose to remove when importing. Policies
 * resolve like `build_nirs4all_config_from_stored`: a present top-level
 * `na_policy` overrides `global_params`, per-file settings override both.
 */
export function savedMissingTargetPolicy(datasets: Array<Pick<Dataset, "config">>): MissingTargetPolicy {
  const policies = datasets.flatMap((dataset) => {
    const config = dataset.config as (Dataset["config"] & Record<string, unknown>) | undefined;
    if (!config || config.dataset_document !== undefined) return [null];
    const parsing: Record<string, unknown> = { ...(config.global_params ?? {}) };
    if ("na_policy" in config) parsing.na_policy = config.na_policy;
    const globalPolicy = naPolicyOf(parsing, "auto");
    const targetFiles = (config.files ?? []).filter((file) => String(file.type).toLowerCase() === "y");
    if ((config.files ?? []).length > 0) {
      return targetFiles.map((file) => effectiveTargetPolicy(naPolicyOf(file.overrides ?? {}, globalPolicy)));
    }
    const flatPolicy = (split: "train" | "test") => effectiveTargetPolicy(
      [config.y_params, config[`${split}_params`], config[`${split}_y_params`]]
        .reduce<string | null>((policy, params) => naPolicyOf(params, null) ?? policy, globalPolicy),
    );
    return (["train", "test"] as const).filter((split) => config[`${split}_y`]).map(flatPolicy);
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
