// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//
// Types for the idiomatic ESM wrapper (idiomatic.mjs).

import type {
  NamedFile,
  RecordSet,
  InferOptions,
  ProposeOptions,
  DatasetPlan,
  DatasetSpec,
  ProposeResult,
  AssembledDataset,
} from "./types/nirs4all-io";

export interface NioModule {
  inferFiles(files: NamedFile[], options?: InferOptions): DatasetPlan;
  inferRecords(recordSets: RecordSet[]): DatasetPlan;
  inferDataset(files: NamedFile[], recordSets: RecordSet[], options?: InferOptions): DatasetPlan;
  proposeDataset(files: NamedFile[], recordSets: RecordSet[], options?: ProposeOptions): ProposeResult;
  assembleDataset(files: NamedFile[], recordSets: RecordSet[], spec: DatasetSpec | string): AssembledDataset;
  version(): string;
  /** Native-JS convenience: spec object/string in, canonical spec OBJECT out. */
  toSpec(spec: DatasetSpec | Record<string, unknown> | string): DatasetSpec;
  /** Native-JS convenience: spec object/string in; throws when invalid. */
  validateSpec(spec: DatasetSpec | Record<string, unknown> | string): void;
  /** Raw string-JSON surface (cross-binding contract). */
  to_spec(specJson: string): string;
  validate(specJson: string): void;
}

/** Build the idiomatic surface around a wasm-pack module instance. */
export function wrap(m: unknown): NioModule;

export const inferFiles: NioModule["inferFiles"];
export const inferRecords: NioModule["inferRecords"];
export const inferDataset: NioModule["inferDataset"];
export const proposeDataset: NioModule["proposeDataset"];
export const assembleDataset: NioModule["assembleDataset"];
export const version: NioModule["version"];
export const toSpec: NioModule["toSpec"];
export const validateSpec: NioModule["validateSpec"];
export const to_spec: NioModule["to_spec"];
export const validate: NioModule["validate"];

declare const nio: NioModule;
export default nio;

export type {
  NamedFile,
  RecordSet,
  InferOptions,
  ProposeOptions,
  DatasetPlan,
  DatasetSpec,
  ProposeResult,
  AssembledDataset,
};
