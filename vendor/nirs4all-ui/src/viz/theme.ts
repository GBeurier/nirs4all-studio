/**
 * Shared visualization palette for the nirs4all `viz` domain.
 *
 * Pure data + pure color math: no DOM, no React. These are the canonical
 * "teal system" chart colors used across nirs4all Studio and the Web/WASM
 * client, exposed so every presentational chart in this package (and its
 * hosts) draws from one source of truth. Components read these as defaults but
 * always accept explicit color overrides so hosts can retheme.
 */

/** Named brand-ramp colors (verbatim from the nirs4all-org teal system). */
export const N4_VIZ_COLORS = {
  teal: "#0d9488",
  tealDark: "#0f766e",
  tealLight: "#2dd4bf",
  cyan: "#06b6d4",
  indigo: "#4f46e5",
  green: "#10b981",
  amber: "#d97706",
  rose: "#e11d48",
  violet: "#7c3aed",
  slate: "#64748b",
} as const;

/** Ordered categorical series (mirrors `--chart-1..5` in the shared theme). */
export const N4_CHART_SERIES = [
  N4_VIZ_COLORS.teal,
  N4_VIZ_COLORS.cyan,
  N4_VIZ_COLORS.indigo,
  N4_VIZ_COLORS.green,
  N4_VIZ_COLORS.amber,
] as const;

/**
 * Wide categorical palette for group-colored scatter/topology views (mirrors
 * Studio's `INSPECTOR_GROUP_COLORS`).
 */
export const N4_CATEGORICAL = [
  "#0d9488",
  "#2563eb",
  "#d97706",
  "#e11d48",
  "#7c3aed",
  "#059669",
  "#ea580c",
  "#0284c7",
  "#db2777",
  "#65a30d",
] as const;

/** Canonical train / validation / test partition colors. */
export const N4_PARTITION_COLORS = {
  train: N4_VIZ_COLORS.teal,
  validation: N4_VIZ_COLORS.indigo,
  test: N4_VIZ_COLORS.amber,
} as const;

export type PartitionKey = keyof typeof N4_PARTITION_COLORS;

/** Resolve a categorical color by index, wrapping around the palette. */
export function categoricalColor(index: number, palette: readonly string[] = N4_CATEGORICAL): string {
  if (palette.length === 0) return N4_VIZ_COLORS.teal;
  const wrapped = ((Math.trunc(index) % palette.length) + palette.length) % palette.length;
  return palette[wrapped] as string;
}

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.replace(/(.)/g, "$1$1") : clean;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToCss([r, g, b]: Rgb): string {
  const round = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${round(r)}, ${round(g)}, ${round(b)})`;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Interpolate a stop-based color ramp; `t` is clamped to [0, 1]. */
export function rampAt(stops: readonly string[], t: number): string {
  if (stops.length === 0) return N4_VIZ_COLORS.teal;
  if (stops.length === 1) return stops[0] as string;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (stops.length - 1);
  const lower = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - lower;
  return rgbToCss(mixRgb(hexToRgb(stops[lower] as string), hexToRgb(stops[lower + 1] as string), frac));
}

/** Sequential teal→amber ramp (used for continuous coloring by value). */
export const N4_SEQUENTIAL_STOPS = ["#0f766e", "#0d9488", "#06b6d4", "#84cc16", "#d97706"] as const;

/** Perceptual viridis approximation for heatmap intensity. */
export const N4_VIRIDIS_STOPS = ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"] as const;

/** Diverging blue→neutral→red ramp for signed SHAP values. */
export const N4_DIVERGING_STOPS = ["#2563eb", "#e2e8f0", "#e11d48"] as const;

export function sequentialColor(t: number): string {
  return rampAt(N4_SEQUENTIAL_STOPS, t);
}

export function viridisColor(t: number): string {
  return rampAt(N4_VIRIDIS_STOPS, t);
}

export function divergingColor(t: number): string {
  return rampAt(N4_DIVERGING_STOPS, t);
}
