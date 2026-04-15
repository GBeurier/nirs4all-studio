/**
 * Palette definitions and lookup helpers for the prediction chart viewer.
 *
 * A palette resolves a partition label to a color and provides sequential
 * color ramps for confusion matrix heatmaps.
 */

import type { PaletteDefinition, PaletteId } from "./types";

const DEFAULT_PARTITIONS = {
  train: "#0f766e",      // teal-700 — aligns with datasets/partitionTheme.ts
  val: "#0284c7",        // sky-600
  validation: "#0284c7",
  test: "#b45309",       // amber-700
};

const VIRIDIS_PARTITIONS = {
  train: "#440154",
  val: "#31688e",
  validation: "#31688e",
  test: "#fde725",
};

// Okabe-Ito colorblind-safe subset.
const COLORBLIND_PARTITIONS = {
  train: "#009E73",
  val: "#0072B2",
  validation: "#0072B2",
  test: "#D55E00",
};

const HIGH_CONTRAST_PARTITIONS = {
  train: "#000000",
  val: "#1d4ed8",
  validation: "#1d4ed8",
  test: "#dc2626",
};

const SEQUENTIAL_BLUE = [
  "#eff6ff", "#dbeafe", "#bfdbfe", "#93c5fd", "#60a5fa",
  "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af", "#1e3a8a",
];

const SEQUENTIAL_TEAL = [
  "#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf",
  "#14b8a6", "#0d9488", "#0f766e", "#115e59", "#134e4a",
];

const SEQUENTIAL_DIVERGING = [
  "#2166ac", "#4393c3", "#92c5de", "#d1e5f0", "#f7f7f7",
  "#fddbc7", "#f4a582", "#d6604d", "#b2182b", "#67001f",
];

const PALETTES: Record<PaletteId, PaletteDefinition> = {
  default: {
    id: "default",
    label: "Default",
    partitions: DEFAULT_PARTITIONS,
    fallback: "#64748b", // slate-500
    sequentialBlue: SEQUENTIAL_BLUE,
    sequentialTeal: SEQUENTIAL_TEAL,
    sequentialDiverging: SEQUENTIAL_DIVERGING,
  },
  viridis: {
    id: "viridis",
    label: "Viridis",
    partitions: VIRIDIS_PARTITIONS,
    fallback: "#5c5c5c",
    sequentialBlue: SEQUENTIAL_BLUE,
    sequentialTeal: SEQUENTIAL_TEAL,
    sequentialDiverging: SEQUENTIAL_DIVERGING,
  },
  colorblind: {
    id: "colorblind",
    label: "Colorblind-safe",
    partitions: COLORBLIND_PARTITIONS,
    fallback: "#999999",
    sequentialBlue: SEQUENTIAL_BLUE,
    sequentialTeal: SEQUENTIAL_TEAL,
    sequentialDiverging: SEQUENTIAL_DIVERGING,
  },
  highContrast: {
    id: "highContrast",
    label: "High contrast",
    partitions: HIGH_CONTRAST_PARTITIONS,
    fallback: "#525252",
    sequentialBlue: SEQUENTIAL_BLUE,
    sequentialTeal: SEQUENTIAL_TEAL,
    sequentialDiverging: SEQUENTIAL_DIVERGING,
  },
};

export function getPalette(id: PaletteId): PaletteDefinition {
  return PALETTES[id] ?? PALETTES.default;
}

export function listPalettes(): PaletteDefinition[] {
  return [PALETTES.default, PALETTES.viridis, PALETTES.colorblind, PALETTES.highContrast];
}

/**
 * Map any partition string (case-insensitive) to a color for the given palette.
 * Unknown partitions resolve to the palette's fallback color.
 */
export function getPartitionColor(partition: string, palette: PaletteId): string {
  const def = getPalette(palette);
  const key = (partition || "").trim().toLowerCase();
  return def.partitions[key] ?? def.fallback;
}

/** Return a sequential color-ramp array for the given scale. */
export function getSequentialScale(
  palette: PaletteId,
  scale: "blue" | "teal" | "diverging",
): string[] {
  const def = getPalette(palette);
  if (scale === "teal") return def.sequentialTeal;
  if (scale === "diverging") return def.sequentialDiverging;
  return def.sequentialBlue;
}

/** Map a normalized value (0..1) to a color inside a sequential scale. */
export function sampleSequential(stops: string[], t: number): string {
  if (stops.length === 0) return "#f8fafc";
  const clamped = Math.max(0, Math.min(1, t));
  const idx = Math.round(clamped * (stops.length - 1));
  return stops[idx];
}
