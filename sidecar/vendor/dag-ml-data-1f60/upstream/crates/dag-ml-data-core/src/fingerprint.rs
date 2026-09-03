use sha2::{Digest, Sha256};

use crate::error::Result;
use crate::model::DatasetSchema;
use crate::plan::DataPlan;
use crate::relation::{FoldSet, SampleRelationTable};

pub fn schema_fingerprint(schema: &DatasetSchema) -> Result<String> {
    let mut canonical = schema.clone();
    canonical.validate()?;
    canonical.sample_ids.sort();
    canonical
        .sources
        .sort_by(|left, right| left.id.cmp(&right.id));
    canonical
        .groups
        .sort_by(|left, right| left.id.cmp(&right.id));
    canonical
        .folds
        .sort_by(|left, right| left.id.cmp(&right.id));

    let json = serde_json::to_vec(&canonical)?;
    let digest = Sha256::digest(json);
    Ok(to_hex(&digest))
}

pub fn data_plan_fingerprint(plan: &DataPlan) -> Result<String> {
    plan.validate()?;
    let json = serde_json::to_vec(plan)?;
    let digest = Sha256::digest(json);
    Ok(to_hex(&digest))
}

pub fn sample_relation_fingerprint(relations: &SampleRelationTable) -> Result<String> {
    let mut canonical = relations.clone();
    canonical.validate()?;
    canonical.rows.sort_by(|left, right| {
        left.observation_id
            .cmp(&right.observation_id)
            .then_with(|| left.sample_id.cmp(&right.sample_id))
            .then_with(|| left.source_id.cmp(&right.source_id))
    });

    let json = serde_json::to_vec(&canonical)?;
    let digest = Sha256::digest(json);
    Ok(to_hex(&digest))
}

pub fn fold_set_fingerprint(fold_set: &FoldSet) -> Result<String> {
    let mut canonical = fold_set.clone();
    canonical.validate()?;
    canonical.sample_ids.sort();
    canonical
        .folds
        .sort_by(|left, right| left.fold_id.cmp(&right.fold_id));
    for fold in &mut canonical.folds {
        fold.train_sample_ids.sort();
        fold.validation_sample_ids.sort();
    }

    let mut value = serde_json::to_value(&canonical)?;
    remove_empty_fold_set_maps(&mut value);
    let json = serde_json::to_vec(&value)?;
    let digest = Sha256::digest(json);
    Ok(to_hex(&digest))
}

fn remove_empty_fold_set_maps(value: &mut serde_json::Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if object
        .get("sample_groups")
        .and_then(serde_json::Value::as_object)
        .is_some_and(serde_json::Map::is_empty)
    {
        object.remove("sample_groups");
    }
    let Some(folds) = object
        .get_mut("folds")
        .and_then(serde_json::Value::as_array_mut)
    else {
        return;
    };
    for fold in folds {
        let Some(fold_object) = fold.as_object_mut() else {
            continue;
        };
        if fold_object
            .get("metadata")
            .and_then(serde_json::Value::as_object)
            .is_some_and(serde_json::Map::is_empty)
        {
            fold_object.remove("metadata");
        }
    }
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(&mut out, "{byte:02x}").expect("writing to string cannot fail");
    }
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use crate::ids::{GroupId, RepresentationId, SampleId, SourceId, TypeId};
    use crate::model::{
        AxisKind, AxisSpec, CoordinateDType, CoordinateSpec, CoordinateValues, DatasetSchema,
        FoldSpec, GroupKind, GroupSpec, RepresentationSpec, SourceDescriptor, SourceGranularity,
    };
    use crate::plan::DataPlan;
    use crate::relation::{FoldAssignment, FoldSet};

    use super::{
        data_plan_fingerprint, fold_set_fingerprint, sample_relation_fingerprint,
        schema_fingerprint,
    };

    const SHARED_FOLD_SET_FINGERPRINT: &str =
        "54d3185d6c628ef0df848828a8d8ae650222a283a78bbd3ab3bc2256f222c05c";

    fn representation(id: &str) -> RepresentationSpec {
        RepresentationSpec {
            id: RepresentationId::new(id).unwrap(),
            type_id: TypeId::new("table").unwrap(),
            rank: Some(2),
            axes: vec![
                AxisSpec {
                    name: "sample".to_string(),
                    kind: AxisKind::Sample,
                    unit: None,
                    size: Some(2),
                    variable: false,
                    coordinate: None,
                },
                AxisSpec {
                    name: "feature".to_string(),
                    kind: AxisKind::Feature,
                    unit: None,
                    size: Some(1),
                    variable: false,
                    coordinate: None,
                },
            ],
            container: "dataframe".to_string(),
            dtype: Some("float32".to_string()),
            sparse: false,
            ragged: false,
            signal_type: None,
        }
    }

    fn source(id: &str) -> SourceDescriptor {
        SourceDescriptor {
            id: SourceId::new(id).unwrap(),
            name: id.to_string(),
            type_id: TypeId::new("table").unwrap(),
            modality: "metadata".to_string(),
            native_representation: representation("tabular"),
            sample_key: "sample_id".to_string(),
            granularity: SourceGranularity::PerSample,
            schema: BTreeMap::new(),
            tags: BTreeMap::new(),
            shape_contract: None,
        }
    }

    #[test]
    fn fingerprint_is_independent_of_source_order() {
        let mut left = DatasetSchema {
            dataset_id: "d".to_string(),
            sample_ids: vec![SampleId::new("s2").unwrap(), SampleId::new("s1").unwrap()],
            sources: vec![source("b"), source("a")],
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: vec![
                GroupSpec {
                    id: GroupId::new("g.b").unwrap(),
                    kind: GroupKind::Batch,
                    column: "batch_b".to_string(),
                    source_id: Some(SourceId::new("b").unwrap()),
                    strict: false,
                    metadata: BTreeMap::new(),
                },
                GroupSpec {
                    id: GroupId::new("g.a").unwrap(),
                    kind: GroupKind::RepetitionGroup,
                    column: "sample_id".to_string(),
                    source_id: Some(SourceId::new("a").unwrap()),
                    strict: true,
                    metadata: BTreeMap::new(),
                },
            ],
            folds: vec![
                FoldSpec {
                    id: "fold.b".to_string(),
                    group_id: Some(GroupId::new("g.b").unwrap()),
                    split_column: Some("fold_b".to_string()),
                    metadata: BTreeMap::new(),
                },
                FoldSpec {
                    id: "fold.a".to_string(),
                    group_id: Some(GroupId::new("g.a").unwrap()),
                    split_column: Some("fold_a".to_string()),
                    metadata: BTreeMap::new(),
                },
            ],
        };
        let mut right = left.clone();
        right.sources.reverse();
        right.sample_ids.reverse();
        right.groups.reverse();
        right.folds.reverse();

        assert_eq!(
            schema_fingerprint(&left).unwrap(),
            schema_fingerprint(&right).unwrap()
        );

        left.dataset_id = "different".to_string();
        assert_ne!(
            schema_fingerprint(&left).unwrap(),
            schema_fingerprint(&right).unwrap()
        );
    }

    #[test]
    fn data_plan_fingerprint_is_stable() {
        let plan: DataPlan = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/expected_data_plan_nir_to_tabular.json"
        ))
        .unwrap();

        assert_eq!(
            data_plan_fingerprint(&plan).unwrap(),
            data_plan_fingerprint(&plan).unwrap()
        );
    }

    #[test]
    fn sample_relation_fingerprint_is_stable() {
        let relations: crate::relation::SampleRelationTable = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        ))
        .unwrap();

        assert_eq!(
            sample_relation_fingerprint(&relations).unwrap(),
            sample_relation_fingerprint(&relations).unwrap()
        );
    }

    #[test]
    fn empty_tags_keep_relation_fingerprint_byte_identical() {
        // `tags` is skip-serialized when empty, so attaching an empty Vec to a
        // row must not change the source-relation fingerprint; a non-empty value
        // does change it (it changes which samples a `by_tag` view selects).
        let base: crate::relation::SampleRelationTable = serde_json::from_str(include_str!(
            "../../../examples/fixtures/oof_campaign/sample_relations_grouped_augmented.json"
        ))
        .unwrap();

        let mut explicit_empty = base.clone();
        explicit_empty.rows[0].tags = Vec::new();
        assert_eq!(
            sample_relation_fingerprint(&base).unwrap(),
            sample_relation_fingerprint(&explicit_empty).unwrap()
        );

        let mut with_tags = base.clone();
        with_tags.rows[0].tags = vec!["clean".to_string()];
        assert_ne!(
            sample_relation_fingerprint(&base).unwrap(),
            sample_relation_fingerprint(&with_tags).unwrap()
        );
    }

    #[test]
    fn fold_set_fingerprint_is_independent_of_ordering() {
        let mut left = FoldSet {
            id: "cv.partition".to_string(),
            sample_ids: vec![
                SampleId::new("s3").unwrap(),
                SampleId::new("s2").unwrap(),
                SampleId::new("s1").unwrap(),
            ],
            folds: vec![
                FoldAssignment {
                    fold_id: "fold1".to_string(),
                    train_sample_ids: vec![
                        SampleId::new("s2").unwrap(),
                        SampleId::new("s1").unwrap(),
                    ],
                    validation_sample_ids: vec![SampleId::new("s3").unwrap()],
                    metadata: BTreeMap::new(),
                },
                FoldAssignment {
                    fold_id: "fold0".to_string(),
                    train_sample_ids: vec![SampleId::new("s3").unwrap()],
                    validation_sample_ids: vec![
                        SampleId::new("s2").unwrap(),
                        SampleId::new("s1").unwrap(),
                    ],
                    metadata: BTreeMap::new(),
                },
            ],
            sample_groups: BTreeMap::new(),
        };
        let mut right = left.clone();
        right.sample_ids.reverse();
        right.folds.reverse();
        for fold in &mut right.folds {
            fold.train_sample_ids.reverse();
            fold.validation_sample_ids.reverse();
        }

        assert_eq!(
            fold_set_fingerprint(&left).unwrap(),
            fold_set_fingerprint(&right).unwrap()
        );

        left.id = "cv.partition.changed".to_string();
        assert_ne!(
            fold_set_fingerprint(&left).unwrap(),
            fold_set_fingerprint(&right).unwrap()
        );
    }

    fn coordinate_schema(coordinate: Option<CoordinateSpec>) -> DatasetSchema {
        let mut repr = representation("tabular");
        // The feature axis (size 1) carries the coordinate.
        repr.axes[1].coordinate = coordinate;
        let mut descriptor = source("a");
        descriptor.native_representation = repr;
        DatasetSchema {
            dataset_id: "coords".to_string(),
            sample_ids: vec![SampleId::new("s1").unwrap()],
            sources: vec![descriptor],
            targets: BTreeMap::new(),
            metadata: BTreeMap::new(),
            metadata_schema: None,
            groups: Vec::new(),
            folds: Vec::new(),
        }
    }

    #[test]
    fn schema_fingerprint_reflects_axis_coordinates() {
        let explicit = CoordinateSpec {
            dtype: CoordinateDType::Categorical,
            ordered: false,
            values: CoordinateValues::Explicit {
                values: vec![serde_json::Value::from("R")],
            },
        };
        let grid = CoordinateSpec {
            dtype: CoordinateDType::Numeric,
            ordered: true,
            values: CoordinateValues::RegularGrid {
                start: 400.0,
                step: 2.0,
            },
        };

        let bare = schema_fingerprint(&coordinate_schema(None)).unwrap();
        let with_explicit = schema_fingerprint(&coordinate_schema(Some(explicit.clone()))).unwrap();
        let with_grid = schema_fingerprint(&coordinate_schema(Some(grid))).unwrap();

        // Stable for a fixed coordinate spec.
        assert_eq!(
            with_explicit,
            schema_fingerprint(&coordinate_schema(Some(explicit))).unwrap()
        );
        // Coordinates participate in the fingerprint and the two shapes differ.
        assert_ne!(bare, with_explicit);
        assert_ne!(bare, with_grid);
        assert_ne!(with_explicit, with_grid);
    }

    #[test]
    fn shared_fold_set_fixture_fingerprint_is_locked() {
        let fixture = include_str!("../../../examples/fixtures/shared/fold_set_cv_partition.json");
        let fold_set = serde_json::from_str::<FoldSet>(fixture).unwrap();

        assert_eq!(
            fold_set_fingerprint(&fold_set).unwrap(),
            SHARED_FOLD_SET_FINGERPRINT
        );
    }
}
