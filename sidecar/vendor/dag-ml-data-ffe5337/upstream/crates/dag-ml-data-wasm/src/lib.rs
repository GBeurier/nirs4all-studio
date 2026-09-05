//! Browser-friendly bindings for `dag-ml-data`.
//!
//! The DEFAULT build exposes only the stable schema, planning, fingerprint and
//! coordinator-envelope JSON contracts — no host buffers, no file I/O — so
//! `nirs4all-core` browser hosts can run them in a browser before delegating heavy data
//! access to a host provider.
//!
//! The opt-in `provider` feature adds the `WasmInMemoryProvider` type, an EAGER
//! in-WASM provider over `dag-ml-data-provider`'s `InMemoryProvider` (JSON in,
//! JSON out, decimal-string handles). An async JS buffer-fetcher provider
//! (fetching host buffers on demand via a Promise) is intentionally deferred to
//! a later slice.

use serde::de::DeserializeOwned;
use wasm_bindgen::prelude::*;

use dag_ml_data_core::{
    builtin_adapter_registry_spec, builtin_data_model_specs, builtin_representations,
    data_plan_fingerprint, fold_set_fingerprint, plan_model_input, sample_relation_fingerprint,
    schema_fingerprint, tabular_numeric_model_input_spec, AdapterRegistry, AdapterRegistrySpec,
    CoordinatorDataPlanEnvelope, DataError as CoreDataError, DataPlan, DataPlanRequest,
    DatasetSchema, FoldSet, ModelInputSpec, SampleRelationTable,
};

const SHARED_FOLD_SET_FINGERPRINT: &str =
    "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c";

#[wasm_bindgen]
pub fn dag_ml_data_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Eager in-WASM provider over `dag-ml-data-provider`'s `InMemoryProvider`.
///
/// JSON in, JSON out; handles cross as decimal strings (JS cannot represent the
/// full `u64` range as a number). Available only with the `provider` feature.
#[cfg(feature = "provider")]
#[wasm_bindgen]
pub struct WasmInMemoryProvider {
    core: dag_ml_data_provider::JsonInMemoryProvider,
}

/// A typed feature projection: a compact JSON `layout` (ids + shape) plus the
/// flat row-major `values`. The `values` getter marshals the f64 slice as one
/// `Float64Array` copy — no O(rows×cols) JSON string for the browser to parse.
#[cfg(feature = "provider")]
#[wasm_bindgen]
pub struct WasmFeatureBlockF64 {
    layout: String,
    values: Vec<f64>,
}

#[cfg(feature = "provider")]
#[wasm_bindgen]
impl WasmFeatureBlockF64 {
    /// Compact JSON: `{ feature_set_id, representation_id, feature_names,
    /// sample_ids, observation_ids, n_rows, n_cols }` — no per-cell values.
    #[wasm_bindgen(getter)]
    pub fn layout(&self) -> String {
        self.layout.clone()
    }

    /// Flat row-major f64 values as a `Float64Array`. Consumes the block so the
    /// buffer is moved out without a second copy in WASM memory.
    pub fn into_values(self) -> Vec<f64> {
        self.values
    }
}

#[cfg(feature = "provider")]
#[wasm_bindgen]
impl WasmInMemoryProvider {
    #[wasm_bindgen(constructor)]
    pub fn new(
        envelope_json: &str,
        target_tables_json: Option<String>,
        feature_tables_json: Option<String>,
        f64_feature_matrices_json: Option<String>,
    ) -> Result<WasmInMemoryProvider, JsValue> {
        let core = dag_ml_data_provider::JsonInMemoryProvider::from_json(
            envelope_json,
            target_tables_json.as_deref(),
            feature_tables_json.as_deref(),
            f64_feature_matrices_json.as_deref(),
        )
        .map_err(js_core_error)?;
        Ok(Self { core })
    }

    /// Typed-input constructor: the feature matrix's flat row-major `values`
    /// arrive as a `Float64Array` (copied straight into WASM memory) instead of
    /// a JSON array, so a large matrix never goes through `JSON.stringify` /
    /// boxed-array encoding on the JS side. `feature_matrix_meta_json` carries
    /// the matrix metadata (`feature_set_id`, `representation_id`,
    /// `feature_names`, `observation_ids`) WITHOUT a `values` field.
    ///
    /// DENSE-ONLY by contract: no validity mask, every value finite. Masked /
    /// missing data must use the JSON constructor + `feature_block` path.
    #[wasm_bindgen(js_name = withF64Features)]
    pub fn with_f64_features(
        envelope_json: &str,
        target_tables_json: Option<String>,
        feature_matrix_meta_json: &str,
        values: Vec<f64>,
    ) -> Result<WasmInMemoryProvider, JsValue> {
        let core = dag_ml_data_provider::JsonInMemoryProvider::from_json_with_f64_values(
            envelope_json,
            target_tables_json.as_deref(),
            feature_matrix_meta_json,
            values,
        )
        .map_err(js_core_error)?;
        Ok(Self { core })
    }

    pub fn materialize(&self, request_json: &str) -> Result<String, JsValue> {
        self.core.materialize(request_json).map_err(js_core_error)
    }

    pub fn make_view(&self, data_handle: &str, view_json: &str) -> Result<String, JsValue> {
        self.core
            .make_view(data_handle, view_json)
            .map_err(js_core_error)
    }

    pub fn view_identity(&self, view_handle: &str) -> Result<String, JsValue> {
        self.core.view_identity(view_handle).map_err(js_core_error)
    }

    pub fn target_block(&self, view_handle: &str, target_id: &str) -> Result<String, JsValue> {
        self.core
            .target_block(view_handle, target_id)
            .map_err(js_core_error)
    }

    pub fn feature_block(
        &self,
        view_handle: &str,
        feature_set_id: &str,
    ) -> Result<String, JsValue> {
        self.core
            .feature_block(view_handle, feature_set_id)
            .map_err(js_core_error)
    }

    /// Typed-output projection: returns a [`WasmFeatureBlockF64`] whose `values`
    /// are a flat `Float64Array`, avoiding the O(rows×cols) JSON of
    /// [`Self::feature_block`] (the prime memory/latency cost on large datasets).
    /// Flattens straight from the columnar store — no boxed per-cell values in
    /// WASM either. Masked cells are an error; use `feature_block` for those.
    #[wasm_bindgen(js_name = featureBlockF64)]
    pub fn feature_block_f64(
        &self,
        view_handle: &str,
        feature_set_id: &str,
    ) -> Result<WasmFeatureBlockF64, JsValue> {
        let (layout, values) = self
            .core
            .feature_block_f64(view_handle, feature_set_id)
            .map_err(js_core_error)?;
        Ok(WasmFeatureBlockF64 { layout, values })
    }

    pub fn feature_collation(
        &self,
        view_handle: &str,
        selector_json: &str,
    ) -> Result<String, JsValue> {
        self.core
            .feature_collation(view_handle, selector_json)
            .map_err(js_core_error)
    }

    pub fn feature_buffer_manifests(&self) -> Result<String, JsValue> {
        self.core.feature_buffer_manifests().map_err(js_core_error)
    }

    pub fn data_feature_buffer_bindings(&self, data_handle: &str) -> Result<String, JsValue> {
        self.core
            .data_feature_buffer_bindings(data_handle)
            .map_err(js_core_error)
    }

    pub fn release(&self, handle: &str) -> Result<bool, JsValue> {
        self.core.release(handle).map_err(js_core_error)
    }
}

#[wasm_bindgen]
pub fn contract_manifest_json() -> Result<String, JsValue> {
    serde_json::to_string(&contract_manifest()).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn builtin_data_models_json() -> Result<String, JsValue> {
    serde_json::to_string(&builtin_data_model_specs()).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn builtin_representations_json() -> Result<String, JsValue> {
    serde_json::to_string(&builtin_representations()).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn builtin_adapter_registry_json() -> Result<String, JsValue> {
    serde_json::to_string(&builtin_adapter_registry_spec()).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn tabular_numeric_model_input_spec_json() -> Result<String, JsValue> {
    serde_json::to_string(&tabular_numeric_model_input_spec()).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn validate_dataset_schema_json(json: &str) -> Result<(), JsValue> {
    validate_json::<DatasetSchema>(json, DatasetSchema::validate)
}

#[wasm_bindgen]
pub fn dataset_schema_fingerprint_json(json: &str) -> Result<String, JsValue> {
    let schema = parse_and_validate::<DatasetSchema>(json, DatasetSchema::validate)?;
    schema_fingerprint(&schema).map_err(js_core_error)
}

#[wasm_bindgen]
pub fn validate_model_input_spec_json(json: &str) -> Result<(), JsValue> {
    validate_json::<ModelInputSpec>(json, ModelInputSpec::validate)
}

#[wasm_bindgen]
pub fn validate_adapter_registry_json(json: &str) -> Result<(), JsValue> {
    adapter_registry_from_json(json).map(|_| ())
}

#[wasm_bindgen]
pub fn validate_data_plan_json(json: &str) -> Result<(), JsValue> {
    validate_json::<DataPlan>(json, DataPlan::validate)
}

#[wasm_bindgen]
pub fn data_plan_fingerprint_json(json: &str) -> Result<String, JsValue> {
    let plan = parse_and_validate::<DataPlan>(json, DataPlan::validate)?;
    data_plan_fingerprint(&plan).map_err(js_core_error)
}

#[wasm_bindgen]
pub fn validate_sample_relation_table_json(json: &str) -> Result<(), JsValue> {
    validate_json::<SampleRelationTable>(json, SampleRelationTable::validate)
}

#[wasm_bindgen]
pub fn sample_relation_table_fingerprint_json(json: &str) -> Result<String, JsValue> {
    let relations = parse_and_validate::<SampleRelationTable>(json, SampleRelationTable::validate)?;
    sample_relation_fingerprint(&relations).map_err(js_core_error)
}

#[wasm_bindgen]
pub fn validate_fold_set_json(json: &str) -> Result<(), JsValue> {
    validate_json::<FoldSet>(json, FoldSet::validate)
}

#[wasm_bindgen]
pub fn fold_set_fingerprint_json(json: &str) -> Result<String, JsValue> {
    let fold_set = parse_and_validate::<FoldSet>(json, FoldSet::validate)?;
    fold_set_fingerprint(&fold_set).map_err(js_core_error)
}

#[wasm_bindgen]
pub fn validate_fold_set_against_sample_relations_json(
    fold_set_json: &str,
    sample_relations_json: &str,
) -> Result<(), JsValue> {
    let fold_set = parse_and_validate::<FoldSet>(fold_set_json, FoldSet::validate)?;
    let relations = parse_and_validate::<SampleRelationTable>(
        sample_relations_json,
        SampleRelationTable::validate,
    )?;
    relations
        .validate_fold_set(&fold_set)
        .map_err(js_core_error)
}

#[wasm_bindgen]
pub fn validate_coordinator_data_plan_envelope_json(json: &str) -> Result<(), JsValue> {
    validate_json::<CoordinatorDataPlanEnvelope>(json, CoordinatorDataPlanEnvelope::validate)
}

#[wasm_bindgen]
pub fn build_coordinator_data_plan_envelope_json(
    schema_json: &str,
    data_plan_json: &str,
    sample_relations_json: Option<String>,
) -> Result<String, JsValue> {
    let schema = parse_and_validate::<DatasetSchema>(schema_json, DatasetSchema::validate)?;
    let plan = parse_and_validate::<DataPlan>(data_plan_json, DataPlan::validate)?;
    let relations = match sample_relations_json {
        Some(json) => Some(parse_and_validate::<SampleRelationTable>(
            &json,
            SampleRelationTable::validate,
        )?),
        None => None,
    };
    let envelope = CoordinatorDataPlanEnvelope::from_parts(&schema, plan, relations.as_ref())
        .map_err(js_core_error)?;
    serde_json::to_string(&envelope).map_err(js_serde_error)
}

#[wasm_bindgen]
pub fn plan_model_input_json(
    schema_json: &str,
    model_input_json: &str,
    adapter_registry_json: &str,
    request_json: &str,
) -> Result<String, JsValue> {
    let schema = parse_and_validate::<DatasetSchema>(schema_json, DatasetSchema::validate)?;
    let model_input =
        parse_and_validate::<ModelInputSpec>(model_input_json, ModelInputSpec::validate)?;
    let adapters = adapter_registry_from_json(adapter_registry_json)?;
    let request = serde_json::from_str::<DataPlanRequest>(request_json).map_err(js_serde_error)?;
    let plan =
        plan_model_input(&schema, &model_input, &adapters, &request).map_err(js_core_error)?;
    serde_json::to_string(&plan).map_err(js_serde_error)
}

fn adapter_registry_from_json(json: &str) -> Result<AdapterRegistry, JsValue> {
    let spec = serde_json::from_str::<AdapterRegistrySpec>(json).map_err(js_serde_error)?;
    AdapterRegistry::from_spec(spec).map_err(js_core_error)
}

fn contract_manifest() -> serde_json::Value {
    #[allow(unused_mut)]
    let mut manifest = serde_json::json!({
        "schema_version": 1,
        "crate": "dag-ml-data",
        "package": "dag-ml-data",
        "version": env!("CARGO_PKG_VERSION"),
        "surface": "json-contract-bindings",
        "contracts": [
            {"id": "dataset_schema", "version": 1},
            {"id": "model_input_spec", "version": 1},
            {"id": "adapter_registry", "version": 1},
            {"id": "data_plan", "version": 1},
            {"id": "sample_relation_table", "version": 1},
            {"id": "fold_set", "version": 1},
            {"id": "coordinator_data_plan_envelope", "version": 1},
            {"id": "feature_fusion_selector", "version": 1},
            {"id": "coordinator_branch_view", "version": 1},
            {"id": "fitted_adapter_ref", "version": 1}
        ],
        "capabilities": [
            "validate_json_contracts",
            "fingerprint_json_contracts",
            "plan_model_input",
            "build_coordinator_data_plan_envelope",
            "validate_fold_set_against_sample_relations",
            "nirs4all_core_schema_fields",
            "builtin_data_models",
            "structured_error_descriptors"
        ],
        "shared": {
            "fold_set_fixture_fingerprint": SHARED_FOLD_SET_FINGERPRINT
        },
        "python_exports": [
            "version",
            "contract_manifest_json",
            "builtin_data_models_json",
            "builtin_representations_json",
            "builtin_adapter_registry_json",
            "tabular_numeric_model_input_spec_json",
            "validate_dataset_schema_json",
            "dataset_schema_fingerprint_json",
            "validate_model_input_spec_json",
            "validate_adapter_registry_json",
            "plan_model_input_json",
            "validate_data_plan_json",
            "data_plan_fingerprint_json",
            "validate_sample_relation_table_json",
            "sample_relation_table_fingerprint_json",
            "validate_fold_set_json",
            "fold_set_fingerprint_json",
            "validate_fold_set_against_sample_relations_json",
            "build_coordinator_data_plan_envelope_json",
            "validate_coordinator_data_plan_envelope_json"
        ],
        "wasm_exports": [
            "dag_ml_data_version",
            "contract_manifest_json",
            "builtin_data_models_json",
            "builtin_representations_json",
            "builtin_adapter_registry_json",
            "tabular_numeric_model_input_spec_json",
            "validate_dataset_schema_json",
            "dataset_schema_fingerprint_json",
            "validate_model_input_spec_json",
            "validate_adapter_registry_json",
            "plan_model_input_json",
            "validate_data_plan_json",
            "data_plan_fingerprint_json",
            "validate_sample_relation_table_json",
            "sample_relation_table_fingerprint_json",
            "validate_fold_set_json",
            "fold_set_fingerprint_json",
            "validate_fold_set_against_sample_relations_json",
            "build_coordinator_data_plan_envelope_json",
            "validate_coordinator_data_plan_envelope_json"
        ],
        "c_abi_symbols": [
            "dagmldata_schema_fingerprint_json",
            "dagmldata_fold_set_validate_json",
            "dagmldata_fold_set_fingerprint_json",
            "dagmldata_fold_set_validate_against_relations_json",
            "dagmldata_aggregation_policy_validate_json",
            "dagmldata_coordinator_multi_target_arrow_json"
        ]
    });
    // The provider surface is a distinct, opt-in (`provider` feature) section so
    // it never blurs into the JSON-contract-only capability list.
    #[cfg(feature = "provider")]
    {
        manifest["provider_surface"] = serde_json::json!("eager-inwasm-provider");
        manifest["provider_exports"] = serde_json::json!([
            "WasmInMemoryProvider.new",
            "WasmInMemoryProvider.withF64Features",
            "WasmInMemoryProvider.materialize",
            "WasmInMemoryProvider.make_view",
            "WasmInMemoryProvider.view_identity",
            "WasmInMemoryProvider.target_block",
            "WasmInMemoryProvider.feature_block",
            "WasmInMemoryProvider.featureBlockF64",
            "WasmInMemoryProvider.feature_collation",
            "WasmInMemoryProvider.feature_buffer_manifests",
            "WasmInMemoryProvider.data_feature_buffer_bindings",
            "WasmInMemoryProvider.release"
        ]);
        manifest["provider_capabilities"] = serde_json::json!([
            "materialize",
            "make_view",
            "view_identity",
            "target_block",
            "feature_block",
            "feature_block_f64",
            "feature_collation",
            "feature_buffer_manifests",
            "data_feature_buffer_bindings",
            "release",
            "f64_typed_feature_io"
        ]);
    }
    manifest
}

fn validate_json<T>(
    json: &str,
    validate: impl FnOnce(&T) -> dag_ml_data_core::Result<()>,
) -> Result<(), JsValue>
where
    T: DeserializeOwned,
{
    parse_and_validate::<T>(json, validate).map(|_| ())
}

fn parse_and_validate<T>(
    json: &str,
    validate: impl FnOnce(&T) -> dag_ml_data_core::Result<()>,
) -> Result<T, JsValue>
where
    T: DeserializeOwned,
{
    let value = serde_json::from_str::<T>(json).map_err(js_serde_error)?;
    validate(&value).map_err(js_core_error)?;
    Ok(value)
}

fn js_serde_error(error: serde_json::Error) -> JsValue {
    js_core_error(CoreDataError::Serialization(error))
}

fn js_core_error(error: CoreDataError) -> JsValue {
    let payload = error
        .descriptor_json()
        .unwrap_or_else(|_| error.to_string());
    JsValue::from_str(&payload)
}
