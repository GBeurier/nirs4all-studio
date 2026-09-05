//! Deterministic binary persistence for `NumericFeatureBufferStore`.
//!
//! The format `.n4d` (DAG-ML Data file) is a versioned little-endian byte
//! stream sealed with a SHA-256 trailer so a host can persist a provider's
//! feature buffers between processes and detect tampering on reload. The
//! serializer iterates the store in BTreeMap order so byte-identical stores
//! produce byte-identical files; deserialization rebuilds the store using
//! the same column-major typed input path as the in-memory ABI, so a
//! round-trip preserves every buffer fingerprint.

use std::fs;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::buffer::{NumericFeatureBufferStore, NumericFeatureMatrixF64Columnar};
use crate::error::{DataError, Result};
use crate::ids::{ObservationId, RepresentationId};

const MAGIC: &[u8; 4] = b"N4DF";
pub const NUMERIC_FEATURE_BUFFER_FILE_FORMAT_VERSION: u32 = 1;
const TRAILER_LEN: usize = 32;

/// Serialize a store to its deterministic `.n4d` byte stream. The output
/// ends with a 32-byte SHA-256 of all preceding bytes so callers can
/// distinguish truncation from intentional empty stores and detect any
/// later tampering through [`deserialize_columnar_store`].
pub fn serialize_columnar_store(store: &NumericFeatureBufferStore) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(MAGIC);
    payload.extend_from_slice(&NUMERIC_FEATURE_BUFFER_FILE_FORMAT_VERSION.to_le_bytes());
    let buffer_count = u32::try_from(store.len()).expect("store buffer count must fit in u32");
    payload.extend_from_slice(&buffer_count.to_le_bytes());
    for (feature_set_id, buffer) in store.iter() {
        debug_assert_eq!(feature_set_id, &buffer.feature_set_id);
        let matrix = buffer.to_f64_column_matrix();
        write_buffer(&mut payload, &matrix);
    }
    let digest = Sha256::digest(&payload);
    payload.extend_from_slice(&digest);
    payload
}

/// Parse a `.n4d` byte stream back into a store. Rejects unknown magic,
/// unsupported versions, truncated streams, and any tampering of the
/// payload caught by SHA-256 mismatch.
pub fn deserialize_columnar_store(bytes: &[u8]) -> Result<NumericFeatureBufferStore> {
    if bytes.len() < 12 + TRAILER_LEN {
        return Err(DataError::Validation(format!(
            "feature buffer file is truncated: got {} bytes, need at least {}",
            bytes.len(),
            12 + TRAILER_LEN
        )));
    }
    if &bytes[0..4] != MAGIC {
        return Err(DataError::Validation(
            "feature buffer file does not start with N4DF magic".to_string(),
        ));
    }
    let payload_end = bytes.len() - TRAILER_LEN;
    let computed = Sha256::digest(&bytes[..payload_end]);
    if computed.as_slice() != &bytes[payload_end..] {
        return Err(DataError::Validation(
            "feature buffer file SHA-256 trailer does not match payload".to_string(),
        ));
    }
    let version = read_u32(bytes, 4)?;
    if version != NUMERIC_FEATURE_BUFFER_FILE_FORMAT_VERSION {
        return Err(DataError::Validation(format!(
            "feature buffer file uses unsupported format version {version}, expected {}",
            NUMERIC_FEATURE_BUFFER_FILE_FORMAT_VERSION
        )));
    }
    let buffer_count = read_u32(bytes, 8)? as usize;
    let mut cursor = 12usize;
    // Even an empty buffer needs two string lengths, two dimensions and a flag.
    ensure_count_fits(payload_end, cursor, buffer_count, 17, "buffer count")?;
    let mut matrices = reserved_vec(buffer_count)?;
    for _ in 0..buffer_count {
        let (matrix, next_cursor) = read_buffer(bytes, cursor, payload_end)?;
        matrices.push(matrix);
        cursor = next_cursor;
    }
    if cursor != payload_end {
        return Err(DataError::Validation(format!(
            "feature buffer file has {} trailing bytes after {} declared buffer(s)",
            payload_end - cursor,
            buffer_count
        )));
    }
    NumericFeatureBufferStore::from_f64_column_matrices(matrices)
}

/// Write a store to `path`. Replaces any existing file at the destination.
pub fn write_store_to_path(store: &NumericFeatureBufferStore, path: &Path) -> Result<()> {
    let bytes = serialize_columnar_store(store);
    fs::write(path, bytes).map_err(|error| {
        DataError::Validation(format!(
            "failed to write feature buffer store to `{}`: {error}",
            path.display()
        ))
    })
}

/// Read a store back from `path`. Errors propagate the validation failure
/// from [`deserialize_columnar_store`] alongside the path for diagnostics.
pub fn read_store_from_path(path: &Path) -> Result<NumericFeatureBufferStore> {
    let bytes = fs::read(path).map_err(|error| {
        DataError::Validation(format!(
            "failed to read feature buffer store from `{}`: {error}",
            path.display()
        ))
    })?;
    deserialize_columnar_store(&bytes)
}

fn write_buffer(payload: &mut Vec<u8>, matrix: &NumericFeatureMatrixF64Columnar) {
    write_string(payload, &matrix.feature_set_id);
    write_string(payload, matrix.representation_id.as_str());
    let row_count = u32::try_from(matrix.observation_ids.len()).expect("row count must fit in u32");
    let feature_count =
        u32::try_from(matrix.feature_names.len()).expect("feature count must fit in u32");
    payload.extend_from_slice(&row_count.to_le_bytes());
    payload.extend_from_slice(&feature_count.to_le_bytes());
    let has_validity = u8::from(matrix.validity_masks.is_some());
    payload.push(has_validity);
    for name in &matrix.feature_names {
        write_string(payload, name);
    }
    for observation_id in &matrix.observation_ids {
        write_string(payload, observation_id.as_str());
    }
    for column in &matrix.columns {
        debug_assert_eq!(column.len() as u32, row_count);
        for value in column {
            payload.extend_from_slice(&value.to_le_bytes());
        }
    }
    if let Some(masks) = &matrix.validity_masks {
        debug_assert_eq!(masks.len() as u32, feature_count);
        for mask in masks {
            debug_assert_eq!(mask.len() as u32, row_count);
            for present in mask {
                payload.push(u8::from(*present));
            }
        }
    }
}

fn read_buffer(
    bytes: &[u8],
    cursor: usize,
    payload_end: usize,
) -> Result<(NumericFeatureMatrixF64Columnar, usize)> {
    let mut cursor = cursor;
    let feature_set_id = read_string(bytes, &mut cursor, payload_end)?;
    let representation_raw = read_string(bytes, &mut cursor, payload_end)?;
    let representation_id = RepresentationId::new(&representation_raw)?;
    let row_count = read_u32_advance(bytes, &mut cursor, payload_end)? as usize;
    let feature_count = read_u32_advance(bytes, &mut cursor, payload_end)? as usize;
    let has_validity = read_u8_advance(bytes, &mut cursor, payload_end)?;
    if has_validity > 1 {
        return Err(DataError::Validation(format!(
            "feature buffer file `{feature_set_id}` has invalid has_validity byte {has_validity}"
        )));
    }
    // Check all length-derived storage against the actual payload before any
    // reservation. A valid checksum authenticates bytes, not their dimensions.
    ensure_count_fits(payload_end, cursor, feature_count, 4, "feature count")?;
    ensure_count_fits(payload_end, cursor, row_count, 4, "row count")?;
    let cells = row_count.checked_mul(feature_count).ok_or_else(|| {
        DataError::Validation("feature buffer file matrix dimensions overflow usize".into())
    })?;
    ensure_count_fits(
        payload_end,
        cursor,
        cells,
        8 + usize::from(has_validity),
        "matrix cells",
    )?;
    let mut feature_names = reserved_vec(feature_count)?;
    for _ in 0..feature_count {
        feature_names.push(read_string(bytes, &mut cursor, payload_end)?);
    }
    let mut observation_ids = reserved_vec(row_count)?;
    for _ in 0..row_count {
        let raw = read_string(bytes, &mut cursor, payload_end)?;
        observation_ids.push(ObservationId::new(&raw)?);
    }
    let mut columns = reserved_vec(feature_count)?;
    for _ in 0..feature_count {
        let needed = row_count.checked_mul(8).ok_or_else(|| {
            DataError::Validation(format!(
                "feature buffer file `{feature_set_id}` column size overflows usize"
            ))
        })?;
        ensure_remaining(payload_end, cursor, needed, &feature_set_id)?;
        let mut column = reserved_vec(row_count)?;
        for row in 0..row_count {
            let offset = cursor + row * 8;
            let value = f64::from_le_bytes(
                bytes[offset..offset + 8]
                    .try_into()
                    .expect("8 bytes for f64 LE"),
            );
            column.push(value);
        }
        cursor += needed;
        columns.push(column);
    }
    let validity_masks = if has_validity == 1 {
        let mut masks = reserved_vec(feature_count)?;
        for _ in 0..feature_count {
            ensure_remaining(payload_end, cursor, row_count, &feature_set_id)?;
            let mut mask = reserved_vec(row_count)?;
            for offset in 0..row_count {
                let byte = bytes[cursor + offset];
                if byte > 1 {
                    return Err(DataError::Validation(format!(
                        "feature buffer file `{feature_set_id}` validity byte {byte} is not 0 or 1"
                    )));
                }
                mask.push(byte == 1);
            }
            cursor += row_count;
            masks.push(mask);
        }
        Some(masks)
    } else {
        None
    };
    Ok((
        NumericFeatureMatrixF64Columnar {
            feature_set_id,
            representation_id,
            feature_names,
            observation_ids,
            columns,
            validity_masks,
        },
        cursor,
    ))
}

fn write_string(payload: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    let len = u32::try_from(bytes.len()).expect("string length must fit in u32");
    payload.extend_from_slice(&len.to_le_bytes());
    payload.extend_from_slice(bytes);
}

fn read_string(bytes: &[u8], cursor: &mut usize, payload_end: usize) -> Result<String> {
    let len = read_u32_advance(bytes, cursor, payload_end)? as usize;
    ensure_remaining(payload_end, *cursor, len, "feature buffer file string")?;
    let raw = &bytes[*cursor..*cursor + len];
    let value = std::str::from_utf8(raw)
        .map_err(|error| DataError::Validation(format!("invalid utf-8 string: {error}")))?
        .to_string();
    *cursor += len;
    Ok(value)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32> {
    if offset + 4 > bytes.len() {
        return Err(DataError::Validation(format!(
            "feature buffer file truncated reading u32 at offset {offset}"
        )));
    }
    Ok(u32::from_le_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("4 bytes for u32 LE"),
    ))
}

fn read_u32_advance(bytes: &[u8], cursor: &mut usize, payload_end: usize) -> Result<u32> {
    ensure_remaining(payload_end, *cursor, 4, "feature buffer file u32")?;
    let value = u32::from_le_bytes(
        bytes[*cursor..*cursor + 4]
            .try_into()
            .expect("4 bytes for u32 LE"),
    );
    *cursor += 4;
    Ok(value)
}

fn read_u8_advance(bytes: &[u8], cursor: &mut usize, payload_end: usize) -> Result<u8> {
    ensure_remaining(payload_end, *cursor, 1, "feature buffer file u8")?;
    let value = bytes[*cursor];
    *cursor += 1;
    Ok(value)
}

fn ensure_remaining(payload_end: usize, cursor: usize, needed: usize, label: &str) -> Result<()> {
    if cursor > payload_end || needed > payload_end - cursor {
        return Err(DataError::Validation(format!(
            "{label} truncated at cursor {cursor}: needed {needed} bytes, payload ends at {payload_end}"
        )));
    }
    Ok(())
}

fn ensure_count_fits(
    payload_end: usize,
    cursor: usize,
    count: usize,
    minimum_bytes: usize,
    label: &str,
) -> Result<()> {
    let needed = count.checked_mul(minimum_bytes).ok_or_else(|| {
        DataError::Validation(format!("feature buffer file {label} size overflows usize"))
    })?;
    ensure_remaining(payload_end, cursor, needed, label)
}

fn reserved_vec<T>(count: usize) -> Result<Vec<T>> {
    let mut values = Vec::new();
    values.try_reserve_exact(count).map_err(|error| {
        DataError::Validation(format!("feature buffer file allocation failed: {error}"))
    })?;
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::buffer::NumericFeatureMatrixF64Columnar;

    fn matrix(feature_set_id: &str) -> NumericFeatureMatrixF64Columnar {
        NumericFeatureMatrixF64Columnar {
            feature_set_id: feature_set_id.to_string(),
            representation_id: RepresentationId::new("tabular_numeric").unwrap(),
            feature_names: vec!["f0".to_string(), "f1".to_string()],
            observation_ids: vec![
                ObservationId::new("obs.A").unwrap(),
                ObservationId::new("obs.B").unwrap(),
                ObservationId::new("obs.C").unwrap(),
            ],
            columns: vec![vec![1.0, 2.0, 3.0], vec![10.0, 20.0, 30.0]],
            validity_masks: Some(vec![vec![true, true, false], vec![true, true, true]]),
        }
    }

    #[test]
    fn round_trip_preserves_buffer_fingerprints_and_bytes_are_deterministic() {
        let store_one =
            NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("x"), matrix("y")])
                .unwrap();
        let store_two =
            NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("y"), matrix("x")])
                .unwrap();
        let bytes_one = serialize_columnar_store(&store_one);
        let bytes_two = serialize_columnar_store(&store_two);
        assert_eq!(bytes_one, bytes_two, "byte order must be deterministic");

        let restored = deserialize_columnar_store(&bytes_one).unwrap();
        let original_manifests = store_one.manifests().unwrap();
        let restored_manifests = restored.manifests().unwrap();
        assert_eq!(restored_manifests.len(), original_manifests.len());
        for (lhs, rhs) in original_manifests.iter().zip(restored_manifests.iter()) {
            assert_eq!(lhs.feature_set_id, rhs.feature_set_id);
            assert_eq!(lhs.row_count, rhs.row_count);
            assert_eq!(lhs.feature_count, rhs.feature_count);
            assert_eq!(lhs.buffer_fingerprint, rhs.buffer_fingerprint);
        }
    }

    #[test]
    fn buffers_without_validity_round_trip_correctly() {
        let mut without_validity = matrix("z");
        without_validity.validity_masks = None;
        let store =
            NumericFeatureBufferStore::from_f64_column_matrices(vec![without_validity.clone()])
                .unwrap();
        let bytes = serialize_columnar_store(&store);
        let restored = deserialize_columnar_store(&bytes).unwrap();
        assert_eq!(
            restored.manifests().unwrap()[0].buffer_fingerprint,
            store.manifests().unwrap()[0].buffer_fingerprint
        );
    }

    #[test]
    fn rejects_corrupted_payload() {
        let store = NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("x")]).unwrap();
        let mut bytes = serialize_columnar_store(&store);

        // Flip a payload byte (not the trailer) to invalidate the SHA-256.
        bytes[15] ^= 0xFF;
        let error = deserialize_columnar_store(&bytes).unwrap_err();
        assert!(format!("{error}").contains("SHA-256 trailer does not match payload"));
    }

    #[test]
    fn rejects_unknown_magic_and_version() {
        let store = NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("x")]).unwrap();
        let mut bytes = serialize_columnar_store(&store);
        bytes[0..4].copy_from_slice(b"WRNG");
        let error = deserialize_columnar_store(&bytes).unwrap_err();
        assert!(format!("{error}").contains("N4DF magic"));

        let mut bytes = serialize_columnar_store(&store);
        bytes[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        // Re-seal the payload so the SHA trailer check passes for this case.
        let payload_end = bytes.len() - TRAILER_LEN;
        let digest = Sha256::digest(&bytes[..payload_end]);
        bytes[payload_end..].copy_from_slice(&digest);
        let error = deserialize_columnar_store(&bytes).unwrap_err();
        assert!(format!("{error}").contains("unsupported format version"));
    }

    #[test]
    fn rejects_truncated_file() {
        let store = NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("x")]).unwrap();
        let bytes = serialize_columnar_store(&store);
        let truncated = &bytes[..bytes.len() - 1];
        let error = deserialize_columnar_store(truncated).unwrap_err();
        let message = format!("{error}");
        assert!(
            message.contains("truncated") || message.contains("trailer"),
            "unexpected truncation error: {message}"
        );
    }

    #[test]
    fn empty_store_round_trips_at_minimum_size_boundary() {
        let store = NumericFeatureBufferStore::default();
        let bytes = serialize_columnar_store(&store);
        // 4 magic + 4 version + 4 count + 32 trailer = 44 bytes, the minimum.
        assert_eq!(bytes.len(), 12 + TRAILER_LEN);
        let restored = deserialize_columnar_store(&bytes).unwrap();
        assert!(restored.is_empty());
    }

    #[test]
    fn rejects_counts_larger_than_payload_before_reserving() {
        fn seal(mut payload: Vec<u8>) -> Vec<u8> {
            let digest = Sha256::digest(&payload);
            payload.extend_from_slice(&digest);
            payload
        }
        let mut header = b"N4DF".to_vec();
        header.extend_from_slice(&1u32.to_le_bytes());
        header.extend_from_slice(&u32::MAX.to_le_bytes());
        assert!(deserialize_columnar_store(&seal(header.clone())).is_err());
        header[8..12].copy_from_slice(&1u32.to_le_bytes());
        for (rows, features) in [(u32::MAX, 1u32), (1, u32::MAX), (u32::MAX, u32::MAX)] {
            let mut payload = header.clone();
            write_string(&mut payload, "x");
            write_string(&mut payload, "tabular_numeric");
            payload.extend_from_slice(&rows.to_le_bytes());
            payload.extend_from_slice(&features.to_le_bytes());
            payload.push(0);
            assert!(deserialize_columnar_store(&seal(payload)).is_err());
        }
        assert!(ensure_remaining(12, usize::MAX, 1, "test").is_err());
        assert!(ensure_remaining(12, 1, usize::MAX, "test").is_err());
    }

    #[test]
    fn read_write_path_round_trip() {
        let store =
            NumericFeatureBufferStore::from_f64_column_matrices(vec![matrix("alpha")]).unwrap();
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_buffer_file_store_roundtrip_{}.n4d",
            std::process::id()
        ));
        write_store_to_path(&store, &path).unwrap();
        let restored = read_store_from_path(&path).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(
            restored.manifests().unwrap()[0].buffer_fingerprint,
            store.manifests().unwrap()[0].buffer_fingerprint
        );
        let _ = std::fs::remove_file(&path);
    }
}
