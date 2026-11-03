//! Regression cases from the 2026-10-05 bug audit.

#[cfg(test)]
mod regressions {
    use std::collections::{BTreeMap, HashMap};
    use std::io::Cursor;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::sync::Arc;

    use arrow_array::{Float64Array, RecordBatch, StringArray};
    use arrow_ipc::writer::{FileWriter, StreamWriter};
    use arrow_schema::{DataType, Field, Schema};
    use dag_ml_data::*;
    use dag_ml_data_provider::JsonInMemoryProvider;
    use serde_json::{json, Value};

    const ENVELOPE: &str = include_str!(
        "../../../examples/fixtures/oof_campaign/coordinator_data_plan_envelope_nir.json"
    );
    const REQUEST: &str = include_str!(
        "../../../examples/fixtures/oof_campaign/materialization_request_model_base_x.json"
    );
    const SCHEMA: &str =
        include_str!("../../../examples/fixtures/oof_campaign/schema_nir_6_samples.json");
    const MODEL: &str =
        include_str!("../../../examples/fixtures/oof_campaign/model_input_tabular_numeric.json");
    const REGISTRY: &str = include_str!(
        "../../../examples/fixtures/oof_campaign/adapter_registry_signal_to_tabular.json"
    );

    fn sid(value: &str) -> SampleId {
        SampleId::new(value).unwrap()
    }
    fn oid(value: &str) -> ObservationId {
        ObservationId::new(value).unwrap()
    }
    fn rid(value: &str) -> RepresentationId {
        RepresentationId::new(value).unwrap()
    }
    fn tid(value: &str) -> TypeId {
        TypeId::new(value).unwrap()
    }

    fn adapter(id: &str, from: &str, to: &str, cost: u64) -> AdapterSpec {
        AdapterSpec {
            id: id.into(),
            version: "1".into(),
            input_type: tid("table"),
            input_representation: rid(from),
            output_type: tid("table"),
            output_representation: rid(to),
            cost,
            lossy: false,
            supervised: false,
            stateful: false,
            deterministic: true,
            fit_scope: FitScope::Stateless,
            params: BTreeMap::new(),
        }
    }

    fn predict_envelope() -> CoordinatorDataPlanEnvelope {
        let mut envelope: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        let mut relation = CoordinatorRelation::new(oid("obs.P001"), sid("P001"));
        relation.source_id = Some(SourceId::new("nir").unwrap());
        envelope.schema_version = 2;
        envelope.predict_cohort = Some(
            PredictCohort::from_relations(
                PredictCohortRole::Inference,
                CoordinatorRelationSet {
                    records: vec![relation],
                },
                vec!["y".into()],
                "b".repeat(64),
                None,
            )
            .unwrap(),
        );
        envelope
    }

    #[test]
    fn d01_v2_materializes_predict_and_training_authorities_separately() {
        let envelope = predict_envelope();
        envelope.validate().unwrap();
        let provider = JsonInMemoryProvider::from_json(
            &serde_json::to_string(&envelope).unwrap(),
            None,
            None,
            None,
        )
        .unwrap();
        let training = provider.materialize(REQUEST).unwrap();
        let training_view = provider.make_view(&training, "{}").unwrap();
        let training_rows: Value =
            serde_json::from_str(&provider.view_identity(&training_view).unwrap()).unwrap();
        assert!(!training_rows["records"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["sample_id"] == "P001"));
        let mut request: Value = serde_json::from_str(REQUEST).unwrap();
        request["phase"] = json!("PREDICT");
        request["predict_cohort"] = serde_json::to_value(&envelope.predict_cohort).unwrap();
        let predict = provider.materialize(&request.to_string()).unwrap();
        let view = provider.make_view(&predict, "{}").unwrap();
        let rows: Value = serde_json::from_str(&provider.view_identity(&view).unwrap()).unwrap();
        assert_eq!(rows["records"].as_array().unwrap().len(), 1);
        assert_eq!(rows["records"][0]["sample_id"], "P001");
        let mut tampered = envelope.clone();
        tampered
            .predict_cohort
            .as_mut()
            .unwrap()
            .data_content_fingerprint = "c".repeat(64);
        assert!(tampered.validate().is_err());
        request["predict_cohort"]["data_content_fingerprint"] = json!("c".repeat(64));
        assert!(provider.materialize(&request.to_string()).is_err());
    }

    #[test]
    fn d02_v1_refuses_predict_cohort() {
        let mut envelope = predict_envelope();
        envelope.schema_version = 1;
        assert!(envelope.validate().is_err());
        assert!(JsonInMemoryProvider::from_json(
            &serde_json::to_string(&envelope).unwrap(),
            None,
            None,
            None
        )
        .is_err());
        let mut value: Value = serde_json::from_str(ENVELOPE).unwrap();
        value["predict_cohort"] = json!({"role":"inference"});
        assert!(serde_json::from_value::<CoordinatorDataPlanEnvelope>(value).is_err());
    }

    #[test]
    fn d03_published_scientific_relation_fields_are_preserved() {
        let mut value: Value = serde_json::from_str(ENVELOPE).unwrap();
        let row = &mut value["coordinator_relations"]["records"][0];
        row["unit_level"] = json!("combo");
        row["unit_id"] = json!("unit.S001.nir");
        row["rep_id"] = json!("rep1");
        row["derived_unit_id"] = json!("derived.S001");
        row["component_observation_ids"] = json!(["obs.S001.base"]);
        row["sample_influence_weight"] = json!(0.25);
        row["quality_flag"] = json!("ok");
        let provider =
            JsonInMemoryProvider::from_json(&value.to_string(), None, None, None).unwrap();
        let data = provider.materialize(REQUEST).unwrap();
        let view = provider
            .make_view(&data, r#"{"sample_ids":["S001"]}"#)
            .unwrap();
        let result: Value = serde_json::from_str(&provider.view_identity(&view).unwrap()).unwrap();
        let exported = result["records"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| {
                r["observation_id"]
                    == value["coordinator_relations"]["records"][0]["observation_id"]
            })
            .unwrap();
        for key in [
            "unit_level",
            "unit_id",
            "rep_id",
            "derived_unit_id",
            "component_observation_ids",
            "sample_influence_weight",
            "quality_flag",
        ] {
            assert_eq!(
                exported.get(key),
                value["coordinator_relations"]["records"][0].get(key),
                "must preserve {key}"
            );
        }
    }

    #[test]
    fn d04_adapter_parameters_and_versions_change_plan_hash() {
        let schema: DatasetSchema = serde_json::from_str(SCHEMA).unwrap();
        let model: ModelInputSpec = serde_json::from_str(MODEL).unwrap();
        let mut registry_spec: AdapterRegistrySpec = serde_json::from_str(REGISTRY).unwrap();
        let request = DataPlanRequest::new("same-plan");
        let first = plan_model_input(
            &schema,
            &model,
            &AdapterRegistry::from_spec(registry_spec.clone()).unwrap(),
            &request,
        )
        .unwrap();
        registry_spec.adapters[0]
            .params
            .insert("feature_order".into(), json!("reverse"));
        let changed_params = plan_model_input(
            &schema,
            &model,
            &AdapterRegistry::from_spec(registry_spec.clone()).unwrap(),
            &request,
        )
        .unwrap();
        registry_spec.adapters[0].version = "99.0.0".into();
        let changed_version = plan_model_input(
            &schema,
            &model,
            &AdapterRegistry::from_spec(registry_spec).unwrap(),
            &request,
        )
        .unwrap();
        assert_ne!(first, changed_params);
        assert_ne!(first, changed_version);
        assert_ne!(
            data_plan_fingerprint(&first).unwrap(),
            data_plan_fingerprint(&changed_version).unwrap()
        );
        assert_ne!(
            data_plan_fingerprint(&first).unwrap(),
            data_plan_fingerprint(&changed_params).unwrap()
        );
    }

    #[test]
    fn d05_max_hops_retains_a_valid_adapter_path() {
        let registry = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![
                adapter("cheap_sa", "s", "a", 1),
                adapter("cheap_ab", "a", "b", 1),
                adapter("cheap_bc", "b", "c", 1),
                adapter("costly_sx", "s", "x", 10),
                adapter("xc", "x", "c", 1),
                adapter("cg", "c", "g", 1),
            ],
        })
        .unwrap();
        let policy = PlanningPolicy {
            max_hops: Some(3),
            ..Default::default()
        };
        let found = registry.find_path(&tid("table"), &rid("s"), &tid("table"), &rid("g"), &policy);
        assert_eq!(
            found
                .path
                .as_ref()
                .unwrap()
                .adapters
                .iter()
                .map(|a| a.id.as_str())
                .collect::<Vec<_>>(),
            vec!["costly_sx", "xc", "cg"]
        );
        let feasible = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![
                adapter("costly_sx", "s", "x", 10),
                adapter("xc", "x", "c", 1),
                adapter("cg", "c", "g", 1),
            ],
        })
        .unwrap()
        .find_path(&tid("table"), &rid("s"), &tid("table"), &rid("g"), &policy);
        assert_eq!(feasible.path.unwrap().adapters.len(), 3);
    }

    #[test]
    fn d06_adapter_score_refuses_overflow_on_valid_u64_cost() {
        let mut edge = adapter("lossy", "s", "g", u64::MAX);
        edge.lossy = true;
        edge.validate().unwrap();
        let registry = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![edge],
        })
        .unwrap();
        let policy = PlanningPolicy {
            allow_lossy: true,
            ..Default::default()
        };
        let result = catch_unwind(|| {
            registry.find_path(&tid("table"), &rid("s"), &tid("table"), &rid("g"), &policy)
        })
        .unwrap();
        assert!(result.path.is_none());
        assert_eq!(result.issues[0].code, "cost_overflow");
    }

    #[test]
    fn d06_adapter_path_sum_refuses_overflow() {
        let registry = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![
                adapter("sa", "s", "a", u64::MAX - 5),
                adapter("ag", "a", "g", 10),
            ],
        })
        .unwrap();
        let result = catch_unwind(|| {
            registry.find_path(
                &tid("table"),
                &rid("s"),
                &tid("table"),
                &rid("g"),
                &PlanningPolicy::default(),
            )
        })
        .unwrap();
        assert!(result.path.is_none());
        assert_eq!(result.issues[0].code, "cost_overflow");
    }

    #[test]
    fn d07_multi_source_planner_chooses_a_common_feasible_representation() {
        let mut schema: DatasetSchema = serde_json::from_str(SCHEMA).unwrap();
        let mut table = schema.sources[0].clone();
        table.id = SourceId::new("table_src").unwrap();
        table.type_id = tid("table");
        table.native_representation = builtin_representations()
            .into_iter()
            .find(|r| r.id == rid("tabular_numeric"))
            .unwrap();
        schema.sources.push(table);
        schema.validate().unwrap();
        let mut model: ModelInputSpec = serde_json::from_str(MODEL).unwrap();
        model.ports[0]
            .accepted_representations
            .insert(0, rid("signal_1d"));
        model.ports[0].accepted_types.insert(0, tid("dense_signal"));
        model.ports[0].multi_source = true;
        let registry = AdapterRegistry::from_spec(serde_json::from_str(REGISTRY).unwrap()).unwrap();
        let plan =
            plan_model_input(&schema, &model, &registry, &DataPlanRequest::new("mixed")).unwrap();
        assert_eq!(plan.output_representation, rid("tabular_numeric"));
        model.ports[0].accepted_representations = vec![rid("tabular_numeric")];
        model.ports[0].accepted_types = vec![tid("table")];
        assert!(
            plan_model_input(&schema, &model, &registry, &DataPlanRequest::new("mixed")).is_ok()
        );
    }

    #[test]
    fn d08_from_parts_refuses_relations_and_plan_outside_the_schema() {
        let schema: DatasetSchema = serde_json::from_str(SCHEMA).unwrap();
        let original: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        let relations: SampleRelationTable = serde_json::from_value(json!({"rows":[{
            "observation_id":"obs.PHANTOM", "sample_id":"PHANTOM", "source_id":"missing_source", "target_id":"missing_target",
            "group_id":null, "origin_id":null, "repetition_id":null, "augmented":false
        }]})).unwrap();
        relations.validate().unwrap();
        assert!(
            CoordinatorDataPlanEnvelope::from_parts(&schema, original.plan, Some(&relations))
                .is_err()
        );
    }

    #[test]
    fn d08_from_parts_refuses_a_plan_with_an_undeclared_source() {
        let schema: DatasetSchema = serde_json::from_str(SCHEMA).unwrap();
        let mut original: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        for step in &mut original.plan.steps {
            if step.source_id.is_some() {
                step.source_id = Some(SourceId::new("missing_source").unwrap());
            }
        }
        original.plan.validate().unwrap();
        assert!(CoordinatorDataPlanEnvelope::from_parts(&schema, original.plan, None).is_err());
    }

    #[test]
    fn d09_buffer_public_fields_are_revalidated_before_storage_and_projection() {
        let matrix = NumericFeatureMatrixF64 {
            feature_set_id: "x".into(),
            representation_id: rid("tabular_numeric"),
            feature_names: vec!["f0".into()],
            observation_ids: vec![oid("obs.S001.base")],
            values: vec![7.0],
            validity_mask: None,
        };
        let mut buffer = NumericFeatureBuffer::from_f64_matrix(matrix).unwrap();
        buffer.feature_names.push("ghost".into());
        assert!(
            NumericFeatureBufferStore::new(BTreeMap::from([("x".into(), buffer.clone())])).is_err()
        );
        let relations: CoordinatorRelationSet = serde_json::from_value(
            json!({"records":[{"observation_id":"obs.S001.base","sample_id":"S001"}]}),
        )
        .unwrap();
        assert!(catch_unwind(AssertUnwindSafe(
            || buffer.project_relations(&relations, None, None)
        ))
        .unwrap()
        .is_err());
        assert!(buffer.fingerprint().is_err());
    }

    #[test]
    fn d10_data_view_defaults_match_between_rust_and_json() {
        let arena = CoordinatorHandleArena::new("audit").unwrap();
        let envelope: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        let request: CoordinatorDataMaterializationRequest = serde_json::from_str(REQUEST).unwrap();
        let data = arena.materialize(&envelope, &request).unwrap();
        let native = arena
            .make_view(data.handle.handle, &DataView::default())
            .unwrap();
        let json_default: DataView = serde_json::from_str("{}").unwrap();
        let wire = arena.make_view(data.handle.handle, &json_default).unwrap();
        assert!(native.view.include_augmented);
        assert!(wire.view.include_augmented);
        assert_eq!(native.relation_record_count, wire.relation_record_count);
    }

    fn fitted(id: &str) -> FittedAdapterRef {
        serde_json::from_value(
            json!({"adapter_id":id,"adapter_version":"1","params_fingerprint":"a".repeat(64)}),
        )
        .unwrap()
    }

    #[test]
    fn d11_default_fitted_store_mints_nonzero_handle() {
        assert_eq!(
            InMemoryFittedAdapterStore::new()
                .register(fitted("a"))
                .unwrap()
                .handle,
            1
        );
        let store = InMemoryFittedAdapterStore::default();
        assert_eq!(store.register(fitted("a")).unwrap().handle, 1);
        let request: FittedAdapterMaterializationRequest =
            serde_json::from_value(json!({"adapter_id":"a","params_fingerprint":"a".repeat(64)}))
                .unwrap();
        assert_eq!(store.materialize(&request).unwrap(), 1);
    }

    fn batch(obs: &str, value: f64) -> RecordBatch {
        let schema = Schema::new_with_metadata(
            vec![
                Field::new("observation_id", DataType::Utf8, false),
                Field::new("f0", DataType::Float64, true),
            ],
            HashMap::from([
                ("dag_ml_data.feature_set_id".into(), "x".into()),
                (
                    "dag_ml_data.representation_id".into(),
                    "tabular_numeric".into(),
                ),
            ]),
        );
        RecordBatch::try_new(
            Arc::new(schema),
            vec![
                Arc::new(StringArray::from(vec![obs])),
                Arc::new(Float64Array::from(vec![value])),
            ],
        )
        .unwrap()
    }

    #[test]
    fn d12_regular_multibatch_ipc_stream_and_file_are_concatenated() {
        let first = batch("obs.1", 1.0);
        let second = batch("obs.2", 2.0);
        let mut one = Vec::new();
        {
            let mut w = StreamWriter::try_new(&mut one, &first.schema()).unwrap();
            w.write(&first).unwrap();
            w.finish().unwrap();
        }
        assert!(dag_ml_data_arrow::read_buffers_from_ipc_stream(Cursor::new(one)).is_ok());
        let mut stream = Vec::new();
        {
            let mut w = StreamWriter::try_new(&mut stream, &first.schema()).unwrap();
            w.write(&first).unwrap();
            w.write(&second).unwrap();
            w.finish().unwrap();
        }
        let store = dag_ml_data_arrow::read_buffers_from_ipc_stream(Cursor::new(stream)).unwrap();
        assert_eq!(
            store.get("x").unwrap().to_f64_column_matrix().columns,
            vec![vec![1.0, 2.0]]
        );
        let mut file = Vec::new();
        {
            let mut w = FileWriter::try_new(&mut file, &first.schema()).unwrap();
            w.write(&first).unwrap();
            w.write(&second).unwrap();
            w.finish().unwrap();
        }
        assert_eq!(
            dag_ml_data_arrow::read_buffers_from_ipc_file(Cursor::new(file)).unwrap(),
            store
        );
    }

    #[test]
    fn d13_inner_alignment_refuses_missing_sources() {
        let block = |source: &str, sample: &str| SourceFeatureBlock {
            source_id: SourceId::new(source).unwrap(),
            block: CoordinatorFeatureBlock {
                feature_set_id: source.into(),
                representation_id: rid("tabular_numeric"),
                feature_names: vec!["f".into()],
                observation_ids: vec![oid(&format!("obs.{sample}.{source}"))],
                sample_ids: vec![sid(sample)],
                values: vec![vec![json!(1.0)]],
            },
        };
        let blocks = vec![block("a", "S1"), block("b", "S2")];
        let alignment = SampleAlignmentPlan {
            mode: AlignmentMode::Inner,
            sample_ids: vec![sid("S1"), sid("S2")],
            masks: vec![
                PresenceMask {
                    source_id: SourceId::new("a").unwrap(),
                    sample_ids: vec![sid("S1"), sid("S2")],
                    present: vec![true, false],
                },
                PresenceMask {
                    source_id: SourceId::new("b").unwrap(),
                    sample_ids: vec![sid("S1"), sid("S2")],
                    present: vec![false, true],
                },
            ],
        };
        assert!(alignment.validate().is_err());
        assert!(
            fuse_feature_blocks("x", &blocks, &alignment, &FeatureFusionPolicy::default()).is_err()
        );
        let alignment = SampleAlignmentPlan {
            mode: AlignmentMode::Outer,
            ..alignment
        };
        let fused =
            fuse_feature_blocks("x", &blocks, &alignment, &FeatureFusionPolicy::default()).unwrap();
        assert_eq!(
            fused.values,
            vec![vec![json!(1.0), Value::Null], vec![Value::Null, json!(1.0)]]
        );
        let sets = blocks
            .iter()
            .map(source_sample_set_from_feature_block)
            .collect::<Result<Vec<_>>>()
            .unwrap();
        assert!(build_sample_alignment_plan(
            &sets,
            &AlignmentPolicy {
                mode: AlignmentMode::Inner
            }
        )
        .is_err());
    }

    #[test]
    fn d14_numeric_collation_dimension_overflow_returns_error() {
        let block = NumericCollationInputBlock {
            block_id: "audit".into(),
            representation_id: rid("series_mv"),
            observation_ids: vec![oid("obs.1"), oid("obs.2")],
            sample_ids: vec![sid("S1"), sid("S2")],
            rows: vec![vec![Some(1.0)], vec![Some(2.0)]],
            feature_names: None,
        };
        let policy = CollationPolicy {
            padding: CollationPadding::Right,
            max_length: Some(usize::MAX),
            ..Default::default()
        };
        assert!(catch_unwind(|| collate_numeric_block(&block, &policy))
            .unwrap()
            .is_err());
    }
    #[test]
    fn d01_d02_envelope_versions_enforce_published_root_members() {
        let mut v1: Value = serde_json::from_str(ENVELOPE).unwrap();
        v1["predict_cohort"] = Value::Null;
        assert!(serde_json::from_value::<CoordinatorDataPlanEnvelope>(v1.clone()).is_err());
        let schema: Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/coordinator_data_plan_envelope.schema.json"
        ))
        .unwrap();
        assert_eq!(schema["not"]["required"], json!(["predict_cohort"]));
        v1.as_object_mut().unwrap().remove("predict_cohort");
        v1["producer_extension"] = json!({"a":1});
        serde_json::from_value::<CoordinatorDataPlanEnvelope>(v1)
            .unwrap()
            .validate()
            .unwrap();
        let mut v2 = serde_json::to_value(predict_envelope()).unwrap();
        v2["producer_extension"] = json!({"a":1});
        assert!(serde_json::from_value::<CoordinatorDataPlanEnvelope>(v2).is_err());
        let mut heldout = predict_envelope();
        heldout.predict_cohort.as_mut().unwrap().role = PredictCohortRole::ExternalTest;
        assert!(heldout.validate().is_err());
    }

    #[test]
    fn d06_overflowing_branch_does_not_hide_a_finite_path() {
        let registry = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![
                adapter("sa", "s", "a", u64::MAX),
                adapter("ag", "a", "g", 10),
                adapter("sg", "s", "g", 42),
            ],
        })
        .unwrap();
        let path = registry
            .find_path(
                &tid("table"),
                &rid("s"),
                &tid("table"),
                &rid("g"),
                &PlanningPolicy::default(),
            )
            .path
            .unwrap();
        assert_eq!(path.total_cost, 42);
        let registry = AdapterRegistry::from_spec(AdapterRegistrySpec {
            adapters: vec![adapter("sg", "s", "g", u64::MAX)],
        })
        .unwrap();
        assert_eq!(
            registry
                .find_path(
                    &tid("table"),
                    &rid("s"),
                    &tid("table"),
                    &rid("g"),
                    &PlanningPolicy::default()
                )
                .path
                .unwrap()
                .total_cost,
            u64::MAX
        );
    }

    #[test]
    fn d08_each_source_relation_reference_is_checked_independently() {
        let schema: DatasetSchema = serde_json::from_str(SCHEMA).unwrap();
        let original: CoordinatorDataPlanEnvelope = serde_json::from_str(ENVELOPE).unwrap();
        let valid: SampleRelationTable = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        ))
        .unwrap();
        for field in ["sample_id", "source_id", "target_id"] {
            let mut wire = serde_json::to_value(&valid).unwrap();
            let row = wire["rows"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|row| row["augmented"] == false)
                .unwrap();
            row[field] = json!("unknown");
            let relations: SampleRelationTable = serde_json::from_value(wire).unwrap();
            assert!(
                CoordinatorDataPlanEnvelope::from_parts(
                    &schema,
                    original.plan.clone(),
                    Some(&relations)
                )
                .is_err(),
                "{field}"
            );
        }
    }

    #[test]
    fn d09_mutated_observation_index_is_refused() {
        let mut buffer = NumericFeatureBuffer::from_f64_matrix(NumericFeatureMatrixF64 {
            feature_set_id: "x".into(),
            representation_id: rid("tabular_numeric"),
            feature_names: vec!["f0".into()],
            observation_ids: vec![oid("obs.1"), oid("obs.2")],
            values: vec![1.0, 2.0],
            validity_mask: None,
        })
        .unwrap();
        buffer.observation_ids.swap(0, 1);
        assert!(buffer.validate().is_err());
        assert!(buffer.fingerprint().is_err());
        assert!(NumericFeatureBufferStore::new(BTreeMap::from([("x".into(), buffer)])).is_err());
    }

    #[test]
    fn d12_multibatch_masks_and_empty_batches_preserve_values() {
        let first = batch("obs.1", 1.0);
        let schema = first.schema();
        let null = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["obs.2"])),
                Arc::new(Float64Array::from(vec![None])),
            ],
        )
        .unwrap();
        let last = batch("obs.3", 3.0);
        let empty = RecordBatch::new_empty(schema.clone());
        let mut bytes = Vec::new();
        {
            let mut w = StreamWriter::try_new(&mut bytes, &schema).unwrap();
            for b in [&empty, &first, &null, &empty, &last] {
                w.write(b).unwrap();
            }
            w.finish().unwrap();
        }
        let matrix = dag_ml_data_arrow::read_buffers_from_ipc_stream(Cursor::new(bytes))
            .unwrap()
            .get("x")
            .unwrap()
            .to_f64_column_matrix();
        assert_eq!(matrix.columns, vec![vec![1.0, 0.0, 3.0]]);
        assert_eq!(matrix.validity_masks, Some(vec![vec![true, false, true]]));
        let mut duplicate = Vec::new();
        {
            let mut w = StreamWriter::try_new(&mut duplicate, &schema).unwrap();
            w.write(&first).unwrap();
            w.write(&first).unwrap();
            w.finish().unwrap();
        }
        assert!(dag_ml_data_arrow::read_buffers_from_ipc_stream(Cursor::new(duplicate)).is_err());
    }

    #[test]
    fn d13_left_alignment_requires_its_reference_source() {
        let mut alignment = SampleAlignmentPlan {
            mode: AlignmentMode::Left,
            sample_ids: vec![sid("S1")],
            masks: vec![
                PresenceMask {
                    source_id: SourceId::new("a").unwrap(),
                    sample_ids: vec![sid("S1")],
                    present: vec![false],
                },
                PresenceMask {
                    source_id: SourceId::new("b").unwrap(),
                    sample_ids: vec![sid("S1")],
                    present: vec![true],
                },
            ],
        };
        assert!(alignment.validate().is_err());
        alignment.masks[0].present[0] = true;
        alignment.masks[1].present[0] = false;
        alignment.validate().unwrap();
    }

    #[test]
    fn d14_addressable_cell_count_with_unaddressable_bytes_is_refused() {
        let block = NumericCollationInputBlock {
            block_id: "audit".into(),
            representation_id: rid("series_mv"),
            observation_ids: vec![oid("obs.1")],
            sample_ids: vec![sid("S1")],
            rows: vec![vec![Some(1.0)]],
            feature_names: None,
        };
        let policy = CollationPolicy {
            padding: CollationPadding::Right,
            max_length: Some(isize::MAX as usize / 8 + 1),
            ..Default::default()
        };
        assert!(collate_numeric_block(&block, &policy).is_err());
    }
}
