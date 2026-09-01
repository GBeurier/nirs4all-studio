// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! The canonical `DatasetSpec` IR and its closed vocabularies.
//!
//! Ports `nirs4all_io.spec` (enums, selectors, normalization, validation, the
//! IR, and its JSON schema). Pure: no file IO. The materializers consume only
//! the IR.

pub mod dataset_spec;
pub mod enums;
pub mod normalize;
pub mod role_tagged;
pub mod selectors;
pub mod validate;

pub use dataset_spec::DatasetSpec;
pub use enums::SpecError;
pub use normalize::normalize_to_spec_dict;
pub use role_tagged::role_tagged_config_to_spec;
pub use validate::validate_spec;
