use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{DataError, Result};

pub const FITTED_ADAPTER_REF_SCHEMA_VERSION: u32 = 1;
pub const FITTED_ADAPTER_REF_SCHEMA_ID: &str =
    "https://github.com/GBeurier/dag-ml-data/schemas/fitted_adapter_ref.v1.schema.json";
pub const FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FittedAdapterBackend {
    Joblib,
    Pickle,
    Json,
    Numpy,
    Onnx,
    Raw,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FittedAdapterRef {
    #[serde(default = "default_fitted_adapter_ref_schema_version")]
    pub schema_version: u32,
    pub adapter_id: String,
    pub adapter_version: String,
    pub params_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<FittedAdapterBackend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_fingerprint: Option<String>,
    // Matches `dag-ml` `ArtifactRef.size_bytes` wire shape: when `None` this
    // field serializes as `"size_bytes": null`, not omitted, so the two refs
    // round-trip identically over JSON.
    #[serde(default)]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_version: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

fn default_fitted_adapter_ref_schema_version() -> u32 {
    FITTED_ADAPTER_REF_SCHEMA_VERSION
}

fn default_fitted_adapter_manifest_schema_version() -> u32 {
    FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION
}

impl FittedAdapterRef {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != FITTED_ADAPTER_REF_SCHEMA_VERSION {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` uses unsupported schema_version {}, expected {}",
                self.adapter_id, self.schema_version, FITTED_ADAPTER_REF_SCHEMA_VERSION
            )));
        }
        if self.adapter_id.trim().is_empty() {
            return Err(DataError::Validation(
                "fitted adapter ref has empty adapter_id".to_string(),
            ));
        }
        if self.adapter_version.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` has empty adapter_version",
                self.adapter_id
            )));
        }
        validate_fingerprint(
            "fitted adapter params",
            &self.params_fingerprint,
            &self.adapter_id,
        )?;
        validate_optional_text("uri", &self.uri, &self.adapter_id)?;
        validate_optional_text("plugin", &self.plugin, &self.adapter_id)?;
        validate_optional_text("plugin_version", &self.plugin_version, &self.adapter_id)?;
        if self.plugin_version.is_some() && self.plugin.is_none() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` has plugin_version without plugin",
                self.adapter_id
            )));
        }
        if let Some(content_fingerprint) = &self.content_fingerprint {
            validate_fingerprint(
                "fitted adapter content",
                content_fingerprint,
                &self.adapter_id,
            )?;
        }
        if self.uri.is_some() && self.backend.is_none() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` has uri without backend",
                self.adapter_id
            )));
        }
        if self.uri.is_some() && self.content_fingerprint.is_none() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` has uri without content_fingerprint",
                self.adapter_id
            )));
        }
        for key in self.metadata.keys() {
            if key.trim().is_empty() {
                return Err(DataError::Validation(format!(
                    "fitted adapter `{}` metadata contains an empty key",
                    self.adapter_id
                )));
            }
        }
        Ok(())
    }

    /// Validate that the fitted adapter carries portable persistence metadata:
    /// a backend, a safe relative URI and a content fingerprint. Legacy refs
    /// that only carry inline state stay readable through [`Self::validate`]
    /// but are refused here so persisted manifests can be moved with their
    /// payloads.
    pub fn validate_portable(&self) -> Result<()> {
        self.validate()?;
        let Some(uri) = self.uri.as_deref() else {
            return Err(DataError::Validation(format!(
                "fitted adapter `{}` is not portable: requires backend, uri and content_fingerprint",
                self.adapter_id
            )));
        };
        validate_relative_uri(&self.adapter_id, uri)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FittedAdapterManifestEntry {
    pub adapter_id: String,
    pub fitted_adapter: FittedAdapterRef,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FittedAdapterManifest {
    #[serde(default = "default_fitted_adapter_manifest_schema_version")]
    pub schema_version: u32,
    pub entries: Vec<FittedAdapterManifestEntry>,
}

impl FittedAdapterManifest {
    pub fn new(entries: Vec<FittedAdapterManifestEntry>) -> Self {
        Self {
            schema_version: FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION,
            entries,
        }
    }

    pub fn validate(&self) -> Result<()> {
        self.validate_inner(false)
    }

    /// Validate the manifest and require every entry to carry portable
    /// persistence metadata. Use this when serializing manifests for replay
    /// across machines or repositories.
    pub fn validate_portable(&self) -> Result<()> {
        self.validate_inner(true)
    }

    /// Writes the manifest as pretty-printed UTF-8 JSON to `path`.
    /// `require_portable` toggles between [`Self::validate`] and
    /// [`Self::validate_portable`] before writing, so a manifest is never
    /// persisted in a state that would not load cleanly on the other side.
    pub fn write_to_path(&self, path: &Path, require_portable: bool) -> Result<()> {
        if require_portable {
            self.validate_portable()?;
        } else {
            self.validate()?;
        }
        let payload = serde_json::to_vec_pretty(self).map_err(|error| {
            DataError::Validation(format!(
                "failed to serialize fitted adapter manifest to JSON: {error}"
            ))
        })?;
        fs::write(path, payload).map_err(|error| {
            DataError::Validation(format!(
                "failed to write fitted adapter manifest to `{}`: {error}",
                path.display()
            ))
        })
    }

    /// Reads the manifest back from `path`. Applies the same `require_portable`
    /// gate as [`Self::write_to_path`] so loaded manifests are immediately
    /// safe to use.
    pub fn read_from_path(path: &Path, require_portable: bool) -> Result<Self> {
        let bytes = fs::read(path).map_err(|error| {
            DataError::Validation(format!(
                "failed to read fitted adapter manifest from `{}`: {error}",
                path.display()
            ))
        })?;
        let manifest: Self = serde_json::from_slice(&bytes).map_err(|error| {
            DataError::Validation(format!(
                "failed to parse fitted adapter manifest from `{}`: {error}",
                path.display()
            ))
        })?;
        if require_portable {
            manifest.validate_portable()?;
        } else {
            manifest.validate()?;
        }
        Ok(manifest)
    }

    fn validate_inner(&self, require_portable: bool) -> Result<()> {
        if self.schema_version != FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION {
            return Err(DataError::Validation(format!(
                "fitted adapter manifest uses unsupported schema_version {}, expected {}",
                self.schema_version, FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION
            )));
        }
        let mut seen = BTreeSet::new();
        for entry in &self.entries {
            if entry.adapter_id != entry.fitted_adapter.adapter_id {
                return Err(DataError::Validation(format!(
                    "fitted adapter manifest entry key `{}` does not match ref adapter_id `{}`",
                    entry.adapter_id, entry.fitted_adapter.adapter_id
                )));
            }
            if !seen.insert(&entry.adapter_id) {
                return Err(DataError::Validation(format!(
                    "fitted adapter manifest contains duplicate adapter_id `{}`",
                    entry.adapter_id
                )));
            }
            if require_portable {
                entry.fitted_adapter.validate_portable()?;
            } else {
                entry.fitted_adapter.validate()?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FittedAdapterMaterializationRequest {
    pub adapter_id: String,
    pub params_fingerprint: String,
}

impl FittedAdapterMaterializationRequest {
    pub fn validate(&self) -> Result<()> {
        if self.adapter_id.trim().is_empty() {
            return Err(DataError::Validation(
                "fitted adapter materialization request has empty adapter_id".to_string(),
            ));
        }
        validate_fingerprint(
            "fitted adapter materialization params",
            &self.params_fingerprint,
            &self.adapter_id,
        )?;
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FittedAdapterHandleRecord {
    pub handle: u64,
    pub fitted_adapter: FittedAdapterRef,
}

/// Runtime contract for materializing opaque host-owned fitted-adapter
/// handles from a previously registered `FittedAdapterRef`. The store
/// validates the request's `params_fingerprint` against the registered ref
/// and returns the opaque handle id. It never reads, writes or deserializes
/// adapter payloads — payload materialization happens host-side, behind the
/// opaque handle.
pub trait RuntimeFittedAdapterStore {
    fn materialize(&self, request: &FittedAdapterMaterializationRequest) -> Result<u64>;
}

#[derive(Debug, Default)]
pub struct InMemoryFittedAdapterStore {
    state: Mutex<FittedAdapterStoreState>,
}

#[derive(Debug, Default)]
struct FittedAdapterStoreState {
    next_handle: u64,
    records: BTreeMap<String, FittedAdapterHandleRecord>,
}

impl InMemoryFittedAdapterStore {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(FittedAdapterStoreState {
                next_handle: 1,
                records: BTreeMap::new(),
            }),
        }
    }

    /// Locks the store, propagating poison errors as a validation failure.
    /// Poisoning happens when another thread panicked while holding the lock;
    /// for an in-memory contract store the right policy is to surface the
    /// error rather than silently `recover` from it.
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, FittedAdapterStoreState>> {
        self.state.lock().map_err(|error| {
            DataError::Validation(format!("fitted adapter store mutex poisoned: {error}"))
        })
    }

    pub fn register(&self, fitted_adapter: FittedAdapterRef) -> Result<FittedAdapterHandleRecord> {
        fitted_adapter.validate()?;
        let mut state = self.lock()?;
        if state.records.contains_key(&fitted_adapter.adapter_id) {
            return Err(DataError::Validation(format!(
                "fitted adapter store already has handle for `{}`",
                fitted_adapter.adapter_id
            )));
        }
        let handle = state.next_handle;
        state.next_handle += 1;
        let record = FittedAdapterHandleRecord {
            handle,
            fitted_adapter,
        };
        state
            .records
            .insert(record.fitted_adapter.adapter_id.clone(), record.clone());
        Ok(record)
    }

    pub fn register_manifest(
        &self,
        manifest: &FittedAdapterManifest,
    ) -> Result<Vec<FittedAdapterHandleRecord>> {
        manifest.validate()?;
        manifest
            .entries
            .iter()
            .map(|entry| self.register(entry.fitted_adapter.clone()))
            .collect()
    }

    pub fn get(&self, adapter_id: &str) -> Option<FittedAdapterHandleRecord> {
        let state = self.lock().ok()?;
        state.records.get(adapter_id).cloned()
    }

    pub fn release(&self, adapter_id: &str) -> bool {
        match self.lock() {
            Ok(mut state) => state.records.remove(adapter_id).is_some(),
            Err(_) => false,
        }
    }

    pub fn len(&self) -> usize {
        self.lock().map(|state| state.records.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.lock()
            .map(|state| state.records.is_empty())
            .unwrap_or(true)
    }
}

impl RuntimeFittedAdapterStore for InMemoryFittedAdapterStore {
    fn materialize(&self, request: &FittedAdapterMaterializationRequest) -> Result<u64> {
        request.validate()?;
        let state = self.lock()?;
        let record = state.records.get(&request.adapter_id).ok_or_else(|| {
            DataError::Validation(format!(
                "fitted adapter store is missing adapter `{}`",
                request.adapter_id
            ))
        })?;
        if record.fitted_adapter.params_fingerprint != request.params_fingerprint {
            return Err(DataError::FingerprintMismatch {
                kind: "params",
                expected: record.fitted_adapter.params_fingerprint.clone(),
                actual: request.params_fingerprint.clone(),
            });
        }
        Ok(record.handle)
    }
}

fn validate_optional_text(label: &str, value: &Option<String>, adapter_id: &str) -> Result<()> {
    if let Some(text) = value {
        if text.trim().is_empty() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{adapter_id}` has empty {label}"
            )));
        }
        if text.chars().any(char::is_control) {
            return Err(DataError::Validation(format!(
                "fitted adapter `{adapter_id}` has control characters in {label}"
            )));
        }
    }
    Ok(())
}

fn validate_fingerprint(label: &str, value: &str, adapter_id: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DataError::Validation(format!(
            "fitted adapter `{adapter_id}` {label} fingerprint must be a 64-character hex digest"
        )));
    }
    Ok(())
}

/// Deterministic path safety for relative fitted-adapter URIs. Rejects empty
/// values, control characters, absolute paths (POSIX root, Windows root or
/// drive prefix), URI schemes such as `http://`, `s3://` or `file://` (any
/// colon in the leading path segment) and any `..` traversal component.
/// Parsing is platform-independent so portable manifests validate identically
/// everywhere; it adds no dependency. Kept byte-for-byte equivalent with
/// `dag-ml`'s `validate_relative_artifact_uri` in
/// `crates/dag-ml-core/src/runtime/prediction_store.rs` so portable refs accepted by one repo
/// are accepted by the other.
fn validate_relative_uri(adapter_id: &str, uri: &str) -> Result<()> {
    if uri.is_empty() {
        return Err(DataError::Validation(format!(
            "fitted adapter `{adapter_id}` has empty uri"
        )));
    }
    if uri.chars().any(char::is_control) {
        return Err(DataError::Validation(format!(
            "fitted adapter `{adapter_id}` uri has control characters"
        )));
    }
    if uri.starts_with('/') || uri.starts_with('\\') {
        return Err(DataError::Validation(format!(
            "fitted adapter `{adapter_id}` uri `{uri}` must be a relative path"
        )));
    }
    let mut prefix = uri.chars();
    if let (Some(drive), Some(':')) = (prefix.next(), prefix.next()) {
        if drive.is_ascii_alphabetic() {
            return Err(DataError::Validation(format!(
                "fitted adapter `{adapter_id}` uri `{uri}` must be a relative path"
            )));
        }
    }
    let first_segment = uri.split(['/', '\\']).next().unwrap_or(uri);
    if first_segment.contains(':') {
        return Err(DataError::Validation(format!(
            "fitted adapter `{adapter_id}` uri `{uri}` must not include a scheme or colon in its first path segment"
        )));
    }
    for segment in uri.split(['/', '\\']) {
        if segment == ".." {
            return Err(DataError::Validation(format!(
                "fitted adapter `{adapter_id}` uri `{uri}` must not contain `..` components"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fingerprint(byte: u8) -> String {
        format!("{byte:02x}").repeat(32)
    }

    fn portable_ref() -> FittedAdapterRef {
        FittedAdapterRef {
            schema_version: FITTED_ADAPTER_REF_SCHEMA_VERSION,
            adapter_id: "snv".to_string(),
            adapter_version: "1.0.0".to_string(),
            params_fingerprint: fingerprint(0x12),
            backend: Some(FittedAdapterBackend::Joblib),
            uri: Some("fitted/snv.joblib".to_string()),
            content_fingerprint: Some(fingerprint(0x34)),
            size_bytes: Some(2048),
            plugin: Some("sklearn".to_string()),
            plugin_version: Some("1.4.0".to_string()),
            metadata: BTreeMap::new(),
        }
    }

    #[test]
    fn portable_ref_validates() {
        let value = portable_ref();
        value.validate().unwrap();
        value.validate_portable().unwrap();
    }

    #[test]
    fn inline_ref_validates_but_is_not_portable() {
        let value = FittedAdapterRef {
            uri: None,
            backend: None,
            content_fingerprint: None,
            size_bytes: None,
            plugin: None,
            plugin_version: None,
            ..portable_ref()
        };
        value.validate().unwrap();
        let error = value.validate_portable().unwrap_err();
        assert!(format!("{error}").contains("is not portable"));
    }

    #[test]
    fn rejects_unsupported_schema_version() {
        let mut value = portable_ref();
        value.schema_version = FITTED_ADAPTER_REF_SCHEMA_VERSION + 1;
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("unsupported schema_version"));
    }

    #[test]
    fn rejects_uri_without_backend_or_fingerprint() {
        let mut value = portable_ref();
        value.backend = None;
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("has uri without backend"));

        let mut value = portable_ref();
        value.content_fingerprint = None;
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("has uri without content_fingerprint"));
    }

    #[test]
    fn rejects_plugin_version_without_plugin() {
        let mut value = portable_ref();
        value.plugin = None;
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("has plugin_version without plugin"));
    }

    /// Locks down the exact accept/reject behaviour of the portable URI
    /// rules so the byte-for-byte copy in dag-ml's
    /// `validate_relative_artifact_uri` can be cross-checked. Any change to
    /// either function must also update this fixture; the script-level check
    /// in `scripts/validate_contracts.py` reads both function bodies and
    /// asserts textual equivalence as a second line of defense.
    #[test]
    fn portable_uri_rules_are_locked_to_a_shared_fixture() {
        let accept = [
            "snv.joblib",
            "fitted/snv.joblib",
            "nested/dir.name/file-v1.bin",
            "alpha_beta/gamma.json",
            "a.b/c.d",
        ];
        let reject_absolute = ["/abs/path.joblib", "\\abs\\path.joblib"];
        let reject_drive = ["C:\\fitted\\snv.joblib", "Z:/path"];
        let reject_schemes = [
            "http://example.com/x.bin",
            "s3://bucket/x.bin",
            "file:///x.bin",
            "scheme:relative",
        ];
        let reject_traversal = [
            "../escape.bin",
            "fitted/../escape.bin",
            "ok/../../escape.bin",
        ];
        let reject_empty_or_control = ["", "ctrl/\u{0001}path", "\n/path"];

        for uri in accept {
            let value = FittedAdapterRef {
                uri: Some(uri.to_string()),
                ..portable_ref()
            };
            if let Err(error) = value.validate_portable() {
                panic!("expected `{uri}` to validate portable: {error}");
            }
        }
        for group in [
            &reject_absolute[..],
            &reject_drive[..],
            &reject_schemes[..],
            &reject_traversal[..],
            &reject_empty_or_control[..],
        ] {
            for uri in group {
                let value = FittedAdapterRef {
                    uri: Some(uri.to_string()),
                    ..portable_ref()
                };
                let error = value
                    .validate_portable()
                    .expect_err(&format!("expected `{uri}` to be rejected as non-portable"));
                let message = format!("{error}");
                assert!(
                    !message.is_empty(),
                    "rejection of `{uri}` must carry a non-empty error message"
                );
            }
        }
    }

    #[test]
    fn rejects_non_portable_uris() {
        for uri in [
            "/abs/path.joblib",
            "C:\\fitted\\snv.joblib",
            "http://example.com/fitted/snv.joblib",
            "s3://bucket/fitted/snv.joblib",
            "file:///fitted/snv.joblib",
            "../escape/snv.joblib",
            "fitted/../escape/snv.joblib",
        ] {
            let value = FittedAdapterRef {
                uri: Some(uri.to_string()),
                ..portable_ref()
            };
            let error = value.validate_portable().unwrap_err();
            assert!(
                format!("{error}").contains("must") || format!("{error}").contains("relative path"),
                "URI `{uri}` should be rejected, got: {error}"
            );
        }
    }

    #[test]
    fn rejects_uri_with_control_chars_or_empty() {
        let mut value = portable_ref();
        value.uri = Some("".to_string());
        let error = value.validate_portable().unwrap_err();
        assert!(format!("{error}").contains("empty uri"));

        let mut value = portable_ref();
        value.uri = Some("fitted/\u{0001}".to_string());
        let error = value.validate_portable().unwrap_err();
        assert!(format!("{error}").contains("control characters"));
    }

    #[test]
    fn rejects_whitespace_only_optional_text_fields() {
        for (label, value) in [
            (
                "uri",
                FittedAdapterRef {
                    uri: Some("   ".to_string()),
                    ..portable_ref()
                },
            ),
            (
                "plugin",
                FittedAdapterRef {
                    plugin: Some("\t".to_string()),
                    ..portable_ref()
                },
            ),
            (
                "plugin_version",
                FittedAdapterRef {
                    plugin_version: Some("   ".to_string()),
                    ..portable_ref()
                },
            ),
        ] {
            let error = value.validate().unwrap_err();
            let message = format!("{error}");
            assert!(
                message.contains(&format!("has empty {label}")),
                "expected empty {label} error, got: {message}"
            );
        }
    }

    #[test]
    fn published_fitted_adapter_ref_schema_pins_current_id_and_backends() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../../docs/contracts/fitted_adapter_ref.schema.json"
        ))
        .unwrap();
        assert_eq!(schema["$id"].as_str(), Some(FITTED_ADAPTER_REF_SCHEMA_ID));
        assert!(
            schema["$id"]
                .as_str()
                .unwrap()
                .ends_with(&format!("v{FITTED_ADAPTER_REF_SCHEMA_VERSION}.schema.json")),
            "schema $id `{}` must encode version v{FITTED_ADAPTER_REF_SCHEMA_VERSION}",
            schema["$id"]
        );
        let backends = schema["$defs"]["backend"]["enum"].as_array().unwrap();
        for expected in ["joblib", "pickle", "json", "numpy", "onnx", "raw"] {
            assert!(
                backends
                    .iter()
                    .any(|value| value.as_str() == Some(expected)),
                "fitted_adapter_ref backend enum is missing `{expected}`"
            );
        }
    }

    #[test]
    fn rejects_metadata_with_empty_keys() {
        let mut value = portable_ref();
        value
            .metadata
            .insert("".to_string(), serde_json::Value::Null);
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("metadata contains an empty key"));
    }

    #[test]
    fn rejects_invalid_fingerprints() {
        let mut value = portable_ref();
        value.params_fingerprint = "not-a-fingerprint".to_string();
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("params fingerprint"));

        let mut value = portable_ref();
        value.content_fingerprint = Some("not-a-fingerprint".to_string());
        let error = value.validate().unwrap_err();
        assert!(format!("{error}").contains("content fingerprint"));
    }

    #[test]
    fn manifest_validates_and_requires_unique_adapter_ids() {
        let entry = FittedAdapterManifestEntry {
            adapter_id: "snv".to_string(),
            fitted_adapter: portable_ref(),
        };
        let manifest = FittedAdapterManifest::new(vec![entry.clone()]);
        manifest.validate().unwrap();
        manifest.validate_portable().unwrap();

        let manifest = FittedAdapterManifest::new(vec![entry.clone(), entry]);
        let error = manifest.validate().unwrap_err();
        assert!(format!("{error}").contains("duplicate adapter_id"));
    }

    #[test]
    fn manifest_refuses_key_mismatch_and_bad_schema_version() {
        let entry = FittedAdapterManifestEntry {
            adapter_id: "snv".to_string(),
            fitted_adapter: FittedAdapterRef {
                adapter_id: "msc".to_string(),
                ..portable_ref()
            },
        };
        let manifest = FittedAdapterManifest::new(vec![entry]);
        let error = manifest.validate().unwrap_err();
        assert!(format!("{error}").contains("does not match ref adapter_id"));

        let mut manifest = FittedAdapterManifest::new(vec![]);
        manifest.schema_version = FITTED_ADAPTER_MANIFEST_SCHEMA_VERSION + 1;
        let error = manifest.validate().unwrap_err();
        assert!(format!("{error}").contains("unsupported schema_version"));
    }

    #[test]
    fn manifest_round_trips_through_file_persistence() {
        let manifest = FittedAdapterManifest::new(vec![FittedAdapterManifestEntry {
            adapter_id: "snv".to_string(),
            fitted_adapter: portable_ref(),
        }]);
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_fitted_adapter_manifest_roundtrip_{}.json",
            std::process::id()
        ));
        manifest.write_to_path(&path, true).unwrap();
        let loaded = FittedAdapterManifest::read_from_path(&path, true).unwrap();
        assert_eq!(loaded, manifest);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn manifest_file_persistence_rejects_inline_when_portable_required() {
        let manifest = FittedAdapterManifest::new(vec![FittedAdapterManifestEntry {
            adapter_id: "snv".to_string(),
            fitted_adapter: FittedAdapterRef {
                uri: None,
                backend: None,
                content_fingerprint: None,
                plugin: None,
                plugin_version: None,
                ..portable_ref()
            },
        }]);
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_fitted_adapter_manifest_inline_{}.json",
            std::process::id()
        ));
        let error = manifest.write_to_path(&path, true).unwrap_err();
        assert!(format!("{error}").contains("is not portable"));
        manifest.write_to_path(&path, false).unwrap();
        let loaded_inline = FittedAdapterManifest::read_from_path(&path, false).unwrap();
        assert_eq!(loaded_inline, manifest);
        let portable_load_error = FittedAdapterManifest::read_from_path(&path, true).unwrap_err();
        assert!(format!("{portable_load_error}").contains("is not portable"));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn manifest_file_persistence_reports_missing_paths() {
        let path = std::env::temp_dir().join(format!(
            "dag_ml_data_fitted_adapter_manifest_missing_{}.json",
            std::process::id()
        ));
        // Ensure path does not exist.
        let _ = std::fs::remove_file(&path);
        let error = FittedAdapterManifest::read_from_path(&path, false).unwrap_err();
        assert!(format!("{error}").contains("failed to read fitted adapter manifest"));
    }

    #[test]
    fn in_memory_store_is_sync_and_handles_concurrent_register_calls() {
        use std::sync::Arc;

        // Compile-time check: store must be Send + Sync so it can be shared
        // across host threads through the C ABI handle.
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<InMemoryFittedAdapterStore>();

        let store = Arc::new(InMemoryFittedAdapterStore::new());
        let mut handles = Vec::new();
        for thread_idx in 0..8 {
            let store = store.clone();
            handles.push(std::thread::spawn(move || {
                let mut record = portable_ref();
                record.adapter_id = format!("snv:{thread_idx}");
                store.register(record).unwrap()
            }));
        }
        let records: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(records.len(), 8);
        assert_eq!(store.len(), 8);
        let mut handle_ids: Vec<u64> = records.iter().map(|record| record.handle).collect();
        handle_ids.sort();
        // Handles are assigned 1..=8 across the threads, no duplicates.
        assert_eq!(handle_ids, (1..=8).collect::<Vec<u64>>());
    }

    #[test]
    fn in_memory_store_registers_and_materializes_adapter_handles() {
        let store = InMemoryFittedAdapterStore::new();
        assert!(store.is_empty());

        let record = store.register(portable_ref()).unwrap();
        assert_eq!(record.handle, 1);
        assert_eq!(record.fitted_adapter.adapter_id, "snv");
        assert_eq!(store.len(), 1);

        let request = FittedAdapterMaterializationRequest {
            adapter_id: "snv".to_string(),
            params_fingerprint: portable_ref().params_fingerprint,
        };
        let handle = store.materialize(&request).unwrap();
        assert_eq!(handle, 1);

        let duplicate = store.register(portable_ref()).unwrap_err();
        assert!(format!("{duplicate}").contains("already has handle for"));

        let mismatch_request = FittedAdapterMaterializationRequest {
            adapter_id: "snv".to_string(),
            params_fingerprint: fingerprint(0x55),
        };
        let error = store.materialize(&mismatch_request).unwrap_err();
        assert!(
            format!("{error}").contains("params fingerprint mismatch"),
            "unexpected: {error}"
        );

        let missing_request = FittedAdapterMaterializationRequest {
            adapter_id: "msc".to_string(),
            params_fingerprint: portable_ref().params_fingerprint,
        };
        let error = store.materialize(&missing_request).unwrap_err();
        assert!(format!("{error}").contains("missing adapter"));

        assert!(store.release("snv"));
        assert!(store.is_empty());
        assert!(store.materialize(&request).is_err());
    }

    #[test]
    fn store_register_manifest_returns_handles_for_each_entry() {
        let store = InMemoryFittedAdapterStore::new();
        let mut second = portable_ref();
        second.adapter_id = "msc".to_string();
        let manifest = FittedAdapterManifest::new(vec![
            FittedAdapterManifestEntry {
                adapter_id: "snv".to_string(),
                fitted_adapter: portable_ref(),
            },
            FittedAdapterManifestEntry {
                adapter_id: "msc".to_string(),
                fitted_adapter: second,
            },
        ]);
        let records = store.register_manifest(&manifest).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].handle, 1);
        assert_eq!(records[1].handle, 2);
        assert_eq!(store.len(), 2);
    }

    #[test]
    fn store_materialize_rejects_invalid_request_fingerprint() {
        let store = InMemoryFittedAdapterStore::new();
        let request = FittedAdapterMaterializationRequest {
            adapter_id: "snv".to_string(),
            params_fingerprint: "not-a-fingerprint".to_string(),
        };
        let error = store.materialize(&request).unwrap_err();
        assert!(format!("{error}").contains("params fingerprint"));
    }

    #[test]
    fn manifest_portable_check_rejects_non_portable_entries() {
        let entry = FittedAdapterManifestEntry {
            adapter_id: "snv".to_string(),
            fitted_adapter: FittedAdapterRef {
                uri: None,
                backend: None,
                content_fingerprint: None,
                size_bytes: None,
                plugin: None,
                plugin_version: None,
                ..portable_ref()
            },
        };
        let manifest = FittedAdapterManifest::new(vec![entry]);
        manifest.validate().unwrap();
        let error = manifest.validate_portable().unwrap_err();
        assert!(format!("{error}").contains("is not portable"));
    }
}
