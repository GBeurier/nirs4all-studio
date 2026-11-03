// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Declarative convention system (ports `nirs4all_io.conventions`).
//!
//! Pure: matches filename strings (supplied by the facade resolver) against
//! profiles and turns the match into a DatasetSpec dict. No file IO.

pub mod engine;
pub mod profiles;
pub mod to_spec;

pub use engine::{match_items, ConventionResult};
pub use profiles::{resolve_profiles, Profile};
pub use to_spec::assignments_to_spec_dict;
