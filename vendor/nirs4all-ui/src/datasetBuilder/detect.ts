/**
 * Simple, extensible auto-detection of column roles + source signal type.
 *
 * Deliberately conservative: identifiers / replicate / partition / spectral X
 * are matched with high confidence; Y is only *proposed* (semanticType set) when
 * a column looks like a target, never assigned aggressively over real data.
 * Pure and deterministic so it can be unit-tested and reused server-side.
 */

import type {
  ColumnType,
  DatasetColumn,
  DatasetSource,
  SemanticType,
  SignalType,
} from "./types.js";

const ID_NAMES = [
  "sample_id",
  "sampleid",
  "plot_id",
  "plant_id",
  "genotype_id",
  "spectrum_id",
  "id",
  "sample",
  "uid",
];
const REPLICATE_NAMES = [
  "replicate",
  "rep",
  "repeat",
  "scan",
  "scan_id",
  "measurement",
  "measurement_id",
];
const PARTITION_NAMES = ["split", "partition", "set", "fold", "subset"];
const GROUP_NAMES = ["group", "site", "block", "batch", "location", "field", "genotype", "cultivar"];
const Y_NAMES = [
  "target",
  "label",
  "class",
  "disease",
  "protein",
  "trait",
  "phenotype",
  "moisture",
  "fat",
  "sugar",
  "yield",
  "y",
];

export const PARTITION_VALUES = new Set([
  "train",
  "test",
  "validation",
  "val",
  "dev",
  "calibration",
  "prediction",
  "cal",
]);

const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>(["integer", "float"]);

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Is the header a bare wavelength — `wavelength_1000`, `1000`, `1650.5`, `1000nm`? */
export function isSpectralHeader(name: string): boolean {
  const n = normalize(name);
  if (/^(wavelength|wl|wave|band|nm|w)_?\d+(\.\d+)?$/.test(n)) return true;
  if (/^\d+(\.\d+)?_?nm$/.test(n)) return true;
  if (/^\d+(\.\d+)?$/.test(n)) return true;
  return false;
}

function matchesAny(name: string, candidates: string[]): boolean {
  const n = normalize(name);
  return candidates.some((c) => n === c || n.includes(c));
}

/** Detect the signal type of a source from its columns + declared file type. */
export function guessSignalType(columns: DatasetColumn[], fileType: string): SignalType {
  const ft = fileType.toLowerCase();
  if (ft.includes("image") || ft === "folder") return "image";
  const spectralCount = columns.filter((c) => isSpectralHeader(c.name)).length;
  if (spectralCount >= 3) return "spectra";
  const hasTime = columns.some((c) => /time|date|timestamp/.test(normalize(c.name)));
  if (hasTime && columns.length <= 8) return "timeseries";
  const numeric = columns.filter((c) => NUMERIC_TYPES.has(c.detectedType)).length;
  if (numeric === 0) return "metadata";
  return "table";
}

interface Detected {
  assignedRole: DatasetColumn["assignedRole"];
  semanticType?: SemanticType;
}

/**
 * Detect a role for a single column given its neighbourhood. `spectralRun`
 * marks columns that belong to a contiguous numeric block even if their headers
 * are not literal wavelengths.
 */
export function detectColumnRole(
  column: DatasetColumn,
  spectralRun: boolean,
): Detected {
  const { name, detectedType } = column;

  if (isSpectralHeader(name) || (spectralRun && NUMERIC_TYPES.has(detectedType))) {
    return { assignedRole: "x", semanticType: "wavelength" };
  }
  if (matchesAny(name, ID_NAMES)) return { assignedRole: "id", semanticType: "identifier" };
  if (matchesAny(name, REPLICATE_NAMES)) return { assignedRole: "replicate" };
  if (matchesAny(name, PARTITION_NAMES)) return { assignedRole: "partition" };
  if (matchesAny(name, GROUP_NAMES)) return { assignedRole: "metadata" };

  if (matchesAny(name, Y_NAMES)) {
    const task: SemanticType = NUMERIC_TYPES.has(detectedType) ? "regression" : "classification";
    return { assignedRole: "y", semanticType: task };
  }

  return { assignedRole: "metadata" };
}

/**
 * Mark the longest contiguous run of numeric columns (>= 8 wide) as a spectral
 * block, mirroring the "colonnes toutes numériques contiguës" rule.
 */
function spectralRunFlags(columns: DatasetColumn[]): boolean[] {
  const flags = new Array(columns.length).fill(false);
  let runStart = 0;
  const MIN_RUN = 8;
  const closeRun = (end: number) => {
    if (end - runStart >= MIN_RUN) {
      for (let i = runStart; i < end; i++) flags[i] = true;
    }
  };
  for (let i = 0; i < columns.length; i++) {
    const current = columns[i];
    const numeric = current ? NUMERIC_TYPES.has(current.detectedType) : false;
    if (!numeric) {
      closeRun(i);
      runStart = i + 1;
    }
  }
  closeRun(columns.length);
  return flags;
}

/** Return a new column array with auto-detected roles, preserving manual ones. */
export function autoDetectColumns(columns: DatasetColumn[]): DatasetColumn[] {
  const runs = spectralRunFlags(columns);
  return columns.map((col, i) => {
    if (col.manual) return col;
    const detected = detectColumnRole(col, runs[i] ?? false);
    const next: DatasetColumn = { ...col, assignedRole: detected.assignedRole };
    if (detected.semanticType !== undefined) next.semanticType = detected.semanticType;
    else delete next.semanticType;
    return next;
  });
}

/** Full auto-detection pass over a source: signal type + column roles. */
export function autoDetectSource(source: DatasetSource): DatasetSource {
  const columns = autoDetectColumns(source.columns);
  const signalType = source.signalType && source.signalType !== "other"
    ? source.signalType
    : guessSignalType(columns, source.fileType);
  return { ...source, columns, signalType };
}
