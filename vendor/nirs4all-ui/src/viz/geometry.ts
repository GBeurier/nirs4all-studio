/**
 * Pure geometry + descriptive-statistics helpers for the `viz` domain.
 *
 * Framework-free: these turn numeric data into SVG-ready coordinates, paths,
 * axis ticks, histograms, and summary statistics. Every presentational chart in
 * this package is built on top of these so the scale math stays in one tested
 * place and the components stay declarative.
 */

export interface Extent {
  min: number;
  max: number;
}

/** Inner drawing box after padding is applied. */
export interface PlotFrame {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  innerWidth: number;
  innerHeight: number;
}

export interface PlotPadding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function buildFrame(width: number, height: number, padding: PlotPadding = {}): PlotFrame {
  const resolved = {
    top: padding.top ?? 16,
    right: padding.right ?? 16,
    bottom: padding.bottom ?? 28,
    left: padding.left ?? 40,
  };
  return {
    width,
    height,
    padding: resolved,
    innerWidth: Math.max(0, width - resolved.left - resolved.right),
    innerHeight: Math.max(0, height - resolved.top - resolved.bottom),
  };
}

/** Min/max of a numeric list; falls back to [0, 1] when empty. */
export function extentOf(values: readonly number[]): Extent {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) return { min: min - 0.5, max: max + 0.5 };
  return { min, max };
}

/** Extent padded by a fraction of its span on both ends. */
export function niceExtent(values: readonly number[], padFraction = 0.05): Extent {
  const { min, max } = extentOf(values);
  const pad = (max - min) * padFraction;
  return { min: min - pad, max: max + pad };
}

/** Symmetric extent covering several lists (useful for parity plots). */
export function sharedExtent(...lists: ReadonlyArray<readonly number[]>): Extent {
  return extentOf(lists.flat());
}

/**
 * Map a value from a data domain to a pixel range. Returns a function so a
 * scale can be reused for every point in a series.
 */
export function makeScale(domain: Extent, rangeMin: number, rangeMax: number): (value: number) => number {
  const span = domain.max - domain.min || 1;
  const slope = (rangeMax - rangeMin) / span;
  return (value: number) => rangeMin + (value - domain.min) * slope;
}

/** Evenly spaced, human-friendly tick values across an extent. */
export function ticks(extent: Extent, count = 5): number[] {
  const span = extent.max - extent.min;
  if (span <= 0 || !Number.isFinite(span)) return [extent.min];
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const niceStep = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const start = Math.ceil(extent.min / niceStep) * niceStep;
  const out: number[] = [];
  for (let value = start; value <= extent.max + niceStep * 1e-6; value += niceStep) {
    out.push(Number(value.toFixed(10)));
  }
  return out;
}

/** SVG `M…L…` path from `[x, y]` pixel points. */
export function linePath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return "";
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`)
    .join(" ");
}

/** `points` attribute string for `<polyline>` / `<polygon>`. */
export function polylinePoints(points: ReadonlyArray<readonly [number, number]>): string {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

/**
 * Closed area between an upper and lower pixel boundary (min/max spectra band).
 * `upper` is drawn left→right, `lower` right→left.
 */
export function bandPath(
  upper: ReadonlyArray<readonly [number, number]>,
  lower: ReadonlyArray<readonly [number, number]>,
): string {
  if (upper.length === 0 || lower.length === 0) return "";
  const forward = upper.map(([x, y], i) => `${i === 0 ? "M" : "L"}${round(x)} ${round(y)}`).join(" ");
  const backward = [...lower].reverse().map(([x, y]) => `L${round(x)} ${round(y)}`).join(" ");
  return `${forward} ${backward} Z`;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  mid: number;
  count: number;
}

/** Equal-width histogram bins over `values`. */
export function histogram(values: readonly number[], binCount = 12): HistogramBin[] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [];
  const { min, max } = extentOf(finite);
  const bins = Math.max(1, Math.trunc(binCount));
  const width = (max - min) / bins || 1;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({
    x0: min + i * width,
    x1: min + (i + 1) * width,
    mid: min + (i + 0.5) * width,
    count: 0,
  }));
  for (const value of finite) {
    const raw = Math.floor((value - min) / width);
    const index = clamp(raw, 0, bins - 1);
    const bin = out[index];
    if (bin) bin.count += 1;
  }
  return out;
}

/** Quantile of an already-sorted ascending list (linear interpolation). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  if (sorted.length === 1) return sorted[0] as number;
  const pos = clamp(q, 0, 1) * (sorted.length - 1);
  const base = Math.floor(pos);
  const rest = pos - base;
  const lower = sorted[base] as number;
  const upper = sorted[Math.min(sorted.length - 1, base + 1)] as number;
  return lower + (upper - lower) * rest;
}

export interface FiveNumberSummary {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
}

export function fiveNumberSummary(values: readonly number[]): FiveNumberSummary {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((s, v) => s + v, 0) / sorted.length : Number.NaN;
  return {
    min: sorted[0] ?? Number.NaN,
    q1: quantileSorted(sorted, 0.25),
    median: quantileSorted(sorted, 0.5),
    q3: quantileSorted(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? Number.NaN,
    mean,
  };
}

export function mean(values: readonly number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : Number.NaN;
}

export function stdDev(values: readonly number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return 0;
  const m = mean(finite);
  const variance = finite.reduce((s, v) => s + (v - m) ** 2, 0) / (finite.length - 1);
  return Math.sqrt(variance);
}

export interface LinearFit {
  slope: number;
  intercept: number;
}

/** Ordinary-least-squares fit of `ys` on `xs`. */
export function linearFit(xs: readonly number[], ys: readonly number[]): LinearFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx || 1;
  const slope = (n * sxy - sx * sy) / denom;
  return { slope, intercept: (sy - slope * sx) / n };
}

/** Pearson correlation coefficient. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (xs[i] as number) - mx;
    const b = (ys[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const denom = Math.sqrt(dx * dy) || 1;
  return num / denom;
}

/** Round to 2 decimals for compact SVG coordinate strings. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
