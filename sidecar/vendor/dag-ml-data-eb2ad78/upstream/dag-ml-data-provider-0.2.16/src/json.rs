//! JSON transport facade over [`InMemoryProvider`].
//!
//! [`JsonInMemoryProvider`] is an additive convenience wrapper that takes and
//! returns UTF-8 JSON (and decimal-string handles) instead of typed Rust
//! contract values. It is shared by the non-C-ABI language bindings (WASM via
//! wasm-bindgen, R via extendr) so each binding is a tiny adapter rather than a
//! re-implementation. It depends only on `serde_json` — no wasm / R / FFI deps,
//! so the provider crate stays target-neutral. The typed
//! [`crate::DagMlDataProvider`] trait and [`InMemoryProvider`] remain the
//! contract-typed surface; this is strictly a string transport on top.
//!
//! Handles cross as DECIMAL STRINGS because JS (and R) numbers cannot represent
//! the full `u64` range.

use std::collections::BTreeMap;

use dag_ml_data_core::{
    collate_feature_block, CoordinatorDataMaterializationRequest, CoordinatorDataPlanEnvelope,
    CoordinatorFeatureTable, CoordinatorTargetTable, DataError, DataView,
    NumericFeatureBufferStore, NumericFeatureMatrixF64, ObservationId, RepresentationId, Result,
    TargetId,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;

use crate::{DagMlDataProvider, InMemoryProvider, ProviderFeatureCollationRequest};

/// JSON facade over [`InMemoryProvider`]: JSON in, JSON out, decimal-string
/// handles.
pub struct JsonInMemoryProvider {
    provider: InMemoryProvider,
}

impl JsonInMemoryProvider {
    /// Builds the provider from JSON. At most one of `feature_tables_json` or
    /// `f64_feature_matrices_json` may be a non-empty array. Each target table
    /// must hold only finite numbers or only non-empty string labels (scalars
    /// or equal-length vectors): a missing target (`null`, which
    /// `JSON.stringify` makes of `NaN`) or a string among numbers is refused as
    /// `data_contract_validation` rather than served back by `target_block`
    /// (see `CoordinatorTargetTable::validate_values`).
    pub fn from_json(
        envelope_json: &str,
        target_tables_json: Option<&str>,
        feature_tables_json: Option<&str>,
        f64_feature_matrices_json: Option<&str>,
    ) -> Result<Self> {
        let envelope: CoordinatorDataPlanEnvelope =
            serde_json::from_str(envelope_json).map_err(DataError::Serialization)?;
        let target_tables = parse_target_tables(target_tables_json)?;
        let feature_store = parse_feature_store(feature_tables_json, f64_feature_matrices_json)?;
        Ok(Self {
            provider: InMemoryProvider::new(envelope, target_tables, feature_store)?,
        })
    }

    /// Builds the provider from a JSON envelope/targets plus exactly ONE f64
    /// feature matrix whose flat row-major `values` are supplied as a typed
    /// slice rather than encoded in JSON. The metadata (`feature_set_id`,
    /// `representation_id`, `feature_names`, `observation_ids`) rides in
    /// `feature_matrix_meta_json` WITHOUT a `values` field. This keeps the hot
    /// numeric input off the JSON value-transport path (ABI.md): a binding can
    /// hand a `Float64Array` straight through as one typed-array copy instead of
    /// stringifying O(rows×cols) decimals.
    ///
    /// DENSE-ONLY by contract: the matrix carries no `validity_mask` and every
    /// value must be finite. Masked/missing data must come through the JSON
    /// matrix path (`from_json` with `f64_feature_matrices_json`), which the
    /// boxed [`Self::feature_block`] projection can serve as `null` cells.
    /// Target tables follow the same value rule as [`Self::from_json`].
    pub fn from_json_with_f64_values(
        envelope_json: &str,
        target_tables_json: Option<&str>,
        feature_matrix_meta_json: &str,
        values: Vec<f64>,
    ) -> Result<Self> {
        let envelope: CoordinatorDataPlanEnvelope =
            serde_json::from_str(envelope_json).map_err(DataError::Serialization)?;
        let target_tables = parse_target_tables(target_tables_json)?;
        let meta: F64FeatureMatrixMeta =
            serde_json::from_str(feature_matrix_meta_json).map_err(DataError::Serialization)?;
        let matrix = NumericFeatureMatrixF64 {
            feature_set_id: meta.feature_set_id,
            representation_id: meta.representation_id,
            feature_names: meta.feature_names,
            observation_ids: meta.observation_ids,
            values,
            validity_mask: None,
        };
        let feature_store = NumericFeatureBufferStore::from_f64_matrices(vec![matrix])?;
        Ok(Self {
            provider: InMemoryProvider::new(envelope, target_tables, feature_store)?,
        })
    }

    /// Materializes a data handle and returns it as a decimal string.
    pub fn materialize(&self, request_json: &str) -> Result<String> {
        let request: CoordinatorDataMaterializationRequest =
            serde_json::from_str(request_json).map_err(DataError::Serialization)?;
        let record = self.provider.materialize(&request)?;
        Ok(record.handle.handle.to_string())
    }

    /// Creates a view over `data_handle` and returns the view handle string.
    pub fn make_view(&self, data_handle: &str, view_json: &str) -> Result<String> {
        let view: DataView = serde_json::from_str(view_json).map_err(DataError::Serialization)?;
        let record = self.provider.make_view(parse_handle(data_handle)?, &view)?;
        Ok(record.handle.handle.to_string())
    }

    /// Returns the view identity rows as a `CoordinatorRelationSet` JSON.
    pub fn view_identity(&self, view_handle: &str) -> Result<String> {
        let relations = self.provider.view_identity(parse_handle(view_handle)?)?;
        serde_json::to_string(&relations).map_err(DataError::Serialization)
    }

    /// Returns the target block JSON for `target_id`.
    pub fn target_block(&self, view_handle: &str, target_id: &str) -> Result<String> {
        let target_id = TargetId::new(target_id)?;
        let block = self
            .provider
            .target_block(parse_handle(view_handle)?, &target_id)?;
        serde_json::to_string(&block).map_err(DataError::Serialization)
    }

    /// Returns the feature block JSON for `feature_set_id`.
    pub fn feature_block(&self, view_handle: &str, feature_set_id: &str) -> Result<String> {
        let block = self
            .provider
            .feature_block(parse_handle(view_handle)?, feature_set_id)?;
        serde_json::to_string(&block).map_err(DataError::Serialization)
    }

    /// Like [`Self::feature_block`] but returns the numeric matrix as a flat,
    /// row-major `Vec<f64>` plus a compact JSON layout sidecar (ids + shape, no
    /// per-cell values). This keeps the hot numeric OUTPUT off the JSON
    /// value-transport path (ABI.md) END TO END: the typed projection flattens
    /// straight from the columnar buffer — neither an O(rows×cols) JSON string
    /// nor `rows × cols` boxed `serde_json::Value`s are ever allocated. A
    /// binding marshals the f64 slice as one typed-array copy and reads the
    /// small layout separately. Masked cells are an error (no `Null` to
    /// project them into).
    pub fn feature_block_f64(
        &self,
        view_handle: &str,
        feature_set_id: &str,
    ) -> Result<(String, Vec<f64>)> {
        let block = self
            .provider
            .feature_block_f64(parse_handle(view_handle)?, feature_set_id)?;
        let n_rows = block.observation_ids.len();
        let n_cols = block.feature_names.len();
        let layout = serde_json::json!({
            "feature_set_id": block.feature_set_id,
            "representation_id": block.representation_id,
            "feature_names": block.feature_names,
            "sample_ids": block.sample_ids,
            "observation_ids": block.observation_ids,
            "n_rows": n_rows,
            "n_cols": n_cols,
        });
        let layout_json = serde_json::to_string(&layout).map_err(DataError::Serialization)?;
        Ok((layout_json, block.values))
    }

    /// Collates a selector (single feature set or multi-source fusion) into a
    /// row-major `NumericTensorBlock` JSON, honoring the selector's collation
    /// policy.
    pub fn feature_collation(&self, view_handle: &str, selector_json: &str) -> Result<String> {
        let selector: ProviderFeatureCollationRequest =
            serde_json::from_str(selector_json).map_err(DataError::Serialization)?;
        let block = self
            .provider
            .feature_collation_block(parse_handle(view_handle)?, &selector)?;
        let tensor = collate_feature_block(&block, &selector.policy)?;
        serde_json::to_string(&tensor).map_err(DataError::Serialization)
    }

    /// Returns the provider-wide feature-buffer manifests JSON.
    pub fn feature_buffer_manifests(&self) -> Result<String> {
        let manifests = self.provider.feature_buffer_manifests()?;
        serde_json::to_string(&manifests).map_err(DataError::Serialization)
    }

    /// Returns the feature-buffer bindings JSON scoped to a data handle.
    pub fn data_feature_buffer_bindings(&self, data_handle: &str) -> Result<String> {
        let bindings = self
            .provider
            .data_feature_buffer_bindings(parse_handle(data_handle)?)?;
        serde_json::to_string(&bindings).map_err(DataError::Serialization)
    }

    /// Releases a data or view handle; returns whether anything was released.
    pub fn release(&self, handle: &str) -> Result<bool> {
        Ok(self.provider.release(parse_handle(handle)?))
    }
}

fn parse_handle(handle: &str) -> Result<u64> {
    handle.parse::<u64>().map_err(|_| {
        DataError::Validation(format!("handle `{handle}` is not a u64 decimal string"))
    })
}

fn parse_target_tables(json: Option<&str>) -> Result<BTreeMap<TargetId, CoordinatorTargetTable>> {
    let tables: Vec<CoordinatorTargetTable> = parse_json_array(json)?;
    let mut by_target = BTreeMap::new();
    for table in tables {
        table.validate()?;
        let target_id = table.target_id.clone();
        if by_target.insert(target_id.clone(), table).is_some() {
            return Err(DataError::Validation(format!(
                "duplicate target table `{target_id}`"
            )));
        }
    }
    Ok(by_target)
}

fn parse_feature_store(
    feature_tables_json: Option<&str>,
    f64_feature_matrices_json: Option<&str>,
) -> Result<NumericFeatureBufferStore> {
    // Parse each candidate; a semantically-empty array (e.g. "[]", "[ ]") yields
    // an empty Vec and is treated as "no payload" — so an empty branch never
    // trips the both-inputs rejection.
    let feature_tables: Vec<CoordinatorFeatureTable> = parse_json_array(feature_tables_json)?;
    let f64_matrices: Vec<NumericFeatureMatrixF64> = parse_json_array(f64_feature_matrices_json)?;
    match (feature_tables.is_empty(), f64_matrices.is_empty()) {
        (false, false) => Err(DataError::Validation(
            "pass at most one of feature_tables or f64_feature_matrices".to_string(),
        )),
        (false, true) => NumericFeatureBufferStore::from_feature_tables(feature_tables),
        (true, false) => NumericFeatureBufferStore::from_f64_matrices(f64_matrices),
        (true, true) => Ok(NumericFeatureBufferStore::default()),
    }
}

/// Metadata for the typed-values constructor: a `NumericFeatureMatrixF64`
/// minus its `values` (those arrive as a typed slice, not JSON).
#[derive(Deserialize)]
struct F64FeatureMatrixMeta {
    feature_set_id: String,
    representation_id: RepresentationId,
    feature_names: Vec<String>,
    observation_ids: Vec<ObservationId>,
}

/// Parses an optional JSON array; absent or blank input yields an empty Vec.
fn parse_json_array<T: DeserializeOwned>(json: Option<&str>) -> Result<Vec<T>> {
    match json.map(str::trim).filter(|value| !value.is_empty()) {
        Some(json) => serde_json::from_str(json).map_err(DataError::Serialization),
        None => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENVELOPE: &str = include_str!(
        "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
    );
    const REQUEST: &str = include_str!(
        "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
    );
    const F64_MATRICES: &str = r#"[
        {
            "feature_set_id": "x",
            "representation_id": "tabular_numeric",
            "feature_names": ["f0", "f1"],
            "observation_ids": ["obs.S001.base", "obs.S001.rep1", "obs.S001.aug0", "obs.S002.base"],
            "values": [1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0]
        }
    ]"#;
    const TARGET_TABLES: &str = r#"[
        {
            "target_id": "y",
            "values": [
                {"sample_id": "S001", "value": 42.0},
                {"sample_id": "S002", "value": 7.0}
            ]
        }
    ]"#;

    fn provider() -> JsonInMemoryProvider {
        JsonInMemoryProvider::from_json(ENVELOPE, None, None, Some(F64_MATRICES)).unwrap()
    }

    fn io_bridge_envelope() -> String {
        let mut envelope: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        for relation in &mut envelope.coordinator_relations.as_mut().unwrap().records {
            relation.metadata.insert(
                "io.partition".to_string(),
                serde_json::json!(if relation.sample_id.as_str() == "S002" {
                    "validation"
                } else {
                    "train"
                }),
            );
            relation.metadata.insert(
                "io.sample_weight".to_string(),
                serde_json::json!(if relation.sample_id.as_str() == "S002" {
                    0.5
                } else {
                    1.0
                }),
            );
            relation
                .metadata
                .insert("io.source_ids".to_string(), serde_json::json!(["nir"]));
        }
        serde_json::to_string(&envelope).unwrap()
    }

    #[test]
    fn materialize_make_view_and_feature_block_round_trip() {
        let provider = provider();
        let data_handle = provider.materialize(REQUEST).unwrap();
        assert_eq!(data_handle, "1");
        let view = serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
            .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();
        let features: serde_json::Value =
            serde_json::from_str(&provider.feature_block(&view_handle, "x").unwrap()).unwrap();
        assert_eq!(
            features["observation_ids"],
            serde_json::json!(["obs.S002.base", "obs.S001.base", "obs.S001.rep1"])
        );
        assert_eq!(features["feature_names"], serde_json::json!(["f0", "f1"]));
    }

    #[test]
    fn by_filter_consumes_io_partition_and_preserves_scientific_identity_end_to_end() {
        // This is the production binding route: a bridge-produced envelope
        // enters the JSON facade, is materialized, then becomes a native branch
        // view. The provider only filters supplied relations; it cannot invent
        // sample ids, targets, groups, weights or source provenance.
        let envelope_json = io_bridge_envelope();
        let expected: CoordinatorDataPlanEnvelope = serde_json::from_str(&envelope_json).unwrap();
        let expected_records = expected
            .coordinator_relations
            .unwrap()
            .records
            .into_iter()
            .filter(|relation| {
                relation.metadata.get("io.partition") == Some(&serde_json::json!("train"))
            })
            .collect::<Vec<_>>();
        let provider = JsonInMemoryProvider::from_json(
            &envelope_json,
            Some(TARGET_TABLES),
            None,
            Some(F64_MATRICES),
        )
        .unwrap();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({
            "branch_view": {
                "view_id": "io:partition:train",
                "branch_id": "io:branch:train",
                "mode": "by_filter",
                "selector": {"filter": {"metadata_equals": {"io.partition": "train"}}}
            },
            "include_augmented": true
        })
        .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();
        let identity: dag_ml_data_core::CoordinatorRelationSet =
            serde_json::from_str(&provider.view_identity(&view_handle).unwrap()).unwrap();
        assert_eq!(identity.records, expected_records);
        let features: serde_json::Value =
            serde_json::from_str(&provider.feature_block(&view_handle, "x").unwrap()).unwrap();
        assert_eq!(
            features["observation_ids"],
            serde_json::json!(["obs.S001.aug0", "obs.S001.base", "obs.S001.rep1"])
        );
        let target: serde_json::Value =
            serde_json::from_str(&provider.target_block(&view_handle, "y").unwrap()).unwrap();
        assert_eq!(target["sample_ids"], serde_json::json!(["S001"]));
        assert_eq!(target["values"], serde_json::json!([42.0]));
    }

    fn target_tables_with(s002: serde_json::Value) -> String {
        serde_json::json!([{
            "target_id": "y",
            "values": [
                {"sample_id": "S001", "value": 42.0},
                {"sample_id": "S002", "value": s002}
            ]
        }])
        .to_string()
    }

    #[test]
    fn refuses_missing_and_non_finite_target_values_at_construction() {
        // `JSON.stringify(NaN)` is `null`; "NaN" is the string spelling.
        let f64_meta = r#"{
            "feature_set_id": "x",
            "representation_id": "tabular_numeric",
            "feature_names": ["f0", "f1"],
            "observation_ids": ["obs.S001.base", "obs.S001.rep1", "obs.S001.aug0", "obs.S002.base"]
        }"#;
        let f64_values = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0];
        for (value, reason) in [
            (serde_json::json!(null), "a missing (null) value"),
            (serde_json::json!("NaN"), "a non-numeric string value"),
        ] {
            let targets = target_tables_with(value);
            let from_json_error =
                JsonInMemoryProvider::from_json(ENVELOPE, Some(&targets), None, Some(F64_MATRICES))
                    .err()
                    .expect("JSON constructor must refuse the target table");
            let typed_error = JsonInMemoryProvider::from_json_with_f64_values(
                ENVELOPE,
                Some(&targets),
                f64_meta,
                f64_values.clone(),
            )
            .err()
            .expect("typed-values constructor must refuse the target table");
            for error in [from_json_error, typed_error] {
                assert_eq!(error.code(), "data_contract_validation");
                let message = format!("{error}");
                assert!(message.contains(reason), "{message}");
                assert!(message.contains("sample `S002`"), "{message}");
            }
        }
    }

    #[test]
    fn valid_target_values_are_served_unchanged_by_both_constructors() {
        let targets = target_tables_with(serde_json::json!(7.0));
        let meta = r#"{
            "feature_set_id": "x",
            "representation_id": "tabular_numeric",
            "feature_names": ["f0", "f1"],
            "observation_ids": ["obs.S001.base", "obs.S001.rep1", "obs.S001.aug0", "obs.S002.base"]
        }"#;
        let values = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0];
        for provider in [
            JsonInMemoryProvider::from_json(ENVELOPE, Some(&targets), None, Some(F64_MATRICES))
                .unwrap(),
            JsonInMemoryProvider::from_json_with_f64_values(ENVELOPE, Some(&targets), meta, values)
                .unwrap(),
        ] {
            let data_handle = provider.materialize(REQUEST).unwrap();
            let view =
                serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
                    .to_string();
            let view_handle = provider.make_view(&data_handle, &view).unwrap();
            let target: serde_json::Value =
                serde_json::from_str(&provider.target_block(&view_handle, "y").unwrap()).unwrap();
            assert_eq!(target["sample_ids"], serde_json::json!(["S002", "S001"]));
            assert_eq!(target["values"], serde_json::json!([7.0, 42.0]));
        }
    }

    #[test]
    fn categorical_target_labels_are_served_unchanged() {
        let targets = serde_json::json!([{
            "target_id": "y",
            "values": [
                {"sample_id": "S001", "value": "class_A"},
                {"sample_id": "S002", "value": "class_B"}
            ]
        }])
        .to_string();
        let provider =
            JsonInMemoryProvider::from_json(ENVELOPE, Some(&targets), None, Some(F64_MATRICES))
                .unwrap();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
            .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();
        let target: serde_json::Value =
            serde_json::from_str(&provider.target_block(&view_handle, "y").unwrap()).unwrap();
        assert_eq!(target["values"], serde_json::json!(["class_B", "class_A"]));
    }

    #[test]
    fn by_filter_json_facade_refuses_unknown_predicate_before_projecting_rows() {
        let provider = provider();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({
            "branch_view": {
                "view_id": "unsupported",
                "branch_id": "unsupported",
                "mode": "by_filter",
                "selector": {"filter": {"op": "always"}}
            }
        })
        .to_string();
        let error = provider.make_view(&data_handle, &view).unwrap_err();
        assert_eq!(error.code(), "data_contract_validation");
        assert!(format!("{error}").contains("native predicate"));
    }

    #[test]
    fn feature_collation_emits_tensor_with_mask() {
        let provider = provider();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
            .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();
        let selector =
            serde_json::json!({"feature_set_id": "x", "policy": {"emit_mask": true}}).to_string();
        let tensor: serde_json::Value =
            serde_json::from_str(&provider.feature_collation(&view_handle, &selector).unwrap())
                .unwrap();
        assert_eq!(tensor["shape"], serde_json::json!([3, 2]));
        assert!(tensor.get("values").is_some());
        assert!(tensor.get("presence_mask").is_some());
    }

    #[test]
    fn feature_block_f64_matches_json_block() {
        let provider = provider();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
            .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();

        let json_block: serde_json::Value =
            serde_json::from_str(&provider.feature_block(&view_handle, "x").unwrap()).unwrap();
        let (layout_json, values) = provider.feature_block_f64(&view_handle, "x").unwrap();
        let layout: serde_json::Value = serde_json::from_str(&layout_json).unwrap();

        // Same observation ordering + feature names, and the flat f64 values are
        // the JSON block's rows concatenated row-major (no per-cell JSON).
        assert_eq!(layout["observation_ids"], json_block["observation_ids"]);
        assert_eq!(layout["feature_names"], json_block["feature_names"]);
        assert_eq!(layout["n_cols"], serde_json::json!(2));
        let expected: Vec<f64> = json_block["values"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|row| row.as_array().unwrap().iter().map(|v| v.as_f64().unwrap()))
            .collect();
        assert_eq!(values, expected);
        assert_eq!(values.len() as i64, layout["n_rows"].as_i64().unwrap() * 2);
    }

    #[test]
    fn from_json_with_f64_values_round_trips() {
        // Same matrix as F64_MATRICES, but values come through the typed slice.
        let meta = r#"{
            "feature_set_id": "x",
            "representation_id": "tabular_numeric",
            "feature_names": ["f0", "f1"],
            "observation_ids": ["obs.S001.base", "obs.S001.rep1", "obs.S001.aug0", "obs.S002.base"]
        }"#;
        let values = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0, 4.0, 40.0];
        let provider =
            JsonInMemoryProvider::from_json_with_f64_values(ENVELOPE, None, meta, values).unwrap();
        let data_handle = provider.materialize(REQUEST).unwrap();
        let view = serde_json::json!({"sample_ids": ["S002", "S001"], "include_augmented": false})
            .to_string();
        let view_handle = provider.make_view(&data_handle, &view).unwrap();
        let (_, values) = provider.feature_block_f64(&view_handle, "x").unwrap();
        // S002.base row then S001.base, S001.rep1 (augmented excluded).
        assert_eq!(values, vec![4.0, 40.0, 1.0, 10.0, 2.0, 20.0]);
    }

    #[test]
    fn rejects_both_feature_inputs() {
        let feature_tables = r#"[{"feature_set_id":"a","representation_id":"r","feature_names":["f0"],"rows":[{"observation_id":"o1","values":[1.0]}]}]"#;
        let f64_matrices = r#"[{"feature_set_id":"b","representation_id":"r","feature_names":["f0"],"observation_ids":["o1"],"values":[1.0]}]"#;
        let error = match JsonInMemoryProvider::from_json(
            ENVELOPE,
            None,
            Some(feature_tables),
            Some(f64_matrices),
        ) {
            Ok(_) => panic!("expected an error when both feature inputs are provided"),
            Err(error) => error,
        };
        assert!(format!("{error}").contains("at most one"));
    }

    #[test]
    fn empty_array_branch_does_not_trip_both_inputs_rejection() {
        let provider =
            JsonInMemoryProvider::from_json(ENVELOPE, None, Some("[ ]"), Some(F64_MATRICES))
                .unwrap();
        assert_eq!(provider.materialize(REQUEST).unwrap(), "1");
    }

    #[test]
    fn rejects_non_decimal_handle() {
        let error = provider().view_identity("not-a-handle").unwrap_err();
        assert!(format!("{error}").contains("not a u64"));
    }
}
