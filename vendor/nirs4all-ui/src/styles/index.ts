/**
 * Shared visual style manifests for NIRS4ALL hosts.
 *
 * Static CSS and motion files are shipped under `assets/`; this module exposes
 * typed paths and token names without importing CSS at runtime.
 */

export type Nirs4allStyleAssetId =
  | "default-theme"
  | "dataset-builder"
  | "viz-charts"
  | "chains-explorer"
  | "conformal-tree"
  | "quality-lab-theme"
  | "spectra-motion";

export type Nirs4allStyleAssetKind = "css" | "svg-motion";

export interface Nirs4allStyleAsset {
  id: Nirs4allStyleAssetId;
  kind: Nirs4allStyleAssetKind;
  path: string;
  packageExport: string;
  description: string;
}

export const NIRS4ALL_STYLE_ASSETS = [
  {
    id: "default-theme",
    kind: "css",
    path: "assets/styles/nirs4all-default.css",
    packageExport: "nirs4all-ui/assets/styles/nirs4all-default.css",
    description: "Default NIRS4ALL design tokens, surface classes, badges, grids, and runtime affordances.",
  },
  {
    id: "dataset-builder",
    kind: "css",
    path: "assets/datasetBuilder.css",
    packageExport: "nirs4all-ui/assets/datasetBuilder.css",
    description: "Default multimodal DatasetBuilder wizard layout and role-mapping utility classes.",
  },
  {
    id: "viz-charts",
    kind: "css",
    path: "assets/viz.css",
    packageExport: "nirs4all-ui/assets/viz.css",
    description: "Default axis, gridline, connector, and text styling for the reusable viz scientific charts.",
  },
  {
    id: "chains-explorer",
    kind: "css",
    path: "assets/chains.css",
    packageExport: "nirs4all-ui/assets/chains.css",
    description: "Default axis/gridline/baseline chart styling plus explorer chrome (toolbar, filter chips, panels) for the chain-effect explorer.",
  },
  {
    id: "conformal-tree",
    kind: "css",
    path: "assets/conformal.css",
    packageExport: "nirs4all-ui/assets/conformal.css",
    description: "Default chrome for the nested conformal prediction tree: tier/sample cards, chevrons, chips, legend, and per-coverage level rows.",
  },
  {
    id: "quality-lab-theme",
    kind: "css",
    path: "assets/theme.css",
    packageExport: "nirs4all-ui/assets/theme.css",
    description: "Shared lab/quality app theme tokens used by quality-oriented custom hosts.",
  },
  {
    id: "spectra-motion",
    kind: "svg-motion",
    path: "assets/motion/nirs-spectra.svg",
    packageExport: "nirs4all-ui/assets/motion/nirs-spectra.svg",
    description: "Reusable animated NIR spectra motif for docs, splash surfaces, and app empty states.",
  },
] as const satisfies readonly Nirs4allStyleAsset[];

export const NIRS4ALL_CSS_TOKENS = [
  "n4-color-primary",
  "n4-color-primary-hover",
  "n4-color-cyan",
  "n4-color-indigo",
  "n4-color-success",
  "n4-color-warning",
  "n4-color-danger",
  "n4-color-bg",
  "n4-color-bg-alt",
  "n4-color-surface",
  "n4-color-border",
  "n4-color-text",
  "n4-color-muted",
  "n4-radius",
  "n4-radius-sm",
  "n4-shadow",
  "n4-font-sans",
  "n4-font-display",
  "n4-font-mono",
] as const;

export type Nirs4allCssToken = (typeof NIRS4ALL_CSS_TOKENS)[number];

export const NIRS4ALL_DEFAULT_THEME = {
  colors: {
    primary: "#0d9488",
    primaryHover: "#0f766e",
    cyan: "#06b6d4",
    indigo: "#4f46e5",
    success: "#10b981",
    warning: "#d97706",
    danger: "#e11d48",
    background: "#faf7f0",
    surface: "#ffffff",
    border: "#e2e8f0",
    text: "#0f172a",
    muted: "#475569",
  },
  radius: {
    default: "8px",
    small: "6px",
  },
  fonts: {
    sans: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif",
    display: "IBM Plex Sans, Inter, -apple-system, system-ui, sans-serif",
    mono: "JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace",
  },
} as const;

export function getNirs4allStyleAsset(id: Nirs4allStyleAssetId): Nirs4allStyleAsset {
  const asset = NIRS4ALL_STYLE_ASSETS.find((candidate) => candidate.id === id);
  if (!asset) {
    throw new Error(`Unknown NIRS4ALL style asset: ${id}`);
  }
  return asset;
}

export function getNirs4allCssVariable(token: Nirs4allCssToken): string {
  return `var(--${token})`;
}
