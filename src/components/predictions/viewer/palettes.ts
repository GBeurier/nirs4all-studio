/**
 * Palette definitions and lookup helpers for the prediction chart viewer.
 *
 * Partition palettes mirror Playground categorical palettes, while confusion
 * colors are driven by editable two-stop gradients.
 */

import {
  CATEGORICAL_PALETTES,
  getCategoricalPaletteLabel,
  type CategoricalPalette,
} from "@/lib/playground/colorConfig";
import type {
  ConfusionGradientPreset,
  PaletteId,
  ViewerGradientColors,
  ViewerPartitionColors,
} from "./types";

interface PartitionPaletteDefinition {
  id: Exclude<PaletteId, "custom">;
  label: string;
  colors: [string, string, string];
}

interface ConfusionGradientDefinition {
  id: Exclude<ConfusionGradientPreset, "custom">;
  label: string;
  colors: ViewerGradientColors;
}

const PARTITION_FALLBACK_COLOR = "#64748b";
const PARTITION_PALETTE_IDS = ["default", "tableau10", "set1", "set2", "paired"] as const satisfies readonly CategoricalPalette[];

const CONFUSION_GRADIENTS = {
  ocean: {
    label: "Ocean",
    colors: { low: "#eef6ff", high: "#1d4ed8" },
  },
  lagoon: {
    label: "Lagoon",
    colors: { low: "#ecfeff", high: "#0f766e" },
  },
  ember: {
    label: "Ember",
    colors: { low: "#fff4ec", high: "#c2410c" },
  },
  orchid: {
    label: "Orchid",
    colors: { low: "#f7f1ff", high: "#7c3aed" },
  },
  moss: {
    label: "Moss",
    colors: { low: "#f3fbf4", high: "#2f855a" },
  },
} as const satisfies Record<Exclude<ConfusionGradientPreset, "custom">, { label: string; colors: ViewerGradientColors }>;

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function expandHex(hex: string): string {
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return hex.toLowerCase();
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma = (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const sector = hue / 60;
  const secondary = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = normalizedLightness - chroma / 2;

  let red = 0;
  let green = 0;
  let blue = 0;

  if (sector >= 0 && sector < 1) {
    red = chroma;
    green = secondary;
  } else if (sector < 2) {
    red = secondary;
    green = chroma;
  } else if (sector < 3) {
    green = chroma;
    blue = secondary;
  } else if (sector < 4) {
    green = secondary;
    blue = chroma;
  } else if (sector < 5) {
    red = secondary;
    blue = chroma;
  } else {
    red = chroma;
    blue = secondary;
  }

  const toHex = (value: number) => clampChannel((value + match) * 255).toString(16).padStart(2, "0");
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = expandHex(hex);
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

export function normalizeColorToHex(color: string, fallback: string = PARTITION_FALLBACK_COLOR): string {
  const trimmed = color.trim();
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed)) {
    return expandHex(trimmed);
  }

  const hslMatch = /^hsl\(\s*([\d.]+)(?:deg)?\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/i.exec(trimmed);
  if (hslMatch) {
    return hslToHex(
      Number.parseFloat(hslMatch[1]),
      Number.parseFloat(hslMatch[2]),
      Number.parseFloat(hslMatch[3]),
    );
  }

  return fallback;
}

function resolvePartitionRole(partition: string): keyof ViewerPartitionColors | null {
  const key = (partition || "").trim().toLowerCase();
  if (key === "validation") return "val";
  if (key === "train" || key === "val" || key === "test") return key;
  return null;
}

export function isPaletteId(value: string): value is PaletteId {
  return value === "custom" || PARTITION_PALETTE_IDS.includes(value as CategoricalPalette);
}

export function isPartitionPalettePreset(value: string): value is Exclude<PaletteId, "custom"> {
  return PARTITION_PALETTE_IDS.includes(value as CategoricalPalette);
}

export function getPartitionPaletteColors(palette: Exclude<PaletteId, "custom">): ViewerPartitionColors {
  const colors = CATEGORICAL_PALETTES[palette].slice(0, 3).map((color) => normalizeColorToHex(color));
  return {
    train: colors[0] ?? "#17cfb9",
    val: colors[1] ?? "#266bd9",
    test: colors[2] ?? "#1cca5b",
  };
}

export function listPalettes(): PartitionPaletteDefinition[] {
  return PARTITION_PALETTE_IDS.map((id) => {
    const colors = getPartitionPaletteColors(id);
    return {
      id,
      label: getCategoricalPaletteLabel(id),
      colors: [colors.train, colors.val, colors.test],
    };
  });
}

export function getPaletteLabel(palette: PaletteId): string {
  return palette === "custom" ? "Custom" : getCategoricalPaletteLabel(palette);
}

/**
 * Map any partition string (case-insensitive) to a configured color.
 * Unknown partitions resolve to a neutral fallback.
 */
export function getPartitionColor(
  partition: string,
  palette: PaletteId,
  partitionColors?: ViewerPartitionColors,
): string {
  const role = resolvePartitionRole(partition);
  const activeColors = partitionColors ?? getPartitionPaletteColors(palette === "custom" ? "default" : palette);
  return role ? activeColors[role] : PARTITION_FALLBACK_COLOR;
}

export function isConfusionGradientPreset(value: string): value is ConfusionGradientPreset {
  return value === "custom" || value in CONFUSION_GRADIENTS;
}

export function isConfusionGradientPresetId(value: string): value is Exclude<ConfusionGradientPreset, "custom"> {
  return value in CONFUSION_GRADIENTS;
}

export function getConfusionGradientColors(preset: Exclude<ConfusionGradientPreset, "custom">): ViewerGradientColors {
  return CONFUSION_GRADIENTS[preset].colors;
}

export function listConfusionGradients(): ConfusionGradientDefinition[] {
  return (Object.keys(CONFUSION_GRADIENTS) as Array<Exclude<ConfusionGradientPreset, "custom">>).map((id) => ({
    id,
    label: CONFUSION_GRADIENTS[id].label,
    colors: CONFUSION_GRADIENTS[id].colors,
  }));
}

export function getConfusionGradientLabel(preset: ConfusionGradientPreset): string {
  return preset === "custom" ? "Custom" : CONFUSION_GRADIENTS[preset].label;
}

export function getConfusionGradientCss(gradient: ViewerGradientColors): string {
  return `linear-gradient(90deg, ${gradient.low} 0%, ${gradient.high} 100%)`;
}

export function mixColors(start: string, end: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const startRgb = hexToRgb(normalizeColorToHex(start));
  const endRgb = hexToRgb(normalizeColorToHex(end));
  const r = startRgb.r + (endRgb.r - startRgb.r) * clamped;
  const g = startRgb.g + (endRgb.g - startRgb.g) * clamped;
  const b = startRgb.b + (endRgb.b - startRgb.b) * clamped;
  return `#${clampChannel(r).toString(16).padStart(2, "0")}${clampChannel(g).toString(16).padStart(2, "0")}${clampChannel(b).toString(16).padStart(2, "0")}`;
}

export function getConfusionFillColor(t: number, gradient: ViewerGradientColors): string {
  return mixColors(gradient.low, gradient.high, t);
}

export function getContrastTextColor(color: string): string {
  const { r, g, b } = hexToRgb(normalizeColorToHex(color));
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
  return luminance > 0.42 ? "#0f172a" : "#ffffff";
}
