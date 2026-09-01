// SPDX-License-Identifier: CeCILL-2.1 OR AGPL-3.0-or-later
//! `to_dag_ml_data`: build a dag-ml-data `CoordinatorDataPlanEnvelope` from a
//! nirs4all-io [`AssembledDataset`] (EPIC 10, D-R8, ADR-0001).
//!
//! io owns the assembled → envelope bridge. It maps the `AssembledDataset` onto a
//! `DatasetSchema` (+ `SourceDescriptor`/`RepresentationSpec`/`AxisSpec`;
//! nm→`Wavelength`, cm⁻¹→`Frequency`; signal_type→`tags`), a minimal `DataPlan`,
//! and a `SampleRelationTable` (observation/sample/group/repetition identity from
//! the repetition key, the only leakage unit io knows), then calls
//! `CoordinatorDataPlanEnvelope::from_parts` (it computes the three fingerprints
//! and self-validates). io does **not** build dag-ml `FoldSet`/`DataBinding` —
//! those are dag-ml's domain (folds/campaigns).
//!
//! This bridge resolves `dag-ml-data` from crates.io by default. The cross-CLI
//! conformance harness patches Cargo to the sibling checkout when it is present.
//! It remains a separate `publish = false` crate so the published `nirs4all-io`
//! CLI does not grow a hard dag-ml-data dependency.

use std::collections::{BTreeMap, BTreeSet};

use dag_ml_data::{
    sample_metadata, signal_1d, signal_with_processings, target_categorical,
    target_categorical_matrix, target_numeric, target_numeric_matrix, AxisKind, AxisSpec,
    CoordinateDType, CoordinateSpec, CoordinateValues, CoordinatorDataPlanEnvelope, DataPlan,
    DataPlanStep, DataPlanStepKind, DatasetSchema, FitScope, GroupId, MetadataFieldSpec,
    MetadataSchema, MetadataValueKind, ObservationId, RepetitionId, RepresentationId,
    RepresentationSpec, SampleId, SampleRelation, SampleRelationTable, SignalKind,
    SourceDescriptor, SourceGranularity, SourceId, TargetId, REPRESENTATION_FEATURE_BLOCK_SET,
    REPRESENTATION_SAMPLE_METADATA,
};
use nirs4all_io::core::infer::{ColDtype, NumericKind};
use nirs4all_io::core::materialize::package::DatasetPackage;
use nirs4all_io::core::spec::SpecError;
use nirs4all_io::materialize::AssembledDataset;
use serde_json::Value;

fn err<E: std::fmt::Display>(e: E) -> SpecError {
    SpecError::new(e.to_string())
}

/// Coerce an arbitrary label into a dag-ml-data identifier (ASCII alnum / `_-.`,
/// 1..=128 bytes). Unsupported characters collapse to `_`; an all-`_` or empty
/// result falls back to `fallback`.
fn sanitize(raw: &str, fallback: &str) -> String {
    let mut s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.trim_matches('_').is_empty() {
        s = fallback.to_string();
    }
    if s.len() > 128 {
        s.truncate(128);
    }
    s
}

/// Map a raw repetition value to a stable, unique dag-ml-data sample identifier.
/// The same raw always maps to the same id; distinct raw values that sanitize to
/// the same id are disambiguated with a numeric suffix rather than silently
/// merged (e.g. `A/B` and `A_B`, or two long ids sharing the first 128 bytes).
fn unique_sample_id(
    raw: &str,
    assigned: &mut BTreeMap<String, String>,
    taken: &mut BTreeSet<String>,
) -> String {
    if let Some(id) = assigned.get(raw) {
        return id.clone();
    }
    let base = sanitize(raw, "sample");
    let mut candidate = base.clone();
    let mut n = 1;
    while taken.contains(&candidate) {
        n += 1;
        let suffix = format!("_{n}");
        let mut head = base.clone();
        head.truncate(128usize.saturating_sub(suffix.len()));
        candidate = format!("{head}{suffix}");
    }
    taken.insert(candidate.clone());
    assigned.insert(raw.to_string(), candidate.clone());
    candidate
}

/// Map an io header unit onto a spectral axis kind + canonical unit string.
fn feature_axis(unit: &str) -> (AxisKind, Option<String>, &'static str) {
    let u = unit.to_ascii_lowercase();
    if u.contains("nm") || u.contains("nanomet") || u.contains("wavelength") {
        (AxisKind::Wavelength, Some("nm".to_string()), "wavelength")
    } else if u.contains("cm-1")
        || u.contains("cm^-1")
        || u.contains("1/cm")
        || u.contains("wavenumber")
        || u.contains("cm⁻¹")
    {
        (
            AxisKind::Wavenumber,
            Some("cm^-1".to_string()),
            "wavenumber",
        )
    } else {
        (AxisKind::Feature, None, "feature")
    }
}

/// Numeric axis coordinates from feature headers, only when every header parses
/// to a finite number and the count matches the axis size (else `None`, so the
/// `AxisSpec` size/coordinates invariant always holds).
fn numeric_coords(headers: &[String], size: usize) -> Option<CoordinateSpec> {
    if headers.len() != size {
        return None;
    }
    let mut out = Vec::with_capacity(size);
    for h in headers {
        let v: f64 = h.trim().parse().ok()?;
        if !v.is_finite() {
            return None;
        }
        out.push(Value::from(v));
    }
    Some(CoordinateSpec {
        dtype: CoordinateDType::Numeric,
        ordered: false,
        values: CoordinateValues::Explicit { values: out },
    })
}

fn categorical_coords(values: Vec<Value>) -> Option<CoordinateSpec> {
    if values.is_empty() {
        return None;
    }
    Some(CoordinateSpec {
        dtype: CoordinateDType::Categorical,
        ordered: false,
        values: CoordinateValues::Explicit { values },
    })
}

fn sample_axis(n_samples: usize) -> AxisSpec {
    AxisSpec {
        name: "sample".into(),
        kind: AxisKind::Sample,
        unit: None,
        size: Some(n_samples),
        variable: false,
        coordinate: None,
    }
}

fn feature_axis_spec(headers: &[String], n_features: usize, unit: &str) -> AxisSpec {
    let (kind, axis_unit, axis_name) = feature_axis(unit);
    AxisSpec {
        name: axis_name.into(),
        kind,
        unit: axis_unit,
        size: Some(n_features),
        variable: false,
        coordinate: numeric_coords(headers, n_features),
    }
}

fn processing_axis(names: Vec<String>) -> AxisSpec {
    AxisSpec {
        name: "processing".into(),
        kind: AxisKind::Processing,
        unit: None,
        size: Some(names.len()),
        variable: false,
        coordinate: categorical_coords(names.into_iter().map(Value::String).collect()),
    }
}

fn target_axis(headers: &[String]) -> AxisSpec {
    AxisSpec {
        name: "target".into(),
        kind: AxisKind::Target,
        unit: None,
        size: Some(headers.len()),
        variable: false,
        coordinate: categorical_coords(headers.iter().cloned().map(Value::String).collect()),
    }
}

fn signal_kind(raw: &str) -> SignalKind {
    match raw.trim().to_ascii_lowercase().as_str() {
        "absorbance" => SignalKind::Absorbance,
        "reflectance" => SignalKind::Reflectance,
        "transmittance" => SignalKind::Transmittance,
        "log_reflectance" | "log-reflectance" | "log reflectance" => SignalKind::LogReflectance,
        "preprocessed" => SignalKind::Preprocessed,
        _ => SignalKind::Unknown,
    }
}

fn processing_names(assembled: &AssembledDataset, source_idx: usize) -> Vec<String> {
    let mut names = vec!["native".to_string()];
    for block in assembled.blocks.values() {
        if let Some(source_processings) = block.processings.get(source_idx) {
            for (name, _) in source_processings {
                if !names.iter().any(|seen| seen == name) {
                    names.push(name.clone());
                }
            }
        }
    }
    names
}

fn source_representation(
    n_samples: usize,
    n_features: usize,
    headers: &[String],
    unit: &str,
    signal: Option<&str>,
    processings: &[String],
) -> RepresentationSpec {
    let kind = signal.map(signal_kind).unwrap_or(SignalKind::Unknown);
    let mut representation = if processings.len() > 1 {
        signal_with_processings(kind)
    } else {
        signal_1d(kind)
    };
    let feature_axis = feature_axis_spec(headers, n_features, unit);
    representation.axes = if processings.len() > 1 {
        vec![
            sample_axis(n_samples),
            processing_axis(processings.to_vec()),
            feature_axis,
        ]
    } else {
        vec![sample_axis(n_samples), feature_axis]
    };
    representation.rank = Some(representation.axes.len());
    representation
}

fn single_target_representation(
    n_samples: usize,
    _header: &str,
    categorical: bool,
) -> RepresentationSpec {
    let mut representation = if categorical {
        target_categorical()
    } else {
        target_numeric()
    };
    representation.axes = vec![sample_axis(n_samples)];
    representation.rank = Some(1);
    representation
}

fn target_matrix_representation(
    n_samples: usize,
    headers: &[String],
    categorical: bool,
) -> RepresentationSpec {
    let mut representation = if categorical {
        target_categorical_matrix()
    } else {
        target_numeric_matrix()
    };
    representation.axes = vec![sample_axis(n_samples), target_axis(headers)];
    representation.rank = Some(2);
    representation
}

fn target_is_categorical(
    assembled: &AssembledDataset,
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    header: &str,
) -> bool {
    first_block.y_categorical.contains_key(header)
        || matches!(assembled.task_type.as_str(), "binary" | "multiclass")
}

fn emit_target_specs(
    assembled: &AssembledDataset,
    n_samples: usize,
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    headers: &[String],
) -> Result<BTreeMap<TargetId, RepresentationSpec>, SpecError> {
    let mut targets = BTreeMap::new();
    if headers.is_empty() {
        return Ok(targets);
    }

    let target_kinds = headers
        .iter()
        .map(|header| target_is_categorical(assembled, first_block, header))
        .collect::<Vec<_>>();
    let all_same_kind = target_kinds
        .first()
        .is_some_and(|first| target_kinds.iter().all(|kind| kind == first));

    if headers.len() > 1 && all_same_kind {
        let id = TargetId::new("targets").map_err(err)?;
        targets.insert(
            id,
            target_matrix_representation(n_samples, headers, target_kinds[0]),
        );
        return Ok(targets);
    }

    for (i, header) in headers.iter().enumerate() {
        let tid = sanitize(header, &format!("target{i}"));
        targets.insert(
            TargetId::new(&tid).map_err(err)?,
            single_target_representation(n_samples, header, target_kinds[i]),
        );
    }
    Ok(targets)
}

fn metadata_value_kind(
    column: &nirs4all_io::core::materialize::frame::Column,
) -> MetadataValueKind {
    match column.dtype {
        ColDtype::Bool => MetadataValueKind::Boolean,
        ColDtype::Datetime => MetadataValueKind::Datetime,
        ColDtype::Numeric if column.numeric_kind == NumericKind::NonFloatNumeric => {
            MetadataValueKind::Integer
        }
        ColDtype::Numeric => MetadataValueKind::Number,
        ColDtype::String => MetadataValueKind::String,
    }
}

fn sample_metadata_representation(
    n_samples: usize,
    field_names: Vec<String>,
) -> Option<RepresentationSpec> {
    if field_names.is_empty() {
        return None;
    }
    let mut representation = sample_metadata();
    representation.axes = vec![
        sample_axis(n_samples),
        AxisSpec {
            name: "field".into(),
            kind: AxisKind::Feature,
            unit: None,
            size: Some(field_names.len()),
            variable: false,
            coordinate: categorical_coords(field_names.into_iter().map(Value::String).collect()),
        },
    ];
    representation.rank = Some(2);
    Some(representation)
}

fn emit_metadata(
    first_block: &nirs4all_io::core::materialize::PartitionBlock,
    n_samples: usize,
) -> (BTreeMap<String, RepresentationSpec>, Option<MetadataSchema>) {
    let Some(frame) = &first_block.metadata else {
        return (BTreeMap::new(), None);
    };
    let field_names = frame
        .columns
        .iter()
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();

    let mut metadata = BTreeMap::new();
    if let Some(representation) = sample_metadata_representation(n_samples, field_names) {
        metadata.insert(REPRESENTATION_SAMPLE_METADATA.to_string(), representation);
    }

    let fields = frame
        .columns
        .iter()
        .map(|column| {
            (
                column.name.clone(),
                MetadataFieldSpec {
                    kind: metadata_value_kind(column),
                    required: false,
                    unit: None,
                    allowed_values: vec![],
                    description: None,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();

    let schema = if fields.is_empty() {
        None
    } else {
        Some(MetadataSchema { fields })
    };
    (metadata, schema)
}

fn build_dag_ml_data_parts(
    assembled: &AssembledDataset,
) -> Result<(DatasetSchema, DataPlan, Option<SampleRelationTable>), SpecError> {
    let Some((_first, b0)) = assembled.blocks.iter().next() else {
        return Err(SpecError::new(
            "cannot emit dag-ml-data: dataset has no partitions",
        ));
    };
    if b0.x.is_empty() {
        return Err(SpecError::new(
            "cannot emit dag-ml-data: dataset has no feature source",
        ));
    }
    // Logical feature sources = X matrices per partition block, NOT
    // `assembled.n_sources` (which counts partition source-tables — a train/test
    // split is ONE logical source spread across blocks, and using the table count
    // would emit a phantom 0-feature source + a bogus join).
    let n_sources = b0.x.len();

    // --- sample / observation identity across all partitions ---
    // Use the repetition key (a leakage unit) iff it is present and aligned in
    // every partition; otherwise each observation is its own 1:1 sample with no
    // group_id (roadmap 10.2: group_id only when the key is a leakage unit).
    let rep_col = assembled.repetition.as_deref();
    let use_rep = rep_col.is_some_and(|col| {
        assembled.blocks.values().all(|b| {
            b.metadata
                .as_ref()
                .is_some_and(|f| f.has_column(col) && f.str_column(col).len() == b.n_samples)
        })
    });

    let mut sample_ids: Vec<SampleId> = Vec::new();
    let mut sample_seen: BTreeSet<String> = BTreeSet::new();
    let mut obs_per_sample: BTreeMap<String, usize> = BTreeMap::new();
    // raw repetition value -> assigned (collision-disambiguated) sample id.
    let mut sample_id_for_raw: BTreeMap<String, String> = BTreeMap::new();
    let mut taken_sample_ids: BTreeSet<String> = BTreeSet::new();
    let mut rows: Vec<SampleRelation> = Vec::new();
    let mut global = 0usize;
    for b in assembled.blocks.values() {
        let rep_vals = if use_rep {
            Some(
                b.metadata
                    .as_ref()
                    .expect("checked")
                    .str_column(rep_col.expect("checked")),
            )
        } else {
            None
        };
        for r in 0..b.n_samples {
            let (observation, sample, group, repetition) = if let Some(rv) = &rep_vals {
                let key = unique_sample_id(&rv[r], &mut sample_id_for_raw, &mut taken_sample_ids);
                let n = obs_per_sample.entry(key.clone()).or_insert(0);
                let observation = format!("{key}.obs{n}");
                let repetition = format!("rep.{n}");
                *n += 1;
                (observation, key.clone(), Some(key), Some(repetition))
            } else {
                let pair = (format!("obs.{global}"), format!("s.{global}"), None, None);
                global += 1;
                pair
            };
            if sample_seen.insert(sample.clone()) {
                sample_ids.push(SampleId::new(&sample).map_err(err)?);
            }
            rows.push(SampleRelation {
                observation_id: ObservationId::new(&observation).map_err(err)?,
                sample_id: SampleId::new(&sample).map_err(err)?,
                source_id: None,
                target_id: None,
                group_id: group.map(|g| GroupId::new(&g)).transpose().map_err(err)?,
                origin_id: None,
                repetition_id: repetition
                    .map(|r| RepetitionId::new(&r))
                    .transpose()
                    .map_err(err)?,
                augmented: false,
                excluded: false,
                metadata: BTreeMap::new(),
                tags: vec![],
                augmentation: None,
            });
        }
    }
    let n_samples = sample_ids.len();

    // --- sources (each X source → a standardized spectral representation) ---
    let mut sources = Vec::with_capacity(n_sources);
    for k in 0..n_sources {
        let n_features = b0.x[k].n_cols;
        let headers = b0.feature_headers.get(k).cloned().unwrap_or_default();
        let unit = b0.header_units.get(k).cloned().unwrap_or_default();
        let signal = b0.signal_types.get(k).and_then(Clone::clone);
        let processings = processing_names(assembled, k);
        let native_representation = source_representation(
            n_samples,
            n_features,
            &headers,
            &unit,
            signal.as_deref(),
            &processings,
        );
        let mut tags = BTreeMap::new();
        if let Some(sig) = &signal {
            tags.insert("signal_type".to_string(), Value::String(sig.clone()));
        }
        if processings.len() > 1 {
            tags.insert(
                "processing_layers".to_string(),
                Value::Array(processings.iter().cloned().map(Value::String).collect()),
            );
        }
        sources.push(SourceDescriptor {
            id: SourceId::new(sanitize(&format!("src_{k}"), "src")).map_err(err)?,
            name: format!("source {k}"),
            type_id: native_representation.type_id.clone(),
            modality: "spectroscopy".into(),
            native_representation,
            sample_key: "sample_id".into(),
            granularity: if use_rep {
                SourceGranularity::PerSampleRepeated
            } else {
                SourceGranularity::PerSample
            },
            schema: BTreeMap::new(),
            tags,
            shape_contract: None,
        });
    }

    // --- targets (standardized target-side contracts) ---
    let targets = if b0.y.is_some() {
        emit_target_specs(assembled, n_samples, b0, &b0.y_headers)?
    } else {
        BTreeMap::new()
    };

    // --- metadata (declared as sample_metadata when present) ---
    let (metadata, metadata_schema) = emit_metadata(b0, n_samples);

    let schema = DatasetSchema {
        dataset_id: sanitize(&assembled.name, "dataset"),
        sample_ids,
        sources,
        targets,
        metadata,
        metadata_schema,
        groups: vec![],
        folds: vec![],
    };

    // --- plan: materialize each source, join when multi-source ---
    let mut steps: Vec<DataPlanStep> = schema
        .sources
        .iter()
        .map(|s| DataPlanStep {
            kind: DataPlanStepKind::Materialize,
            source_id: Some(s.id.clone()),
            adapter_id: None,
            input_representation: None,
            output_representation: Some(s.native_representation.id.clone()),
            fit_scope: FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::new(),
        })
        .collect();
    let output_representation = if schema.sources.len() == 1 {
        schema.sources[0].native_representation.id.clone()
    } else {
        let model_input = RepresentationId::new(REPRESENTATION_FEATURE_BLOCK_SET).map_err(err)?;
        steps.push(DataPlanStep {
            kind: DataPlanStepKind::Join,
            source_id: None,
            adapter_id: None,
            input_representation: None,
            output_representation: Some(model_input.clone()),
            fit_scope: FitScope::Stateless,
            requires_user_choice: false,
            metadata: BTreeMap::new(),
        });
        model_input
    };
    let plan = DataPlan {
        id: sanitize(&format!("{}_plan", assembled.name), "plan"),
        steps,
        output_representation,
        issues: vec![],
    };

    let relations = if rows.is_empty() {
        None
    } else {
        Some(SampleRelationTable { rows })
    };
    Ok((schema, plan, relations))
}

/// Map an [`AssembledDataset`] to a dag-ml-data `CoordinatorDataPlanEnvelope`.
pub fn to_dag_ml_data(
    assembled: &AssembledDataset,
) -> Result<CoordinatorDataPlanEnvelope, SpecError> {
    let (schema, plan, relations) = build_dag_ml_data_parts(assembled)?;
    CoordinatorDataPlanEnvelope::from_parts(&schema, plan, relations.as_ref()).map_err(err)
}

/// Build the v2 [`DatasetPackage`] for an [`AssembledDataset`] — the typed-payload
/// + content-hash-manifest companion to [`to_dag_ml_data`] (`IO-002`).
///
/// This **extends** the bridge rather than replacing it: the same
/// `AssembledDataset` now yields both the dag-ml-data envelope
/// (`DatasetSchema`/`DataPlan`/`SampleRelationTable`) and the target-agnostic
/// package (typed payload blocks, a `content_hash` payload manifest, and an
/// explicit row-position fallback diagnostic). The package's representation-ID
/// hints are the same `DMD-001` strings the envelope's `SourceDescriptor`s use —
/// asserted by the `core_repr_ids_match_dag_ml_data_registry` drift guard below.
/// Payload-store export (`IO-006`) can later hang off this manifest without
/// touching the envelope seam.
pub fn to_dataset_package(assembled: &AssembledDataset) -> DatasetPackage {
    DatasetPackage::from_assembled(assembled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use dag_ml_data::{
        DataPlanStepKind, REPRESENTATION_SIGNAL_1D, REPRESENTATION_SIGNAL_WITH_PROCESSINGS,
        REPRESENTATION_TARGET_NUMERIC, REPRESENTATION_TARGET_NUMERIC_MATRIX,
    };
    use nirs4all_io::core::materialize::{
        AssembledDataset, Cell, Column, Frame, Matrix, PartitionBlock,
    };

    fn matrix(rows: usize, cols: usize) -> Matrix {
        Matrix {
            data: (0..rows * cols).map(|value| value as f32).collect(),
            n_rows: rows,
            n_cols: cols,
        }
    }

    fn assembled_with_block(block: PartitionBlock) -> AssembledDataset {
        let mut assembled = AssembledDataset {
            name: "demo".into(),
            task_type: "regression".into(),
            signal_type: "absorbance".into(),
            n_sources: 1,
            blocks: Default::default(),
            folds: vec![],
            fold_provenance: vec![],
            repetition: None,
            identity: Default::default(),
            aggregate: None,
            warnings: vec![],
            audits: vec![],
        };
        assembled.blocks.insert("train".to_string(), block);
        assembled
    }

    fn base_block() -> PartitionBlock {
        PartitionBlock {
            n_samples: 2,
            source_ids: vec!["spectra".into()],
            x: vec![matrix(2, 3)],
            feature_headers: vec![vec!["1000".into(), "1010".into(), "1020".into()]],
            header_units: vec!["nm".into()],
            signal_types: vec![Some("absorbance".into())],
            processings: vec![vec![]],
            y: Some(matrix(2, 1)),
            y_headers: vec!["protein".into()],
            y_categorical: Default::default(),
            metadata: Some(Frame::from_columns(
                vec![
                    Column::from_cells("batch", vec![Cell::Str("a".into()), Cell::Str("b".into())]),
                    Column::from_cells("rep", vec![Cell::Int(1), Cell::Int(2)]),
                ],
                "text",
            )),
            weights: None,
            weights_header: None,
        }
    }

    #[test]
    fn unique_sample_id_disambiguates_sanitization_collisions() {
        let mut assigned = BTreeMap::new();
        let mut taken = BTreeSet::new();
        // `A/B` sanitizes to `A_B`, which equals the sanitization of `A_B`.
        let a = unique_sample_id("A/B", &mut assigned, &mut taken);
        let b = unique_sample_id("A_B", &mut assigned, &mut taken);
        assert_ne!(
            a, b,
            "distinct raw values must not merge into one sample id"
        );
        // the same raw value is stable across calls
        assert_eq!(a, unique_sample_id("A/B", &mut assigned, &mut taken));
    }

    #[test]
    fn emits_standard_single_source_signal_target_and_metadata() {
        let (schema, plan, _relations) =
            build_dag_ml_data_parts(&assembled_with_block(base_block())).unwrap();
        let protein = TargetId::new("protein").unwrap();

        assert_eq!(schema.sources.len(), 1);
        assert_eq!(
            schema.sources[0].native_representation.id.as_str(),
            REPRESENTATION_SIGNAL_1D
        );
        assert_eq!(
            schema.sources[0].native_representation.axes[1].kind,
            AxisKind::Wavelength
        );
        assert_eq!(
            schema.targets[&protein].id.as_str(),
            REPRESENTATION_TARGET_NUMERIC
        );
        assert!(schema.metadata.contains_key(REPRESENTATION_SAMPLE_METADATA));
        assert!(schema
            .metadata_schema
            .as_ref()
            .is_some_and(|schema| schema.fields.contains_key("batch")));
        assert_eq!(
            plan.output_representation.as_str(),
            REPRESENTATION_SIGNAL_1D
        );
    }

    #[test]
    fn emits_processing_stack_when_variations_exist() {
        let mut block = base_block();
        block.processings = vec![vec![("snv".into(), matrix(2, 3))]];

        let (schema, _plan, _relations) =
            build_dag_ml_data_parts(&assembled_with_block(block)).unwrap();
        let representation = &schema.sources[0].native_representation;

        assert_eq!(
            representation.id.as_str(),
            REPRESENTATION_SIGNAL_WITH_PROCESSINGS
        );
        assert_eq!(representation.rank, Some(3));
        assert_eq!(representation.axes[1].kind, AxisKind::Processing);
        assert_eq!(representation.axes[1].size, Some(2));
    }

    #[test]
    fn emits_feature_block_set_for_multi_source_join() {
        let mut block = base_block();
        block.x.push(matrix(2, 2));
        block
            .feature_headers
            .push(vec!["1200".into(), "1210".into()]);
        block.header_units.push("nm".into());
        block.signal_types.push(Some("reflectance".into()));
        block.processings.push(vec![]);

        let mut assembled = assembled_with_block(block);
        assembled.n_sources = 2;
        let (schema, plan, _relations) = build_dag_ml_data_parts(&assembled).unwrap();

        assert_eq!(schema.sources.len(), 2);
        assert_eq!(
            plan.output_representation.as_str(),
            REPRESENTATION_FEATURE_BLOCK_SET
        );
        assert!(plan.steps.iter().any(|step| {
            step.kind == DataPlanStepKind::Join
                && step
                    .output_representation
                    .as_ref()
                    .is_some_and(|id| id.as_str() == REPRESENTATION_FEATURE_BLOCK_SET)
        }));
    }

    #[test]
    fn emits_target_matrix_for_uniform_multivariate_targets() {
        let mut block = base_block();
        block.y = Some(matrix(2, 2));
        block.y_headers = vec!["protein".into(), "moisture".into()];

        let (schema, _plan, _relations) =
            build_dag_ml_data_parts(&assembled_with_block(block)).unwrap();
        let targets = TargetId::new("targets").unwrap();
        let target = &schema.targets[&targets];

        assert_eq!(target.id.as_str(), REPRESENTATION_TARGET_NUMERIC_MATRIX);
        assert_eq!(target.rank, Some(2));
        assert_eq!(target.axes[1].kind, AxisKind::Target);
        assert_eq!(target.axes[1].size, Some(2));
    }
}
