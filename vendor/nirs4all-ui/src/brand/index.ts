/**
 * The canonical NIRS4ALL ecosystem brand manifest.
 *
 * `nirs4all-ui` is the single home of the shared brand kit: the real,
 * designer-made SVG marks for every ecosystem project live under
 * `assets/brands/<id>/` and are vendored here verbatim from the flagship
 * (`nirs4all-org`). Each project has its own distinct mark (a colored squircle
 * tile with a white NIRS spectrum + peak dot and a project wordmark); the
 * shared red accent (`#E9362D`) and teal master (`#058E96`) are constant.
 *
 * This module is pure TypeScript: no DOM, no React, no filesystem. It exposes
 * the manifest and stable asset paths; consumers load the SVG files themselves.
 */

export type Nirs4allBrandId =
  | "nirs4all"
  | "nirs4all-core"
  | "nirs4all-ui"
  | "nirs4all-studio"
  | "nirs4all-web"
  | "nirs4all-formats"
  | "nirs4all-io"
  | "nirs4all-methods"
  | "nirs4all-datasets"
  | "nirs4all-providers"
  | "nirs4all-benchmarks"
  | "nirs4all-repository"
  | "nirs4all-tools"
  | "nirs4all-papers"
  | "nirs4all-device"
  | "nirs4all-cluster"
  | "nirs4all-quality"
  | "dag-ml"
  | "dag-ml-data";

export type Nirs4allBrandVariant =
  | "icon"
  | "horizontal"
  | "horizontal-dark"
  | "stacked"
  | "stacked-dark";

/** Raster assets shipped alongside the SVG marks for every brand. */
export type Nirs4allBrandRaster =
  | "favicon"
  | "icon-32"
  | "icon-180"
  | "icon-256"
  | "icon-512"
  | "og";

const RASTER_FILES: Record<Nirs4allBrandRaster, string> = {
  favicon: "favicon.ico",
  "icon-32": "icon-32.png",
  "icon-180": "icon-180.png",
  "icon-256": "icon-256.png",
  "icon-512": "icon-512.png",
  og: "og.png",
};

export interface Nirs4allBrandPalette {
  /** the brand's tile accent color */
  primary: string;
  /** the constant NIRS4ALL red accent (the "4" and the peak dot) */
  accent: string;
  /** the flagship teal master token */
  master: string;
}

export interface Nirs4allBrandDefinition {
  id: Nirs4allBrandId;
  name: string;
  role: string;
  /** primary accent color of the mark (the squircle tile fill) */
  accent: string;
  palette: Nirs4allBrandPalette;
  tags: readonly string[];
}

const NIRS4ALL_RED = "#E9362D";
const NIRS4ALL_TEAL = "#058E96";

function brand(
  id: Nirs4allBrandId,
  name: string,
  role: string,
  accent: string,
  tags: readonly string[],
): Nirs4allBrandDefinition {
  return { id, name, role, accent, palette: { primary: accent, accent: NIRS4ALL_RED, master: NIRS4ALL_TEAL }, tags };
}

export const NIRS4ALL_BRANDS: readonly Nirs4allBrandDefinition[] = [
  brand("nirs4all", "nirs4all", "Ecosystem flagship — the Python library", "#058E96", ["flagship", "python"]),
  brand("nirs4all-core", "nirs4all-core", "Portable aggregate runtime", "#E9362D", ["core", "runtime", "bindings"]),
  brand("nirs4all-ui", "nirs4all-ui", "Shared visual system", "#2563EB", ["ui", "studio", "web"]),
  brand("nirs4all-studio", "nirs4all-studio", "Desktop & web application", "#96C800", ["app", "studio"]),
  brand("nirs4all-web", "nirs4all-web", "Standalone browser / WASM client", "#FF6400", ["web", "wasm"]),
  brand("nirs4all-formats", "nirs4all-formats", "Low-level file readers", "#6732B9", ["formats", "readers", "rust"]),
  brand("nirs4all-io", "nirs4all-io", "Dataset-assembly bridge", "#CC99FF", ["io", "datasets"]),
  brand("nirs4all-methods", "nirs4all-methods", "Portable PLS / NIRS engine", "#00A5D2", ["methods", "pls", "engine"]),
  brand("nirs4all-datasets", "nirs4all-datasets", "Curated dataset catalog", "#FFBE00", ["datasets", "catalog"]),
  brand("nirs4all-providers", "nirs4all-providers", "Optional provider facade", "#D946EF", ["providers", "datasets"]),
  brand("nirs4all-benchmarks", "nirs4all-benchmarks", "Reproducible scored pipelines", "#00704A", ["benchmarks", "arena"]),
  brand("nirs4all-repository", "nirs4all-repository", "Pipeline repository", "#AC564A", ["repository", "pipelines"]),
  brand("nirs4all-tools", "nirs4all-tools", "Migration & converter toolkit", "#475569", ["tools", "migration"]),
  brand("nirs4all-papers", "nirs4all-papers", "Deposited papers archive", "#C2255C", ["papers", "reproducibility"]),
  brand("nirs4all-device", "nirs4all-device", "Device integration", "#10B981", ["device", "hardware"]),
  brand("nirs4all-cluster", "nirs4all-cluster", "Cluster / HPC runner", "#1B5789", ["cluster", "hpc"]),
  brand("nirs4all-quality", "nirs4all-quality", "Quality / lab host (quali-nirs4all)", "#4F46E5", ["quality", "lab", "custom-host"]),
  brand("dag-ml", "dag-ml", "Reproducible ML coordinator", "#058E96", ["dag-ml", "coordinator", "rust"]),
  brand("dag-ml-data", "dag-ml-data", "Sample-aligned data contracts", "#FFBE00", ["dag-ml-data", "contracts"]),
];

const BRAND_ID_SET: ReadonlySet<string> = new Set(NIRS4ALL_BRANDS.map((definition) => definition.id));

export function isNirs4allBrandId(value: string): value is Nirs4allBrandId {
  return BRAND_ID_SET.has(value);
}

export function getNirs4allBrandDefinition(id: Nirs4allBrandId): Nirs4allBrandDefinition {
  const definition = NIRS4ALL_BRANDS.find((candidate) => candidate.id === id);
  if (!definition) {
    throw new Error(`Unknown NIRS4ALL brand: ${id}`);
  }
  return definition;
}

export function listNirs4allBrands(): readonly Nirs4allBrandDefinition[] {
  return NIRS4ALL_BRANDS;
}

/** Package-relative path to a vendored SVG mark, e.g. `assets/brands/nirs4all-studio/horizontal.svg`. */
export function getNirs4allBrandAssetPath(
  brand: Nirs4allBrandId | Nirs4allBrandDefinition,
  variant: Nirs4allBrandVariant,
): string {
  const id = typeof brand === "string" ? brand : brand.id;
  return `assets/brands/${id}/${variant}.svg`;
}

/** Package-relative path to a vendored raster asset, e.g. `assets/brands/nirs4all-studio/favicon.ico`. */
export function getNirs4allBrandRasterPath(
  brand: Nirs4allBrandId | Nirs4allBrandDefinition,
  raster: Nirs4allBrandRaster,
): string {
  const id = typeof brand === "string" ? brand : brand.id;
  return `assets/brands/${id}/${RASTER_FILES[raster]}`;
}
