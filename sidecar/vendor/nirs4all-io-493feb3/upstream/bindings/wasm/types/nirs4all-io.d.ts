// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//
// Hand-written TypeScript types for the nirs4all-io wasm binding.
//
// wasm-bindgen generates `any` for every `JsValue` parameter and return value
// (see the generated `nirs4all_io_wasm.d.ts`). This file gives the real shapes
// of the inputs and results so editors and `tsc` can check call sites. Import it
// alongside the generated module, or re-export through `idiomatic.mjs`.

/** A raw file: its name (used for source matching) and its bytes. */
export interface NamedFile {
  name: string;
  bytes: Uint8Array;
}

/** A set of decoded `nirs4all-formats` records for one source. */
export interface RecordSet {
  source: string;
  format?: string;
  records: unknown[];
}

/** Options for the inference entry points. */
export interface InferOptions {
  /** Override the default `nirs4all-classic` convention list. */
  conventions?: string[];
}

/** A user lock fed back into `proposeDataset` to honour a confirmed decision. */
export interface ConfirmedLock {
  kind: string;
  target: string;
  value?: unknown;
  status?: string;
}

/** Options for the iterative `proposeDataset` builder. */
export interface ProposeOptions extends InferOptions {
  confirmed?: ConfirmedLock[];
}

/** A single scored inference decision (structure, signal type, task type, ...). */
export interface Decision<T = unknown> {
  value: T;
  score: number;
  ambiguous: boolean;
  evidence: string[];
  alternatives: unknown[];
}

/** One source of a `DatasetSpec`. */
export interface SourceSpec {
  id: string;
  role: string;
  input: string;
  partition?: string;
  join?: unknown;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A canonical dataset specification. */
export interface DatasetSpec {
  schema_version: number;
  name?: string;
  sources: SourceSpec[];
  params?: Record<string, unknown>;
  partitions?: unknown;
  folds?: unknown;
  [key: string]: unknown;
}

/** A scored dataset plan produced by the inference entry points. */
export interface DatasetPlan {
  resolved_spec: DatasetSpec;
  overall_score: number;
  recommendations: string[];
  warnings: string[];
  structure: Decision<string>;
  signal_type: Decision<string>;
  task_type: Decision<string>;
  columns: unknown[];
  input: Record<string, unknown>;
  [key: string]: unknown;
}

/** A still-open (or echoed confirmed) decision from `proposeDataset`. */
export interface Proposal {
  kind: string;
  target: string;
  value: unknown;
  alternatives: unknown[];
  evidence: string[];
  score: number;
  ambiguous: boolean;
  status?: string;
}

/** The iterative builder result. */
export interface ProposeResult {
  plan: DatasetPlan;
  proposals: Proposal[];
  spec: DatasetSpec;
  valid: boolean;
  validation_errors: string[];
}

/** A materialized dataset (per-partition X/y/metadata blocks). */
export interface AssembledDataset {
  name: string;
  blocks: Record<string, unknown>;
  folds?: unknown;
  [key: string]: unknown;
}

// --- typed views of the wasm-pack exports -------------------------------------

export function to_spec(specJson: string): string;
export function validate(specJson: string): void;
export function version(): string;
export function inferFiles(files: NamedFile[], options?: InferOptions): DatasetPlan;
export function inferRecords(recordSets: RecordSet[]): DatasetPlan;
export function inferDataset(
  files: NamedFile[],
  recordSets: RecordSet[],
  options?: InferOptions,
): DatasetPlan;
export function proposeDataset(
  files: NamedFile[],
  recordSets: RecordSet[],
  options?: ProposeOptions,
): ProposeResult;
export function assembleDataset(
  files: NamedFile[],
  recordSets: RecordSet[],
  specJson: string,
): AssembledDataset;
/** Canonical structural summary from the same native fs-free assembler. */
export function loadSummary(
  files: NamedFile[],
  recordSets: RecordSet[],
  specJson: string,
): string;
