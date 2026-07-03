/**
 * Metric-key normalization and aliasing.
 *
 * The foundational, dependency-free layer of the score utilities: it maps the
 * many spellings a metric key can arrive in (backend JSON, NIRS naming, sklearn
 * names) onto a single canonical key. Everything else in `scores.ts` builds on
 * top of these helpers, so they live here as a self-contained, pure slice.
 */
/** Lower-case, trim, and collapse spaces/hyphens to underscores. */
export declare function normalizeMetricLookupKey(key: string | null | undefined): string;
/** Resolve any metric spelling to its canonical key (empty string if blank). */
export declare function canonicalMetricKey(key: string | null | undefined): string;
/**
 * All keys a metric value might be stored under: the canonical key, the
 * normalized input, and every known alias of the canonical key.
 */
export declare function metricKeyCandidates(key: string | null | undefined): string[];
//# sourceMappingURL=metricKeys.d.ts.map