// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//
// Idiomatic ESM wrapper over the wasm-pack module. The raw exports
// (`inferFiles` / `inferDataset` / `proposeDataset` / `inferRecords` /
// `assembleDataset`) already return plain JS objects, so they are re-exported
// unchanged. The string-JSON surface (`to_spec` / `validate`) gets a small
// native-JS convenience: accept a spec OBJECT and return an OBJECT, doing the
// JSON.stringify / JSON.parse for you. The raw string functions stay reachable
// under their original names.
//
// Usage:
//   import * as nio from "./idiomatic.mjs";   // resolves the generated module
//   const plan = nio.inferFiles(files, { conventions: ["nirs4all-classic"] });
//   const spec = nio.toSpec({ name: "run", sources: [...] });   // -> object
//   nio.validateSpec(spec);                                     // throws if bad
//
// By default this imports the sibling `pkg/nirs4all_io_wasm.js` produced by
//   wasm-pack build bindings/wasm --target nodejs --out-dir pkg
// Pass a different module to `wrap()` to use another build/target.

import * as defaultModule from "./pkg/nirs4all_io_wasm.js";

/**
 * Build the idiomatic surface around a wasm-pack module instance.
 * @param {object} m the wasm-pack module (its raw exports)
 */
export function wrap(m) {
  return {
    // Raw, object-returning entry points — re-exported as-is.
    inferFiles: (files, options) => m.inferFiles(files, options ?? {}),
    inferRecords: (recordSets) => m.inferRecords(recordSets),
    inferDataset: (files, recordSets, options) => m.inferDataset(files, recordSets, options ?? {}),
    proposeDataset: (files, recordSets, options) => m.proposeDataset(files, recordSets, options ?? {}),
    assembleDataset: (files, recordSets, spec) =>
      m.assembleDataset(files, recordSets, typeof spec === "string" ? spec : JSON.stringify(spec)),
    version: () => m.version(),

    // Native-JS conveniences over the string-JSON surface.
    /** Normalize a spec object (or JSON string) into a canonical spec OBJECT. */
    toSpec: (spec) => JSON.parse(m.to_spec(typeof spec === "string" ? spec : JSON.stringify(spec))),
    /** Validate a spec object (or JSON string); throws when invalid. */
    validateSpec: (spec) => m.validate(typeof spec === "string" ? spec : JSON.stringify(spec)),

    // The raw string functions, unchanged, for the cross-binding JSON contract.
    to_spec: m.to_spec,
    validate: m.validate,
  };
}

const nio = wrap(defaultModule);

export const {
  inferFiles,
  inferRecords,
  inferDataset,
  proposeDataset,
  assembleDataset,
  version,
  toSpec,
  validateSpec,
  to_spec,
  validate,
} = nio;

export default nio;
