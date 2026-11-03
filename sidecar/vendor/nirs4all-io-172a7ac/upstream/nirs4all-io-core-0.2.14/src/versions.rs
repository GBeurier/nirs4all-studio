// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Versioned-contract constants (story 7.5).
//!
//! These mirror `docs/VERSIONING.md` and the Python side
//! (`nirs4all_io.spec.dataset_spec.SCHEMA_VERSION`). They are asserted in CI so
//! the docs and the code cannot drift. Each contract bumps for its own reason —
//! see `docs/VERSIONING.md`.

/// `DatasetSpec` wire-schema version, written into every emitted spec.
pub const DATASET_SPEC_SCHEMA_VERSION: u32 = 1;

/// Floor version for builtin convention profiles.
pub const CONVENTION_PROFILE_VERSION: u32 = 1;

/// Canonical-JSON form version (see `bindings/SPEC.md` §2).
pub const CANONICAL_JSON_VERSION: u32 = 1;
