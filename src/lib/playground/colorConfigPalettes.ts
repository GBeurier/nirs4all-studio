/**
 * Playground palette primitives.
 *
 * Pure, context-free color helpers extracted from colorConfig.ts:
 * - continuous / categorical palette definitions,
 * - numeric-domain + normalization helpers used for continuous coloring,
 * - palette display helpers (labels + CSS gradient preview).
 *
 * colorConfig.ts re-exports everything here, so existing public import paths
 * (`from '.../colorConfig'`) keep working unchanged.
 */

// ============= Type Definitions =============

/**
 * Palette types for continuous coloring
 */
export type ContinuousPalette =
  | 'blue_red'    // Current default (blue->cyan->green->yellow->red)
  | 'viridis'     // Purple->blue->green->yellow
  | 'plasma'      // Purple->pink->orange->yellow
  | 'inferno'     // Black->purple->red->yellow
  | 'coolwarm'    // Blue->white->red (diverging)
  | 'spectral'    // Red->orange->yellow->green->blue (rainbow)
  | 'cividis'     // Blue->green->yellow (colorblind-friendly)
  | 'winter'      // Blue->cyan (cool colors only)
  | 'blues'       // Light blue->dark blue (single hue)
  | 'greens'      // Light green->dark green (single hue)
  | 'turbo';      // Blue->cyan->green->yellow->red (improved rainbow)

/**
 * Palette types for categorical coloring
 */
export type CategoricalPalette =
  | 'default'     // Current FOLD_COLORS (teal, blue, green, orange, purple...)
  | 'tableau10'   // Tableau's colorblind-safe palette
  | 'set1'        // ColorBrewer Set1
  | 'set2'        // ColorBrewer Set2
  | 'paired';     // ColorBrewer Paired

// ============= Palette Definitions =============

/**
 * Continuous palette color functions
 * Each returns an HSL/RGB color string for a normalized value t (0-1)
 */
export const CONTINUOUS_PALETTES: Record<ContinuousPalette, (t: number) => string> = {
  blue_red: (t) => {
    // Blue (240) -> Cyan (180) -> Green (120) -> Yellow (60) -> Red (0)
    const hue = 240 - t * 240;
    return `hsl(${hue}, 70%, 50%)`;
  },

  viridis: (t) => {
    // Approximation of viridis colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${270 - s * 30}, ${70 + s * 10}%, ${25 + s * 10}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${240 - s * 60}, ${80 - s * 10}%, ${35 + s * 10}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${180 - s * 80}, ${70 - s * 5}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${100 - s * 40}, ${65 - s * 15}%, ${55 + s * 15}%)`;
    }
  },

  plasma: (t) => {
    // Approximation of plasma colormap
    if (t < 0.33) {
      const s = t / 0.33;
      return `hsl(${280 - s * 20}, ${80 + s * 10}%, ${25 + s * 20}%)`;
    } else if (t < 0.66) {
      const s = (t - 0.33) / 0.33;
      return `hsl(${260 - s * 210}, ${90 - s * 10}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.66) / 0.34;
      return `hsl(${50 - s * 10}, ${80 + s * 10}%, ${55 + s * 20}%)`;
    }
  },

  inferno: (t) => {
    // Approximation of inferno colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${280 + s * 10}, ${60 + s * 20}%, ${10 + s * 15}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${290 - s * 270}, ${80 + s * 10}%, ${25 + s * 15}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${20 + s * 20}, ${90}%, ${40 + s * 15}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${40 + s * 20}, ${90 - s * 20}%, ${55 + s * 30}%)`;
    }
  },

  coolwarm: (t) => {
    // Diverging blue-white-red
    if (t < 0.5) {
      const intensity = (0.5 - t) * 2;
      const lightness = 95 - intensity * 45;
      return `hsl(220, ${Math.round(70 * intensity)}%, ${Math.round(lightness)}%)`;
    } else {
      const intensity = (t - 0.5) * 2;
      const lightness = 95 - intensity * 45;
      return `hsl(10, ${Math.round(70 * intensity)}%, ${Math.round(lightness)}%)`;
    }
  },

  spectral: (t) => {
    // Rainbow: Red -> Orange -> Yellow -> Green -> Blue
    const hue = (1 - t) * 240;
    return `hsl(${hue}, 80%, 50%)`;
  },

  cividis: (t) => {
    // Colorblind-friendly: Navy blue -> teal -> olive -> yellow
    // Based on the matplotlib cividis colormap
    if (t < 0.25) {
      const s = t / 0.25;
      return `hsl(${235 - s * 25}, ${50 + s * 20}%, ${25 + s * 10}%)`;
    } else if (t < 0.5) {
      const s = (t - 0.25) / 0.25;
      return `hsl(${210 - s * 30}, ${70 - s * 10}%, ${35 + s * 10}%)`;
    } else if (t < 0.75) {
      const s = (t - 0.5) / 0.25;
      return `hsl(${180 - s * 100}, ${60 - s * 10}%, ${45 + s * 10}%)`;
    } else {
      const s = (t - 0.75) / 0.25;
      return `hsl(${80 - s * 30}, ${50 + s * 30}%, ${55 + s * 25}%)`;
    }
  },

  winter: (t) => {
    // Cool colors only: Blue -> Cyan -> Light Cyan
    const hue = 240 - t * 60; // 240 (blue) to 180 (cyan)
    const lightness = 40 + t * 25; // Gets lighter
    return `hsl(${hue}, 75%, ${lightness}%)`;
  },

  blues: (t) => {
    // Single hue blue: Light blue -> Dark blue
    const lightness = 90 - t * 55; // 90% (very light) to 35% (dark)
    const saturation = 60 + t * 30; // More saturated as it gets darker
    return `hsl(215, ${saturation}%, ${lightness}%)`;
  },

  greens: (t) => {
    // Single hue green: Light green -> Dark green
    const lightness = 90 - t * 55; // 90% (very light) to 35% (dark)
    const saturation = 50 + t * 40; // More saturated as it gets darker
    return `hsl(140, ${saturation}%, ${lightness}%)`;
  },

  turbo: (t) => {
    // Improved rainbow: Blue -> Cyan -> Green -> Yellow -> Orange -> Red
    // Better perceptual uniformity than jet/spectral
    if (t < 0.2) {
      const s = t / 0.2;
      return `hsl(${260 - s * 40}, ${70 + s * 20}%, ${35 + s * 15}%)`;
    } else if (t < 0.4) {
      const s = (t - 0.2) / 0.2;
      return `hsl(${220 - s * 40}, ${90}%, ${50 + s * 5}%)`;
    } else if (t < 0.6) {
      const s = (t - 0.4) / 0.2;
      return `hsl(${180 - s * 60}, ${85}%, ${55 - s * 5}%)`;
    } else if (t < 0.8) {
      const s = (t - 0.6) / 0.2;
      return `hsl(${120 - s * 70}, ${80 + s * 10}%, ${50}%)`;
    } else {
      const s = (t - 0.8) / 0.2;
      return `hsl(${50 - s * 45}, ${90}%, ${50 - s * 5}%)`;
    }
  },
};

/**
 * Categorical palette color arrays
 * Colorblind-safe palettes from ColorBrewer and Tableau
 */
export const CATEGORICAL_PALETTES: Record<CategoricalPalette, readonly string[]> = {
  default: [
    'hsl(173, 80%, 45%)', // Teal
    'hsl(217, 70%, 50%)', // Blue
    'hsl(142, 76%, 45%)', // Green
    'hsl(38, 92%, 50%)',  // Orange
    'hsl(280, 65%, 55%)', // Purple
    'hsl(350, 70%, 55%)', // Red
    'hsl(200, 70%, 45%)', // Cyan
    'hsl(95, 60%, 45%)',  // Lime
    'hsl(320, 60%, 55%)', // Magenta
    'hsl(55, 80%, 45%)',  // Yellow
  ],

  tableau10: [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  ],

  set1: [
    '#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00',
    '#ffff33', '#a65628', '#f781bf', '#999999',
  ],

  set2: [
    '#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854',
    '#ffd92f', '#e5c494', '#b3b3b3',
  ],

  paired: [
    '#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99',
    '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a',
  ],
};

// ============= Color Utility Functions =============

/**
 * Get categorical color by index (wraps around)
 */
export function getCategoricalColor(
  index: number,
  palette: CategoricalPalette = 'default'
): string {
  const colors = CATEGORICAL_PALETTES[palette];
  return colors[index % colors.length];
}

/**
 * Get continuous color by normalized value
 */
export function getContinuousColor(
  t: number, // 0-1 normalized value
  palette: ContinuousPalette = 'blue_red'
): string {
  const clampedT = Math.max(0, Math.min(1, t));
  return CONTINUOUS_PALETTES[palette](clampedT);
}

export interface NumberDomain {
  min: number;
  max: number;
}

export function getFiniteNumberDomain(values: readonly unknown[]): NumberDomain | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let count = 0;

  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    count += 1;
  }

  return count > 0 ? { min, max } : null;
}

/**
 * Normalize a value to 0-1 range
 */
export function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

export function getContinuousColorForValue(
  value: number,
  min: number,
  max: number,
  palette: ContinuousPalette = 'blue_red'
): string | null {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return getContinuousColor(normalizeValue(value, min, max), palette);
}

// ============= Palette Display Helpers =============

/**
 * Get display name for a continuous palette
 */
export function getContinuousPaletteLabel(palette: ContinuousPalette): string {
  const labels: Record<ContinuousPalette, string> = {
    blue_red: 'Blue-Red',
    viridis: 'Viridis',
    plasma: 'Plasma',
    inferno: 'Inferno',
    coolwarm: 'Cool-Warm',
    spectral: 'Spectral',
    cividis: 'Cividis',
    winter: 'Winter',
    blues: 'Blues',
    greens: 'Greens',
    turbo: 'Turbo',
  };
  return labels[palette];
}

/**
 * Get display name for a categorical palette
 */
export function getCategoricalPaletteLabel(palette: CategoricalPalette): string {
  const labels: Record<CategoricalPalette, string> = {
    default: 'Default',
    tableau10: 'Tableau 10',
    set1: 'Set 1',
    set2: 'Set 2',
    paired: 'Paired',
  };
  return labels[palette];
}

/**
 * Generate preview gradient for a continuous palette (CSS gradient)
 */
export function getContinuousPaletteGradient(palette: ContinuousPalette): string {
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    stops.push(`${getContinuousColor(t, palette)} ${t * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
