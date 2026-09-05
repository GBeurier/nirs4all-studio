//! Apache Arrow IPC feature buffer reader for dag-ml-data.
//!
//! This crate is a workspace member so the workspace `cargo build` /
//! `cargo test` commands always compile it, but the C ABI wiring in
//! `dag-ml-data-capi` is gated behind the `arrow-ipc` feature, so the
//! Arrow dependency is **opt-in at the cdylib boundary** for hosts that
//! ship `libdag_ml_data_capi.so`. Workspace consumers running the gate
//! still pay the compile-time cost.
//!
//! The reader maps each Arrow `RecordBatch` whose schema metadata carries
//! `dag_ml_data.feature_set_id` to a `NumericFeatureMatrixF64Columnar`,
//! then resolves the whole stream to a `NumericFeatureBufferStore`. The
//! mapping is total:
//!
//! - `Float64Array` column → `NumericFeatureMatrixF64Columnar.columns[i]`
//! - Arrow validity bitmap → per-column `validity_masks[i]`
//! - `observation_id` `Utf8Array` column → `observation_ids`
//! - feature column names → `feature_names`
//!
//! Mandatory schema metadata keys:
//! - `dag_ml_data.feature_set_id` — the feature-set id of the buffer
//! - `dag_ml_data.representation_id` — the representation id of the buffer

use std::fs::File;
use std::io::Read;
use std::path::Path;

use arrow_array::{Array, Float64Array, RecordBatch, StringArray};
use arrow_ipc::reader::{FileReader, StreamReader};

use dag_ml_data_core::buffer::{NumericFeatureBufferStore, NumericFeatureMatrixF64Columnar};
use dag_ml_data_core::error::{DataError, Result};
use dag_ml_data_core::ids::{ObservationId, RepresentationId};

/// Arrow schema-metadata key carrying the source feature-set id.
pub const SCHEMA_METADATA_FEATURE_SET_ID: &str = "dag_ml_data.feature_set_id";
/// Arrow schema-metadata key carrying the representation id.
pub const SCHEMA_METADATA_REPRESENTATION_ID: &str = "dag_ml_data.representation_id";
/// Column name holding per-row observation ids in each record batch.
pub const OBSERVATION_ID_COLUMN: &str = "observation_id";

/// Parse an Arrow IPC stream from any `Read` source into a
/// `NumericFeatureBufferStore`. Each top-level record batch becomes one
/// buffer; the batches' schemas must declare both
/// `dag_ml_data.feature_set_id` and `dag_ml_data.representation_id` in
/// their `metadata` map and expose an `observation_id` UTF-8 column.
pub fn read_buffers_from_ipc_stream<R: Read>(reader: R) -> Result<NumericFeatureBufferStore> {
    let stream = StreamReader::try_new(reader, None).map_err(arrow_error)?;
    let mut matrices = Vec::new();
    for batch in stream {
        let batch = batch.map_err(arrow_error)?;
        matrices.push(record_batch_to_matrix(&batch)?);
    }
    NumericFeatureBufferStore::from_f64_column_matrices(matrices)
}

/// Parse an Arrow IPC file (with footer + magic) from any `Read + Seek`
/// source into a `NumericFeatureBufferStore`. Same per-batch contract as
/// `read_buffers_from_ipc_stream`.
pub fn read_buffers_from_ipc_file<R: Read + std::io::Seek>(
    reader: R,
) -> Result<NumericFeatureBufferStore> {
    let file = FileReader::try_new(reader, None).map_err(arrow_error)?;
    let mut matrices = Vec::new();
    for batch in file {
        let batch = batch.map_err(arrow_error)?;
        matrices.push(record_batch_to_matrix(&batch)?);
    }
    NumericFeatureBufferStore::from_f64_column_matrices(matrices)
}

/// Convenience: read an Arrow IPC file from disk.
pub fn read_buffers_from_ipc_path(path: &Path) -> Result<NumericFeatureBufferStore> {
    let file = File::open(path).map_err(|error| {
        DataError::Validation(format!(
            "failed to open arrow IPC file at `{}`: {error}",
            path.display()
        ))
    })?;
    read_buffers_from_ipc_file(file)
}

fn record_batch_to_matrix(batch: &RecordBatch) -> Result<NumericFeatureMatrixF64Columnar> {
    let schema = batch.schema();
    let metadata = schema.metadata();
    let feature_set_id = metadata
        .get(SCHEMA_METADATA_FEATURE_SET_ID)
        .ok_or_else(|| {
            DataError::Validation(format!(
                "arrow IPC batch is missing required schema metadata `{SCHEMA_METADATA_FEATURE_SET_ID}`"
            ))
        })?
        .clone();
    let representation_raw = metadata.get(SCHEMA_METADATA_REPRESENTATION_ID).ok_or_else(|| {
        DataError::Validation(format!(
            "arrow IPC batch `{feature_set_id}` is missing required schema metadata `{SCHEMA_METADATA_REPRESENTATION_ID}`"
        ))
    })?;
    let representation_id = RepresentationId::new(representation_raw)?;

    let observation_field_index = schema.index_of(OBSERVATION_ID_COLUMN).map_err(|_| {
        DataError::Validation(format!(
            "arrow IPC batch `{feature_set_id}` is missing the required `{OBSERVATION_ID_COLUMN}` column"
        ))
    })?;
    let observation_array = batch
        .column(observation_field_index)
        .as_any()
        .downcast_ref::<StringArray>()
        .ok_or_else(|| {
            DataError::Validation(format!(
                "arrow IPC batch `{feature_set_id}` `{OBSERVATION_ID_COLUMN}` column must be Utf8"
            ))
        })?;
    if observation_array.null_count() != 0 {
        return Err(DataError::Validation(format!(
            "arrow IPC batch `{feature_set_id}` `{OBSERVATION_ID_COLUMN}` column contains nulls"
        )));
    }
    let mut observation_ids = Vec::with_capacity(observation_array.len());
    for raw in observation_array.iter() {
        let value = raw.ok_or_else(|| {
            DataError::Validation(format!(
                "arrow IPC batch `{feature_set_id}` `{OBSERVATION_ID_COLUMN}` column contains nulls"
            ))
        })?;
        observation_ids.push(ObservationId::new(value)?);
    }

    let mut feature_names = Vec::new();
    let mut columns = Vec::new();
    let mut masks = Vec::new();
    let mut any_null = false;
    for (idx, field) in schema.fields().iter().enumerate() {
        if idx == observation_field_index {
            continue;
        }
        let column = batch.column(idx);
        let float_column = column
            .as_any()
            .downcast_ref::<Float64Array>()
            .ok_or_else(|| {
                DataError::Validation(format!(
                    "arrow IPC batch `{feature_set_id}` column `{}` must be Float64",
                    field.name()
                ))
            })?;
        let row_count = float_column.len();
        let mut values = Vec::with_capacity(row_count);
        let mut mask = Vec::with_capacity(row_count);
        for row in 0..row_count {
            if float_column.is_null(row) {
                values.push(0.0);
                mask.push(false);
                any_null = true;
            } else {
                values.push(float_column.value(row));
                mask.push(true);
            }
        }
        feature_names.push(field.name().clone());
        columns.push(values);
        masks.push(mask);
    }
    if feature_names.is_empty() {
        return Err(DataError::Validation(format!(
            "arrow IPC batch `{feature_set_id}` has no feature columns besides `{OBSERVATION_ID_COLUMN}`"
        )));
    }
    Ok(NumericFeatureMatrixF64Columnar {
        feature_set_id,
        representation_id,
        feature_names,
        observation_ids,
        columns,
        validity_masks: any_null.then_some(masks),
    })
}

fn arrow_error(error: impl std::fmt::Display) -> DataError {
    DataError::Validation(format!("arrow IPC reader error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use arrow_array::{Float64Array, StringArray};
    use arrow_ipc::writer::StreamWriter;
    use arrow_schema::{DataType, Field, Schema};
    use std::collections::HashMap;
    use std::sync::Arc;

    fn build_batch(
        feature_set_id: &str,
        observations: &[&str],
        f0_values: &[Option<f64>],
        f1_values: &[Option<f64>],
    ) -> RecordBatch {
        let mut metadata = HashMap::new();
        metadata.insert(
            SCHEMA_METADATA_FEATURE_SET_ID.to_string(),
            feature_set_id.to_string(),
        );
        metadata.insert(
            SCHEMA_METADATA_REPRESENTATION_ID.to_string(),
            "tabular_numeric".to_string(),
        );
        let schema = Schema::new_with_metadata(
            vec![
                Field::new(OBSERVATION_ID_COLUMN, DataType::Utf8, false),
                Field::new("f0", DataType::Float64, true),
                Field::new("f1", DataType::Float64, true),
            ],
            metadata,
        );
        let observation_array = StringArray::from(observations.to_vec());
        let f0_array = Float64Array::from(f0_values.to_vec());
        let f1_array = Float64Array::from(f1_values.to_vec());
        RecordBatch::try_new(
            Arc::new(schema),
            vec![
                Arc::new(observation_array),
                Arc::new(f0_array),
                Arc::new(f1_array),
            ],
        )
        .unwrap()
    }

    fn serialize_stream(batches: &[RecordBatch]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = StreamWriter::try_new(&mut buffer, &batches[0].schema()).unwrap();
            for batch in batches {
                writer.write(batch).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    #[test]
    fn round_trip_columnar_buffer_through_ipc_stream() {
        let batch = build_batch(
            "x",
            &["obs.A", "obs.B", "obs.C"],
            &[Some(1.0), Some(2.0), Some(3.0)],
            &[Some(10.0), Some(20.0), Some(30.0)],
        );
        let stream_bytes = serialize_stream(&[batch]);
        let store = read_buffers_from_ipc_stream(stream_bytes.as_slice()).unwrap();
        assert_eq!(store.len(), 1);
        let manifest = &store.manifests().unwrap()[0];
        assert_eq!(manifest.feature_set_id, "x");
        assert_eq!(manifest.row_count, 3);
        assert_eq!(manifest.feature_count, 2);
    }

    #[test]
    fn null_columns_become_optional_values() {
        let batch = build_batch(
            "x",
            &["obs.A", "obs.B"],
            &[Some(1.0), None],
            &[None, Some(20.0)],
        );
        let stream_bytes = serialize_stream(&[batch]);
        let store = read_buffers_from_ipc_stream(stream_bytes.as_slice()).unwrap();
        // Round-trip through the column-major typed input path preserves the
        // fingerprint regardless of where nulls sit.
        let manifest = &store.manifests().unwrap()[0];
        assert_eq!(manifest.value_count, 4);
    }

    #[test]
    fn rejects_batch_without_required_metadata() {
        let schema = Schema::new(vec![
            Field::new(OBSERVATION_ID_COLUMN, DataType::Utf8, false),
            Field::new("f0", DataType::Float64, false),
        ]);
        let batch = RecordBatch::try_new(
            Arc::new(schema),
            vec![
                Arc::new(StringArray::from(vec!["obs.A"])),
                Arc::new(Float64Array::from(vec![1.0])),
            ],
        )
        .unwrap();
        let stream_bytes = serialize_stream(&[batch]);
        let error = read_buffers_from_ipc_stream(stream_bytes.as_slice()).unwrap_err();
        assert!(format!("{error}").contains(SCHEMA_METADATA_FEATURE_SET_ID));
    }

    #[test]
    fn rejects_batch_without_observation_id_column() {
        let mut metadata = HashMap::new();
        metadata.insert(SCHEMA_METADATA_FEATURE_SET_ID.to_string(), "x".to_string());
        metadata.insert(
            SCHEMA_METADATA_REPRESENTATION_ID.to_string(),
            "tabular_numeric".to_string(),
        );
        let schema =
            Schema::new_with_metadata(vec![Field::new("f0", DataType::Float64, false)], metadata);
        let batch = RecordBatch::try_new(
            Arc::new(schema),
            vec![Arc::new(Float64Array::from(vec![1.0, 2.0]))],
        )
        .unwrap();
        let stream_bytes = serialize_stream(&[batch]);
        let error = read_buffers_from_ipc_stream(stream_bytes.as_slice()).unwrap_err();
        assert!(format!("{error}").contains(OBSERVATION_ID_COLUMN));
    }

    #[test]
    fn rejects_batch_with_non_float64_feature_column() {
        let mut metadata = HashMap::new();
        metadata.insert(SCHEMA_METADATA_FEATURE_SET_ID.to_string(), "x".to_string());
        metadata.insert(
            SCHEMA_METADATA_REPRESENTATION_ID.to_string(),
            "tabular_numeric".to_string(),
        );
        let schema = Schema::new_with_metadata(
            vec![
                Field::new(OBSERVATION_ID_COLUMN, DataType::Utf8, false),
                Field::new("f0", DataType::Int32, false),
            ],
            metadata,
        );
        let batch = RecordBatch::try_new(
            Arc::new(schema),
            vec![
                Arc::new(StringArray::from(vec!["obs.A"])),
                Arc::new(arrow_array::Int32Array::from(vec![1])),
            ],
        )
        .unwrap();
        let stream_bytes = serialize_stream(&[batch]);
        let error = read_buffers_from_ipc_stream(stream_bytes.as_slice()).unwrap_err();
        assert!(format!("{error}").contains("must be Float64"));
    }
}
