/**
 * Pure score-value helpers: parsing, direction-aware comparison, and display
 * formatting. These depend only on metric-key normalization (no metric
 * catalog), so they form a small, self-contained, easily testable slice.
 */
/** Coerce a value to a finite number, or null. Accepts numbers and numeric strings. */
export declare function parseScoreNumber(value: unknown): number | null;
export declare function parseJsonRecord(value: unknown): Record<string, unknown> | null;
export declare function isLowerBetter(metric: string | null | undefined): boolean;
/**
 * Compare two scores, respecting the metric direction.
 * Returns true if `a` is better than `b`.
 */
export declare function isBetterScore(a: number, b: number, metric: string | null | undefined): boolean;
/**
 * Format a score value to 4 decimal places (or 3 for error metrics).
 */
export declare function formatScore(value: number | string | undefined | null): string;
/**
 * Format a metric-specific value (3 decimals for error metrics, 4 for others).
 */
export declare function formatMetricValue(value: number | string | undefined | null, metric?: string): string;
/**
 * Format a metric name for display (uppercase).
 */
export declare function formatMetricName(metric: string | null | undefined): string;
export declare function formatMetricDisplayName(metric: string | null | undefined): string;
//# sourceMappingURL=scoreValues.d.ts.map