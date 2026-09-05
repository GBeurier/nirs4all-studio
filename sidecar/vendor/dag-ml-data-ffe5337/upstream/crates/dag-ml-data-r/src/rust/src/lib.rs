//! R (extendr) provider bindings for `dag-ml-data`.
//!
//! A thin shim over `dag-ml-data-provider`'s shared `JsonInMemoryProvider`
//! (JSON in, JSON out; decimal-string handles). It contains no NIRS, ML or
//! scheduling logic — those live in `dag-ml-data` / `dag-ml`. The same Rust
//! provider core backs the native (Python ctypes via the C ABI) and WASM
//! bindings.

use extendr_api::prelude::*;

use dag_ml_data_core::DataError;
use dag_ml_data_provider::JsonInMemoryProvider;

/// Renders a `DataError` as its structured descriptor JSON (so R callers see the
/// same ADR-11 error payload as the other bindings).
fn error_message(error: DataError) -> String {
    error
        .descriptor_json()
        .unwrap_or_else(|_| error.to_string())
}

/// Treats an empty / whitespace R string argument as an absent option.
fn optional(value: &str) -> Option<&str> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

/// Unwraps a provider result, raising an R error via `throw_r_error` on failure.
/// Using `throw_r_error` (rather than returning `Result`) takes the same error
/// path under every panic strategy, including a WebR `panic=abort` build.
fn unwrap_or_throw<T>(result: std::result::Result<T, DataError>) -> T {
    match result {
        Ok(value) => value,
        Err(error) => throw_r_error(error_message(error)),
    }
}

/// In-memory `dag-ml-data` provider exposed to R: JSON in, JSON out, with
/// opaque decimal-string handles.
/// @export
#[extendr]
struct InMemoryProvider {
    inner: JsonInMemoryProvider,
}

#[extendr]
impl InMemoryProvider {
    /// Builds a provider from JSON strings. Pass "" for an absent argument; at
    /// most one of `feature_tables_json` / `f64_feature_matrices_json` may be a
    /// non-empty array. A construction error is raised as an R error.
    fn new(
        envelope_json: &str,
        target_tables_json: &str,
        feature_tables_json: &str,
        f64_feature_matrices_json: &str,
    ) -> Self {
        Self {
            inner: unwrap_or_throw(JsonInMemoryProvider::from_json(
                envelope_json,
                optional(target_tables_json),
                optional(feature_tables_json),
                optional(f64_feature_matrices_json),
            )),
        }
    }

    /// Materializes a data handle; returns it as a decimal string.
    fn materialize(&self, request_json: &str) -> String {
        unwrap_or_throw(self.inner.materialize(request_json))
    }

    /// Creates a view over a data handle; returns the view handle string.
    fn make_view(&self, data_handle: &str, view_json: &str) -> String {
        unwrap_or_throw(self.inner.make_view(data_handle, view_json))
    }

    /// Returns the view identity rows as JSON.
    fn view_identity(&self, view_handle: &str) -> String {
        unwrap_or_throw(self.inner.view_identity(view_handle))
    }

    /// Returns the target block JSON for a target id.
    fn target_block(&self, view_handle: &str, target_id: &str) -> String {
        unwrap_or_throw(self.inner.target_block(view_handle, target_id))
    }

    /// Returns the feature block JSON for a feature set.
    fn feature_block(&self, view_handle: &str, feature_set_id: &str) -> String {
        unwrap_or_throw(self.inner.feature_block(view_handle, feature_set_id))
    }

    /// Collates a selector into a row-major `NumericTensorBlock` JSON.
    fn feature_collation(&self, view_handle: &str, selector_json: &str) -> String {
        unwrap_or_throw(self.inner.feature_collation(view_handle, selector_json))
    }

    /// Returns the provider-wide feature-buffer manifests JSON.
    fn feature_buffer_manifests(&self) -> String {
        unwrap_or_throw(self.inner.feature_buffer_manifests())
    }

    /// Returns the feature-buffer bindings JSON scoped to a data handle.
    fn data_feature_buffer_bindings(&self, data_handle: &str) -> String {
        unwrap_or_throw(self.inner.data_feature_buffer_bindings(data_handle))
    }

    /// Releases a data or view handle; returns whether anything was released.
    fn release(&self, handle: &str) -> bool {
        unwrap_or_throw(self.inner.release(handle))
    }
}

extendr_module! {
    mod dagmldata;
    impl InMemoryProvider;
}
