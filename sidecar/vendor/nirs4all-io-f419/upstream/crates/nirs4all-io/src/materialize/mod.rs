// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Materialization — the facade's filesystem entry.
//!
//! The assembly core (frame, join, fold parser, the pure CSV decoder, and the
//! assembler itself) moved into `nirs4all-io-core::materialize` so the WASM
//! binding can reach it. This module keeps the file IO: `read_table` (read +
//! gzip/zip + delegate to the core decoder), `parse_fold_file`, and the
//! `assemble(spec, base_dir)` wrapper that gathers inputs from disk then calls
//! the shared fs-free core. The moved types are re-exported here so downstream
//! (`nirs4all-io-dagml`, capi, cli, python binding) compiles unchanged.

pub mod assemble;
pub mod folds;
pub mod frame;
pub mod join;
pub mod loaders;

pub use assemble::{
    assemble, AssembledDataset, FoldProvenance, IdentityProvenance, PartitionBlock,
    ASSEMBLED_DATASET_VERSION,
};
pub use folds::{parse_fold_file, Fold};
pub use frame::{Cell, Column, Frame, Matrix};
pub use join::{concat_features, concat_samples, join_tables, merge_by_key, JoinAudit};
pub use loaders::{effective_params, read_table, LoadedTable};
