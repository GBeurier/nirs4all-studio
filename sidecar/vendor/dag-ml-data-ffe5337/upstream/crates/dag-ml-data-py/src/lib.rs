//! Python bindings for `dag-ml-data` JSON contracts.
//!
//! The binding is intentionally narrow: it exposes validation, planning and
//! fingerprint functions over JSON strings, while host buffers and provider
//! vtables remain owned by host integrations.

use pyo3::create_exception;
use pyo3::exceptions::PyException;
use pyo3::prelude::*;
use pyo3::types::{PyAny, PyType};
use serde::de::DeserializeOwned;

use dag_ml_data_core::{
    builtin_adapter_registry_spec, builtin_data_model_specs, builtin_representations,
    data_plan_fingerprint, fold_set_fingerprint, plan_model_input, sample_relation_fingerprint,
    schema_fingerprint, tabular_numeric_model_input_spec, AdapterRegistry, AdapterRegistrySpec,
    CoordinatorDataPlanEnvelope, DataError as CoreDataError, DataPlan, DataPlanRequest,
    DatasetSchema, FoldSet, ModelInputSpec, SampleRelationTable,
};

create_exception!(_dag_ml_data, DagMlDataError, PyException);
// ADR-11 per-category subclasses. Every refusal raises the subclass matching its
// taxonomy category while staying catchable as the base `DagMlDataError`.
create_exception!(_dag_ml_data, DagMlDataValidationError, DagMlDataError);
create_exception!(_dag_ml_data, DagMlDataContractError, DagMlDataError);
create_exception!(_dag_ml_data, DagMlDataCompatibilityError, DagMlDataError);

/// Resolve the ADR-11 category string to its Python exception subclass. Unknown
/// categories fall back to the base `DagMlDataError`.
fn data_error_type_for_category<'py>(py: Python<'py>, category: &str) -> Bound<'py, PyType> {
    match category {
        "validation" => py.get_type::<DagMlDataValidationError>(),
        "data" => py.get_type::<DagMlDataContractError>(),
        "compatibility" => py.get_type::<DagMlDataCompatibilityError>(),
        _ => py.get_type::<DagMlDataError>(),
    }
}

const SHARED_FOLD_SET_FINGERPRINT: &str =
    "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c";

#[pyfunction]
fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[pyfunction]
fn contract_manifest_json() -> PyResult<String> {
    serde_json::to_string(&contract_manifest()).map_err(py_serde_error)
}

#[pyfunction]
fn builtin_data_models_json() -> PyResult<String> {
    serde_json::to_string(&builtin_data_model_specs()).map_err(py_serde_error)
}

#[pyfunction]
fn builtin_representations_json() -> PyResult<String> {
    serde_json::to_string(&builtin_representations()).map_err(py_serde_error)
}

#[pyfunction]
fn builtin_adapter_registry_json() -> PyResult<String> {
    serde_json::to_string(&builtin_adapter_registry_spec()).map_err(py_serde_error)
}

#[pyfunction]
fn tabular_numeric_model_input_spec_json() -> PyResult<String> {
    serde_json::to_string(&tabular_numeric_model_input_spec()).map_err(py_serde_error)
}

#[pyfunction]
fn validate_dataset_schema_json(json: &str) -> PyResult<()> {
    validate_json::<DatasetSchema>(json, DatasetSchema::validate)
}

#[pyfunction]
fn dataset_schema_fingerprint_json(json: &str) -> PyResult<String> {
    let schema = parse_and_validate::<DatasetSchema>(json, DatasetSchema::validate)?;
    schema_fingerprint(&schema).map_err(py_core_error)
}

#[pyfunction]
fn validate_model_input_spec_json(json: &str) -> PyResult<()> {
    validate_json::<ModelInputSpec>(json, ModelInputSpec::validate)
}

#[pyfunction]
fn validate_adapter_registry_json(json: &str) -> PyResult<()> {
    adapter_registry_from_json(json).map(|_| ())
}

#[pyfunction]
fn plan_model_input_json(
    schema_json: &str,
    model_input_json: &str,
    adapter_registry_json: &str,
    request_json: &str,
) -> PyResult<String> {
    let schema = parse_and_validate::<DatasetSchema>(schema_json, DatasetSchema::validate)?;
    let model_input =
        parse_and_validate::<ModelInputSpec>(model_input_json, ModelInputSpec::validate)?;
    let adapters = adapter_registry_from_json(adapter_registry_json)?;
    let request = serde_json::from_str::<DataPlanRequest>(request_json).map_err(py_serde_error)?;
    let plan =
        plan_model_input(&schema, &model_input, &adapters, &request).map_err(py_core_error)?;
    serde_json::to_string(&plan).map_err(py_serde_error)
}

#[pyfunction]
fn validate_data_plan_json(json: &str) -> PyResult<()> {
    validate_json::<DataPlan>(json, DataPlan::validate)
}

#[pyfunction]
fn data_plan_fingerprint_json(json: &str) -> PyResult<String> {
    let plan = parse_and_validate::<DataPlan>(json, DataPlan::validate)?;
    data_plan_fingerprint(&plan).map_err(py_core_error)
}

#[pyfunction]
fn validate_sample_relation_table_json(json: &str) -> PyResult<()> {
    validate_json::<SampleRelationTable>(json, SampleRelationTable::validate)
}

#[pyfunction]
fn sample_relation_table_fingerprint_json(json: &str) -> PyResult<String> {
    let relations = parse_and_validate::<SampleRelationTable>(json, SampleRelationTable::validate)?;
    sample_relation_fingerprint(&relations).map_err(py_core_error)
}

#[pyfunction]
fn validate_fold_set_json(json: &str) -> PyResult<()> {
    validate_json::<FoldSet>(json, FoldSet::validate)
}

#[pyfunction]
fn fold_set_fingerprint_json(json: &str) -> PyResult<String> {
    let fold_set = parse_and_validate::<FoldSet>(json, FoldSet::validate)?;
    fold_set_fingerprint(&fold_set).map_err(py_core_error)
}

#[pyfunction]
fn validate_fold_set_against_sample_relations_json(
    fold_set_json: &str,
    sample_relations_json: &str,
) -> PyResult<()> {
    let fold_set = parse_and_validate::<FoldSet>(fold_set_json, FoldSet::validate)?;
    let relations = parse_and_validate::<SampleRelationTable>(
        sample_relations_json,
        SampleRelationTable::validate,
    )?;
    relations
        .validate_fold_set(&fold_set)
        .map_err(py_core_error)
}

#[pyfunction(signature = (schema_json, data_plan_json, sample_relations_json=None))]
fn build_coordinator_data_plan_envelope_json(
    schema_json: &str,
    data_plan_json: &str,
    sample_relations_json: Option<String>,
) -> PyResult<String> {
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
        .map_err(py_core_error)?;
    serde_json::to_string(&envelope).map_err(py_serde_error)
}

#[pyfunction]
fn validate_coordinator_data_plan_envelope_json(json: &str) -> PyResult<()> {
    validate_json::<CoordinatorDataPlanEnvelope>(json, CoordinatorDataPlanEnvelope::validate)
}

#[pymodule]
fn _dag_ml_data(py: Python<'_>, module: &Bound<'_, PyModule>) -> PyResult<()> {
    module.add("DagMlDataError", py.get_type::<DagMlDataError>())?;
    module.add(
        "DagMlDataValidationError",
        py.get_type::<DagMlDataValidationError>(),
    )?;
    module.add(
        "DagMlDataContractError",
        py.get_type::<DagMlDataContractError>(),
    )?;
    module.add(
        "DagMlDataCompatibilityError",
        py.get_type::<DagMlDataCompatibilityError>(),
    )?;
    module.add_function(wrap_pyfunction!(version, module)?)?;
    module.add_function(wrap_pyfunction!(contract_manifest_json, module)?)?;
    module.add_function(wrap_pyfunction!(builtin_data_models_json, module)?)?;
    module.add_function(wrap_pyfunction!(builtin_representations_json, module)?)?;
    module.add_function(wrap_pyfunction!(builtin_adapter_registry_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        tabular_numeric_model_input_spec_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(validate_dataset_schema_json, module)?)?;
    module.add_function(wrap_pyfunction!(dataset_schema_fingerprint_json, module)?)?;
    module.add_function(wrap_pyfunction!(validate_model_input_spec_json, module)?)?;
    module.add_function(wrap_pyfunction!(validate_adapter_registry_json, module)?)?;
    module.add_function(wrap_pyfunction!(plan_model_input_json, module)?)?;
    module.add_function(wrap_pyfunction!(validate_data_plan_json, module)?)?;
    module.add_function(wrap_pyfunction!(data_plan_fingerprint_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        validate_sample_relation_table_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        sample_relation_table_fingerprint_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(validate_fold_set_json, module)?)?;
    module.add_function(wrap_pyfunction!(fold_set_fingerprint_json, module)?)?;
    module.add_function(wrap_pyfunction!(
        validate_fold_set_against_sample_relations_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        build_coordinator_data_plan_envelope_json,
        module
    )?)?;
    module.add_function(wrap_pyfunction!(
        validate_coordinator_data_plan_envelope_json,
        module
    )?)?;
    Ok(())
}

fn contract_manifest() -> serde_json::Value {
    serde_json::json!({
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
    })
}

fn validate_json<T>(
    json: &str,
    validate: impl FnOnce(&T) -> dag_ml_data_core::Result<()>,
) -> PyResult<()>
where
    T: DeserializeOwned,
{
    parse_and_validate::<T>(json, validate).map(|_| ())
}

fn adapter_registry_from_json(json: &str) -> PyResult<AdapterRegistry> {
    let spec = serde_json::from_str::<AdapterRegistrySpec>(json).map_err(py_serde_error)?;
    AdapterRegistry::from_spec(spec).map_err(py_core_error)
}

fn parse_and_validate<T>(
    json: &str,
    validate: impl FnOnce(&T) -> dag_ml_data_core::Result<()>,
) -> PyResult<T>
where
    T: DeserializeOwned,
{
    let value = serde_json::from_str::<T>(json).map_err(py_serde_error)?;
    validate(&value).map_err(py_core_error)?;
    Ok(value)
}

fn py_serde_error(error: serde_json::Error) -> PyErr {
    py_core_error(CoreDataError::Serialization(error))
}

fn py_core_error(error: CoreDataError) -> PyErr {
    Python::attach(|py| {
        let descriptor = error.descriptor();
        let instance: PyResult<Bound<'_, PyAny>> = (|| {
            let exc_type = data_error_type_for_category(py, descriptor.category.as_str());
            let instance = exc_type.call1((descriptor.message.clone(),))?;
            instance.setattr("category", descriptor.category.as_str())?;
            instance.setattr("code", descriptor.code.as_str())?;
            instance.setattr("severity", descriptor.severity.as_str())?;
            instance.setattr("remediation_hint", descriptor.remediation_hint.as_str())?;

            let context_json =
                serde_json::to_string(&descriptor.context).unwrap_or_else(|_| "{}".to_string());
            let descriptor_json =
                serde_json::to_string(&descriptor).unwrap_or_else(|_| descriptor.message.clone());
            let context = py.import("json")?.call_method1("loads", (&context_json,))?;
            instance.setattr("context", context)?;
            instance.setattr("context_json", context_json)?;
            instance.setattr("descriptor_json", descriptor_json)?;
            Ok(instance)
        })();

        match instance {
            Ok(instance) => PyErr::from_value(instance),
            Err(_) => DagMlDataError::new_err(error.to_string()),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_dataset_schema_raises_binding_error() {
        Python::initialize();
        let error =
            validate_dataset_schema_json(r#"{"dataset_id":"","sample_ids":[],"sources":[]}"#)
                .expect_err("invalid schema should fail");
        assert!(error.to_string().contains("dataset"));
        Python::attach(|py| {
            let value = error.value(py);
            let category = value
                .getattr("category")
                .unwrap()
                .extract::<String>()
                .unwrap();
            let code = value.getattr("code").unwrap().extract::<String>().unwrap();
            let context_json = value
                .getattr("context_json")
                .unwrap()
                .extract::<String>()
                .unwrap();
            assert_eq!(category, "data");
            assert_eq!(code, "data_contract_validation");
            assert!(context_json.contains("detail"));
        });
    }

    #[test]
    fn error_subclasses_map_by_category() {
        Python::initialize();
        // Semantic validation failure -> "data" category -> DagMlDataContractError.
        let contract_err =
            validate_dataset_schema_json(r#"{"dataset_id":"","sample_ids":[],"sources":[]}"#)
                .expect_err("invalid schema should fail");
        // Malformed JSON -> "compatibility" category -> DagMlDataCompatibilityError.
        let compat_err = validate_dataset_schema_json("{").expect_err("malformed JSON should fail");
        Python::attach(|py| {
            let contract_value = contract_err.value(py);
            assert!(contract_value.is_instance_of::<DagMlDataContractError>());
            assert!(contract_value.is_instance_of::<DagMlDataError>());
            assert!(!contract_value.is_instance_of::<DagMlDataCompatibilityError>());

            let compat_value = compat_err.value(py);
            assert!(compat_value.is_instance_of::<DagMlDataCompatibilityError>());
            assert!(compat_value.is_instance_of::<DagMlDataError>());
            assert_eq!(
                compat_value
                    .getattr("category")
                    .unwrap()
                    .extract::<String>()
                    .unwrap(),
                "compatibility"
            );
            assert_eq!(
                compat_value
                    .getattr("code")
                    .unwrap()
                    .extract::<String>()
                    .unwrap(),
                "serialization_error"
            );
        });
    }

    #[test]
    fn fingerprints_minimal_schema_fixture() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(std::path::Path::parent)
            .expect("workspace root");
        let schema = std::fs::read_to_string(root.join("examples/minimal_schema.json"))
            .expect("read schema fixture");
        let fingerprint =
            dataset_schema_fingerprint_json(&schema).expect("fingerprint fixture schema");
        assert_eq!(fingerprint.len(), 64);
    }

    #[test]
    fn contract_manifest_declares_binding_surface() {
        let manifest =
            serde_json::from_str::<serde_json::Value>(&contract_manifest_json().unwrap()).unwrap();
        assert_eq!(manifest["crate"], "dag-ml-data");
        assert_eq!(manifest["version"], env!("CARGO_PKG_VERSION"));
        assert!(manifest["python_exports"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("contract_manifest_json")));
        assert_eq!(
            manifest["shared"]["fold_set_fixture_fingerprint"],
            SHARED_FOLD_SET_FINGERPRINT
        );
    }
}
