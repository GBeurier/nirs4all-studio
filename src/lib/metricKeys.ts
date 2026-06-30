/**
 * Metric-key normalization and aliasing.
 *
 * The foundational, dependency-free layer of the score utilities: it maps the
 * many spellings a metric key can arrive in (backend JSON, NIRS naming, sklearn
 * names) onto a single canonical key. Everything else in `scores.ts` builds on
 * top of these helpers, so they live here as a self-contained, pure slice.
 */

/**
 * Maps non-canonical metric spellings onto their canonical key.
 * Mirrors the metric names emitted by `nirs4all/core/metrics.py`.
 */
const METRIC_KEY_ALIASES: Record<string, string> = {
  mean_squared_error: "mse",
  root_mean_squared_error: "rmse",
  mean_absolute_error: "mae",
  mean_absolute_percentage_error: "mape",
  r2_score: "r2",
  explained_variance_score: "explained_variance",
  median_absolute_error: "median_ae",
  f1_score: "f1",
  auc: "roc_auc",
  mcc: "matthews_corrcoef",
  kappa: "cohen_kappa",
  jaccard_score: "jaccard",
  rmsep: "rmse",
  rmsecv: "rmse",
};

const METRIC_ALIAS_KEYS_BY_CANONICAL = new Map<string, string[]>();
for (const [aliasKey, canonicalKey] of Object.entries(METRIC_KEY_ALIASES)) {
  const aliases = METRIC_ALIAS_KEYS_BY_CANONICAL.get(canonicalKey) ?? [];
  aliases.push(aliasKey);
  METRIC_ALIAS_KEYS_BY_CANONICAL.set(canonicalKey, aliases);
}

/** Lower-case, trim, and collapse spaces/hyphens to underscores. */
export function normalizeMetricLookupKey(key: string | null | undefined): string {
  return (key ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Resolve any metric spelling to its canonical key (empty string if blank). */
export function canonicalMetricKey(key: string | null | undefined): string {
  const normalized = normalizeMetricLookupKey(key);
  if (!normalized) return "";
  return METRIC_KEY_ALIASES[normalized] ?? normalized;
}

/**
 * All keys a metric value might be stored under: the canonical key, the
 * normalized input, and every known alias of the canonical key.
 */
export function metricKeyCandidates(key: string | null | undefined): string[] {
  const normalized = normalizeMetricLookupKey(key);
  const canonical = canonicalMetricKey(key);
  if (!canonical) return [];

  const candidates = new Set<string>([canonical]);
  if (normalized) candidates.add(normalized);
  for (const aliasKey of METRIC_ALIAS_KEYS_BY_CANONICAL.get(canonical) ?? []) {
    candidates.add(aliasKey);
  }
  return [...candidates];
}
