// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Pure logic for `nirs4all-io`.
//!
//! This crate is deliberately independent of file IO, `nirs4all-formats`, and
//! `nirs4all`. It owns the `DatasetSpec` IR, selectors, the convention system,
//! inference over a neutral `FileDescription`/`TableProfile` interface it does
//! not itself populate, alias normalization, validation, and canonical JSON.
//!
//! The facade crate (`nirs4all-io`) owns all file IO and feeds neutral
//! descriptions into this core (D-R4).

pub mod canonical_json;
pub mod conventions;
pub mod infer;
pub mod materialize;
pub mod pyfmt;
pub mod spec;
pub mod versions;

pub use spec::SpecError;

pub use canonical_json::{canonical_json, CanonicalJsonError};
pub use materialize::ASSEMBLED_DATASET_VERSION;
pub use versions::{
    CANONICAL_JSON_VERSION, CONVENTION_PROFILE_VERSION, DATASET_SPEC_SCHEMA_VERSION,
};
