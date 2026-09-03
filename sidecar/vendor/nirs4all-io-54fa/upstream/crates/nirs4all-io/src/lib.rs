// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Facade crate for `nirs4all-io`.
//!
//! Owns all file IO: resolution, tabular loaders, the relational join engine,
//! assembly, the `nirs4all-formats` vendor reads, and producing the neutral
//! descriptions fed to `nirs4all-io-core`. Wires the four stages
//! `resolve → infer → configure → materialize` together (D-R4).
//!
//! Re-exports the pure core so downstream crates depend on a single facade.

pub mod api;
pub mod infer;
pub mod materialize;
pub mod resolve;

pub use nirs4all_io_core as core;
pub use nirs4all_io_core::{canonical_json, CanonicalJsonError};
pub use resolve::{resolve_list, resolve_path, InputItem, InputSet};
