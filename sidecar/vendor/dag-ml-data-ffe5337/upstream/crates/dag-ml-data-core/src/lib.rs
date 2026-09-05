//! Core contracts for `dag-ml-data`.
//!
//! This crate contains serializable descriptors and validation logic only. It
//! does not execute ML phases and does not own heavy host buffers.

pub mod adapter;
pub mod aggregation;
pub mod alignment;
pub mod buffer;
pub mod buffer_file_store;
pub mod builtin_models;
pub mod collation;
/// Internal streaming-hash primitive for bulk numeric content fingerprints.
/// Crate-private: it is not part of the public data contract, and keeping it
/// internal prevents an untrusted `ExactSizeIterator` from reaching
/// `absorb_str_collection`.
pub(crate) mod content_hash;
pub mod coordinator;
pub mod error;
pub mod fingerprint;
pub mod fitted_adapter;
pub mod fusion;
pub mod handle;
pub mod ids;
pub mod model;
pub mod nd_tensor;
pub mod plan;
pub mod planner;
pub mod relation;
pub mod representation_registry;

pub use adapter::*;
pub use aggregation::*;
pub use alignment::*;
pub use buffer::*;
pub use buffer_file_store::*;
pub use builtin_models::*;
pub use collation::*;
pub use coordinator::*;
pub use error::{DataError, DataErrorDescriptor, Result};
pub use fingerprint::*;
pub use fitted_adapter::*;
pub use fusion::*;
pub use handle::*;
pub use ids::*;
pub use model::*;
pub use nd_tensor::*;
pub use plan::*;
pub use planner::*;
pub use relation::*;
pub use representation_registry::*;
