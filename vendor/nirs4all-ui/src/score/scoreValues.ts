/**
 * Pure score-value helpers: parsing, direction-aware comparison, and display
 * formatting. These depend only on metric-key normalization (no metric
 * catalog), so they form a small, self-contained, easily testable slice.
 */

import { canonicalMetricKey, normalizeMetricLookupKey } from "./metricKeys.js";

/** Metrics where lower values are better (error-based). */
const LOWER_IS_BETTER = new Set([
  "rmse", "rmsecv", "rmsep", "mse", "mae", "mape", "bias", "sep", "nrmse",
  "nmse", "nmae", "max_error", "median_ae", "hamming_loss", "log_loss",
]);

/** Coerce a value to a finite number, or null. Accepts numbers and numeric strings. */
export function parseScoreNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isLowerBetter(metric: string | null | undefined): boolean {
  return LOWER_IS_BETTER.has(canonicalMetricKey(metric));
}

/**
 * Compare two scores, respecting the metric direction.
 * Returns true if `a` is better than `b`.
 */
export function isBetterScore(a: number, b: number, metric: string | null | undefined): boolean {
  return isLowerBetter(metric) ? a < b : a > b;
}

/**
 * Format a score value to 4 decimal places (or 3 for error metrics).
 */
export function formatScore(value: number | string | undefined | null): string {
  if (value == null) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(4);
}

/**
 * Format a metric-specific value (3 decimals for error metrics, 4 for others).
 */
export function formatMetricValue(value: number | string | undefined | null, metric?: string): string {
  if (value == null) return "-";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(num)) return "-";
  if (metric && isLowerBetter(metric)) return num.toFixed(3);
  return num.toFixed(4);
}

/**
 * Format a metric name for display (uppercase).
 */
export function formatMetricName(metric: string | null | undefined): string {
  if (!metric) return "";
  return (canonicalMetricKey(metric) || normalizeMetricLookupKey(metric)).toUpperCase();
}

export function formatMetricDisplayName(metric: string | null | undefined): string {
  const normalized = canonicalMetricKey(metric) || normalizeMetricLookupKey(metric);
  if (!normalized) return "";

  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => (part.length <= 4 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}
