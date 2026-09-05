// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! Asserts the versioned-contract constants match `docs/VERSIONING.md` (7.5).
//! A change here MUST be accompanied by a docs change (and golden re-bless when
//! the canonical-JSON or schema version moves).

use nirs4all_io_core::{
    ASSEMBLED_DATASET_VERSION, CANONICAL_JSON_VERSION, CONVENTION_PROFILE_VERSION,
    DATASET_SPEC_SCHEMA_VERSION,
};

#[test]
fn documented_versions() {
    assert_eq!(DATASET_SPEC_SCHEMA_VERSION, 1, "see docs/VERSIONING.md");
    assert_eq!(CONVENTION_PROFILE_VERSION, 1, "see docs/VERSIONING.md");
    assert_eq!(CANONICAL_JSON_VERSION, 1, "see docs/VERSIONING.md");
    assert_eq!(ASSEMBLED_DATASET_VERSION, 2, "see docs/VERSIONING.md");
}
