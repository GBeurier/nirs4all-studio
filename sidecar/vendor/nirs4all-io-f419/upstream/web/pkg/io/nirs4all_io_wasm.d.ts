/* tslint:disable */
/* eslint-disable */

/**
 * Assemble a `DatasetSpec` into a materialized, target-agnostic dataset, fs-free.
 *
 * `files` = array of `{name, bytes}` — CSV/tabular bytes the formats layer won't
 * decode (y / metadata tables). `recordSets` = array of `{source, format?,
 * records}` — pre-decoded `nirs4all-formats` records (signals → X, targets,
 * metadata). `spec` = a `DatasetSpec` JSON string (typically `plan.resolved_spec`);
 * its source `input` strings must match the `name`/`source` of the supplied
 * sources (exact, then file-stem, then glob). Returns `AssembledDataset` as a
 * plain JS object (per-partition `blocks` with `x`/`y`/headers/metadata + `folds`).
 *
 * `index_file`/`folds.file` partitions are not browser-reachable here (no fs) and
 * raise an error — column/inline partitions and folds work.
 */
export function assembleDataset(files: any, record_sets: any, spec: string): any;

/**
 * Infer a browser dataset plan from raw files and decoded spectral records.
 *
 * `files` must be an array of `{name, bytes}`. `recordSets` must be an array
 * of `{source, format?, records}` where records follow `nirs4all-formats`.
 */
export function inferDataset(files: any, record_sets: any, options: any): any;

/**
 * Infer a dataset plan from browser-provided files.
 *
 * `files` must be an array of `{name, bytes}` where `bytes` is a
 * `Uint8Array`. `options.conventions` can override the default
 * `nirs4all-classic` convention list.
 */
export function inferFiles(files: any, options: any): any;

/**
 * Infer a dataset plan from decoded spectral records.
 *
 * `recordSets` must be an array of `{source, format?, records}` where
 * `records` follows the JSON shape emitted by `nirs4all-formats`.
 */
export function inferRecords(record_sets: any): any;

/**
 * Iterative, user-validatable dataset inference.
 *
 * Inputs mirror [`infer_dataset`] plus `options.confirmed` — an array of
 * `{kind, target, value, status?}` locks the user has accepted/overridden,
 * fed back so re-inference honours them. Returns a plain JS object
 * `{plan, proposals, spec, valid, validation_errors}` where `proposals` is the
 * list of still-open (and echoed confirmed) decisions to validate.
 */
export function proposeDataset(files: any, record_sets: any, options: any): any;

/**
 * Normalize a spec/config JSON string into the canonical `DatasetSpec` JSON.
 */
export function to_spec(spec_json: string): string;

/**
 * Validate a `DatasetSpec` JSON string; throws (rejects) when invalid.
 */
export function validate(spec_json: string): void;

/**
 * The wire-contract (crate) version string.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly assembleDataset: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly inferDataset: (a: any, b: any, c: any) => [number, number, number];
    readonly inferFiles: (a: any, b: any) => [number, number, number];
    readonly inferRecords: (a: any) => [number, number, number];
    readonly proposeDataset: (a: any, b: any, c: any) => [number, number, number];
    readonly to_spec: (a: number, b: number) => [number, number, number, number];
    readonly validate: (a: number, b: number) => [number, number];
    readonly version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
