// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HandleKind {
    Data,
    DataView,
    Model,
    Artifact,
    Prediction,
    Relation,
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HandleRef {
    pub handle: u64,
    pub kind: HandleKind,
    pub owner_controller: ControllerId,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactBackend {
    Joblib,
    Torch,
    Tensorflow,
    Onnx,
    Safetensors,
    Json,
    Raw,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ArtifactRef {
    pub id: ArtifactId,
    pub kind: String,
    pub controller_id: ControllerId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<ArtifactBackend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_fingerprint: Option<String>,
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_version: Option<String>,
    /// Native ABI family required to consume this payload.  Both ABI fields
    /// are absent on historical non-native references; new native Methods
    /// writers always emit the pair.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abi_major: Option<u32>,
    /// Minimum compatible minor within [`Self::abi_major`].  This is derived
    /// from the payload capability, never copied from the writer's runtime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub abi_min_minor: Option<u32>,
}

impl ArtifactRef {
    pub fn validate(&self) -> Result<()> {
        if self.kind.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` has empty kind",
                self.id
            )));
        }
        validate_artifact_optional_text("uri", &self.uri, &self.id)?;
        validate_artifact_optional_text("plugin", &self.plugin, &self.id)?;
        validate_artifact_optional_text("plugin_version", &self.plugin_version, &self.id)?;
        if self.plugin_version.is_some() && self.plugin.is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` has plugin_version without plugin",
                self.id
            )));
        }
        if self.abi_major.is_some() != self.abi_min_minor.is_some() || self.abi_major == Some(0) {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` must declare a non-zero abi_major together with abi_min_minor",
                self.id
            )));
        }
        if let Some(content_fingerprint) = &self.content_fingerprint {
            validate_runtime_fingerprint("artifact content", content_fingerprint)?;
        }
        if self.uri.is_some() && self.backend.is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` has uri without backend",
                self.id
            )));
        }
        if self.uri.is_some() && self.content_fingerprint.is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` has uri without content_fingerprint",
                self.id
            )));
        }
        Ok(())
    }

    /// Validate that the artifact carries portable metadata: a backend, a safe
    /// relative URI and a content fingerprint. Legacy artifacts that only carry
    /// inline metadata stay readable through [`ArtifactRef::validate`] but are
    /// refused here so persisted manifests can be moved with their payloads.
    pub fn validate_portable(&self) -> Result<()> {
        self.validate()?;
        let Some(uri) = self.uri.as_deref() else {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is not portable: requires backend, uri and content_fingerprint",
                self.id
            )));
        };
        // `validate` already guarantees that a present URI implies a backend and
        // a 64-hex content fingerprint, so confirming the URI is enough here.
        validate_relative_artifact_uri(&self.id, uri)
    }
}

pub fn refit_artifact_input_key(artifact_id: &ArtifactId) -> String {
    format!("artifact:{artifact_id}")
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ArtifactMaterializationRequest {
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub node_id: NodeId,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub controller_id: ControllerId,
    pub artifact: ArtifactRef,
    pub params_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub training_loss_fingerprint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ArtifactHandleRecord {
    pub handle: HandleRef,
    pub node_id: NodeId,
    pub controller_id: ControllerId,
    pub artifact: ArtifactRef,
    pub params_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub training_loss_fingerprint: Option<String>,
}

impl ArtifactHandleRecord {
    pub fn validate(&self) -> Result<()> {
        self.artifact.validate()?;
        if !matches!(self.handle.kind, HandleKind::Model | HandleKind::Artifact) {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered with non-artifact/model handle kind {:?}",
                self.artifact.id, self.handle.kind
            )));
        }
        if self.handle.owner_controller != self.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` handle owner `{}` does not match controller `{}`",
                self.artifact.id, self.handle.owner_controller, self.controller_id
            )));
        }
        if self.artifact.controller_id != self.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` controller `{}` does not match record controller `{}`",
                self.artifact.id, self.artifact.controller_id, self.controller_id
            )));
        }
        if self.params_fingerprint.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` has empty params fingerprint",
                self.artifact.id
            )));
        }
        if let Some(fingerprint) = &self.training_loss_fingerprint {
            validate_runtime_fingerprint("artifact training loss", fingerprint)?;
        }
        Ok(())
    }
}

pub trait RuntimeArtifactStore {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef>;
}

#[derive(Clone, Debug, Default)]
pub struct InMemoryArtifactStore {
    records: BTreeMap<ArtifactId, ArtifactHandleRecord>,
    refit_artifacts: BTreeMap<ArtifactId, RefitArtifactRecord>,
}

impl InMemoryArtifactStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, artifact: &RefitArtifactRecord, handle: HandleRef) -> Result<()> {
        artifact.validate()?;
        let record = ArtifactHandleRecord {
            handle,
            node_id: artifact.node_id.clone(),
            controller_id: artifact.controller_id.clone(),
            artifact: artifact.artifact.clone(),
            params_fingerprint: artifact.params_fingerprint.clone(),
            training_loss_fingerprint: artifact.training_loss_fingerprint.clone(),
        };
        record.validate()?;
        if self.records.contains_key(&record.artifact.id)
            || self.refit_artifacts.contains_key(&record.artifact.id)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate artifact handle for `{}`",
                artifact.artifact.id
            )));
        }
        let previous_record = self.records.insert(record.artifact.id.clone(), record);
        debug_assert!(previous_record.is_none());
        let previous_artifact = self
            .refit_artifacts
            .insert(artifact.artifact.id.clone(), artifact.clone());
        debug_assert!(previous_artifact.is_none());
        Ok(())
    }

    pub fn capture_refit_artifacts(
        &mut self,
        task: &NodeTask,
        result: &NodeResult,
    ) -> Result<Vec<RefitArtifactRecord>> {
        if task.phase != Phase::Refit {
            return Err(DagMlError::RuntimeValidation(format!(
                "cannot capture refit artifacts from phase {:?}",
                task.phase
            )));
        }
        let mut records = Vec::new();
        for artifact in &result.artifacts {
            let handle = result.artifact_handles.get(&artifact.id).ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "node `{}` emitted artifact `{}` without artifact handle",
                    task.node_plan.node_id, artifact.id
                ))
            })?;
            let record = RefitArtifactRecord {
                node_id: task.node_plan.node_id.clone(),
                controller_id: task.node_plan.controller_id.clone(),
                artifact: artifact.clone(),
                params_fingerprint: task.node_plan.params_fingerprint.clone(),
                training_loss_fingerprint: task
                    .node_plan
                    .training_loss_fingerprint(Phase::Refit)?,
                data_requirement_keys: task
                    .node_plan
                    .data_bindings
                    .iter()
                    .map(|binding| {
                        data_binding_requirement_key(&binding.node_id, &binding.input_name)
                    })
                    .collect(),
                // Only the Validation-OOF meta-feature inputs become replay
                // prediction-cache requirements. The off-fold (REFIT/PREDICT)
                // test/predict base predictions are recomputed each phase, not
                // replayed from cache, and they share the same producer/port as the
                // Validation OOF input — so including them would duplicate the
                // requirement key. They are excluded here (partition != Validation).
                prediction_requirement_keys: task
                    .prediction_inputs
                    .values()
                    .filter(|spec| spec.partition == PredictionPartition::Validation)
                    .map(|spec| {
                        bundle_prediction_requirement_key(
                            &spec.producer_node,
                            &spec.source_port,
                            &task.node_plan.node_id,
                            &spec.target_port,
                        )
                    })
                    .collect(),
            };
            self.register(&record, handle.clone())?;
            records.push(record);
        }
        Ok(records)
    }

    pub fn get(&self, artifact_id: &ArtifactId) -> Option<&ArtifactHandleRecord> {
        self.records.get(artifact_id)
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn refit_artifacts(&self) -> Vec<RefitArtifactRecord> {
        self.refit_artifacts.values().cloned().collect()
    }
}

impl RuntimeArtifactStore for InMemoryArtifactStore {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        let record = self.records.get(&request.artifact.id).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "artifact store is missing refit artifact `{}` for bundle `{}`",
                request.artifact.id, request.bundle_id
            ))
        })?;
        if record.node_id != request.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for node `{}` but requested for `{}`",
                request.artifact.id, record.node_id, request.node_id
            )));
        }
        if record.controller_id != request.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for controller `{}` but requested for `{}`",
                request.artifact.id, record.controller_id, request.controller_id
            )));
        }
        if record.artifact != request.artifact {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` metadata does not match bundle record",
                request.artifact.id
            )));
        }
        if record.params_fingerprint != request.params_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` params fingerprint does not match bundle record",
                request.artifact.id
            )));
        }
        if record.training_loss_fingerprint != request.training_loss_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` training loss fingerprint does not match bundle record",
                request.artifact.id
            )));
        }
        record.validate()?;
        Ok(record.handle.clone())
    }
}

pub const FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION: u32 = 1;
pub const FILE_ARTIFACT_MANIFEST_FILE: &str = "artifact_manifest.json";

pub(crate) fn default_file_artifact_manifest_schema_version() -> u32 {
    FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION
}

/// One persisted artifact entry. Mirrors the bundle [`RefitArtifactRecord`]
/// identity (node, controller, artifact, parameters and training loss) while requiring
/// the [`ArtifactRef`] to be portable so the manifest stays movable with its
/// payloads.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileArtifactManifestEntry {
    pub node_id: NodeId,
    pub controller_id: ControllerId,
    pub artifact: ArtifactRef,
    pub params_fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub training_loss_fingerprint: Option<String>,
}

impl FileArtifactManifestEntry {
    fn from_refit_record(record: &RefitArtifactRecord) -> Result<Self> {
        let entry = Self {
            node_id: record.node_id.clone(),
            controller_id: record.controller_id.clone(),
            artifact: record.artifact.clone(),
            params_fingerprint: record.params_fingerprint.clone(),
            training_loss_fingerprint: record.training_loss_fingerprint.clone(),
        };
        entry.validate()?;
        Ok(entry)
    }

    pub fn validate(&self) -> Result<()> {
        self.artifact.validate_portable()?;
        if self.artifact.controller_id != self.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact manifest entry `{}` controller `{}` does not match artifact controller `{}`",
                self.artifact.id, self.controller_id, self.artifact.controller_id
            )));
        }
        validate_runtime_fingerprint("artifact manifest params", &self.params_fingerprint)?;
        if let Some(fingerprint) = &self.training_loss_fingerprint {
            validate_runtime_fingerprint("artifact manifest training loss", fingerprint)?;
        }
        Ok(())
    }

    fn matches_refit_record(&self, record: &RefitArtifactRecord) -> bool {
        self.node_id == record.node_id
            && self.controller_id == record.controller_id
            && self.artifact == record.artifact
            && self.params_fingerprint == record.params_fingerprint
            && self.training_loss_fingerprint == record.training_loss_fingerprint
    }
}

/// Versioned, file-backed artifact manifest. This is a manifest/portability
/// layer only: it records portable [`ArtifactRef`] metadata for a bundle's
/// refit artifacts. It does not deserialize ML objects or materialize artifact
/// payloads; payload stores remain future work.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct FileArtifactManifest {
    pub bundle_id: BundleId,
    #[serde(default = "default_file_artifact_manifest_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub artifacts: Vec<FileArtifactManifestEntry>,
}

impl FileArtifactManifest {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION {
            return Err(DagMlError::RuntimeValidation(format!(
                "file artifact manifest for bundle `{}` uses unsupported schema_version {}, expected {}",
                self.bundle_id, self.schema_version, FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION
            )));
        }
        let mut artifact_ids = BTreeSet::new();
        let mut uris = BTreeSet::new();
        for entry in &self.artifacts {
            entry.validate()?;
            if !artifact_ids.insert(entry.artifact.id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file artifact manifest for bundle `{}` has duplicate artifact id `{}`",
                    self.bundle_id, entry.artifact.id
                )));
            }
            // `entry.validate` guarantees a portable URI is present.
            if let Some(uri) = entry.artifact.uri.as_deref() {
                if !uris.insert(uri) {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "file artifact manifest for bundle `{}` has duplicate artifact uri `{}`",
                        self.bundle_id, uri
                    )));
                }
            }
        }
        Ok(())
    }

    pub fn validate_against_bundle(&self, bundle: &ExecutionBundle) -> Result<()> {
        self.validate()?;
        bundle.validate()?;
        if self.bundle_id != bundle.bundle_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "file artifact manifest bundle `{}` does not match bundle `{}`",
                self.bundle_id, bundle.bundle_id
            )));
        }
        if self.artifacts.len() != bundle.refit_artifacts.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "file artifact manifest for bundle `{}` has {} artifact(s) for {} bundle refit artifact(s)",
                self.bundle_id,
                self.artifacts.len(),
                bundle.refit_artifacts.len()
            )));
        }
        let entries_by_id = self
            .artifacts
            .iter()
            .map(|entry| (entry.artifact.id.as_str(), entry))
            .collect::<BTreeMap<_, _>>();
        for record in &bundle.refit_artifacts {
            let entry = entries_by_id
                .get(record.artifact.id.as_str())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "file artifact manifest for bundle `{}` is missing refit artifact `{}`",
                        self.bundle_id, record.artifact.id
                    ))
                })?;
            if !entry.matches_refit_record(record) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file artifact manifest entry `{}` does not match bundle refit artifact",
                    entry.artifact.id
                )));
            }
        }
        Ok(())
    }
}

/// File-backed artifact manifest store rooted at a directory.
///
/// This is a portability/manifest layer: [`FileArtifactManifestStore::write`]
/// serializes portable artifact references from a validated bundle and
/// [`FileArtifactManifestStore::open`] reloads and revalidates them against the
/// bundle. It never reads, writes or deserializes artifact payloads.
#[derive(Clone, Debug)]
pub struct FileArtifactManifestStore {
    root: PathBuf,
    manifest: FileArtifactManifest,
}

impl FileArtifactManifestStore {
    pub fn write(root: impl AsRef<Path>, bundle: &ExecutionBundle) -> Result<FileArtifactManifest> {
        bundle.validate()?;
        let root = root.as_ref();
        fs::create_dir_all(root).map_err(|err| {
            DagMlError::RuntimeValidation(format!(
                "failed to create artifact manifest store `{}`: {err}",
                root.display()
            ))
        })?;
        let mut entries = Vec::with_capacity(bundle.refit_artifacts.len());
        for record in &bundle.refit_artifacts {
            entries.push(FileArtifactManifestEntry::from_refit_record(record)?);
        }
        entries.sort_by(|left, right| left.artifact.id.cmp(&right.artifact.id));
        let manifest = FileArtifactManifest {
            bundle_id: bundle.bundle_id.clone(),
            schema_version: FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            artifacts: entries,
        };
        manifest.validate_against_bundle(bundle)?;
        write_runtime_json(
            &root.join(FILE_ARTIFACT_MANIFEST_FILE),
            &manifest,
            "artifact manifest",
        )?;
        Ok(manifest)
    }

    pub fn open(root: impl Into<PathBuf>, bundle: &ExecutionBundle) -> Result<Self> {
        bundle.validate()?;
        let root = root.into();
        let manifest: FileArtifactManifest =
            read_runtime_json(&root.join(FILE_ARTIFACT_MANIFEST_FILE), "artifact manifest")?;
        manifest.validate_against_bundle(bundle)?;
        Ok(Self { root, manifest })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn manifest(&self) -> &FileArtifactManifest {
        &self.manifest
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ArtifactPayloadMaterializationRecord {
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub node_id: NodeId,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub artifact_id: ArtifactId,
    pub training_loss_fingerprint: Option<String>,
    pub payload_uri: String,
    pub content_fingerprint: String,
    pub size_bytes: u64,
    pub handle: HandleRef,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ArtifactPayloadMetadata {
    pub(crate) uri: String,
    pub(crate) content_fingerprint: String,
    pub(crate) size_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct FileArtifactPayloadStore {
    root: PathBuf,
    manifest: FileArtifactManifest,
    records_by_artifact_id: BTreeMap<ArtifactId, RefitArtifactRecord>,
    materialization_records: RefCell<Vec<ArtifactPayloadMaterializationRecord>>,
}

impl FileArtifactPayloadStore {
    pub fn write_from_source(
        output_root: impl AsRef<Path>,
        source_root: impl AsRef<Path>,
        bundle: &ExecutionBundle,
    ) -> Result<Self> {
        bundle.validate()?;
        let output_root = output_root.as_ref();
        let source_root = source_root.as_ref();
        fs::create_dir_all(output_root).map_err(|err| {
            DagMlError::RuntimeValidation(format!(
                "failed to create artifact payload store `{}`: {err}",
                output_root.display()
            ))
        })?;
        for record in &bundle.refit_artifacts {
            record.artifact.validate_portable()?;
            validate_artifact_payload_file(source_root, &record.artifact)?;
            let source_path = artifact_payload_path(source_root, &record.artifact)?;
            let output_path = artifact_payload_path(output_root, &record.artifact)?;
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    DagMlError::RuntimeValidation(format!(
                        "failed to create artifact payload directory `{}`: {err}",
                        parent.display()
                    ))
                })?;
            }
            if source_path != output_path {
                fs::copy(&source_path, &output_path).map_err(|err| {
                    DagMlError::RuntimeValidation(format!(
                        "failed to copy artifact payload `{}` from {} to {}: {err}",
                        record.artifact.id,
                        source_path.display(),
                        output_path.display()
                    ))
                })?;
            }
        }
        FileArtifactManifestStore::write(output_root, bundle)?;
        Self::open(output_root.to_path_buf(), bundle)
    }

    pub fn open(root: impl Into<PathBuf>, bundle: &ExecutionBundle) -> Result<Self> {
        bundle.validate()?;
        let root = root.into();
        let manifest_store = FileArtifactManifestStore::open(root.clone(), bundle)?;
        let records_by_artifact_id = bundle
            .refit_artifacts
            .iter()
            .cloned()
            .map(|record| (record.artifact.id.clone(), record))
            .collect::<BTreeMap<_, _>>();
        let store = Self {
            root,
            manifest: manifest_store.manifest().clone(),
            records_by_artifact_id,
            materialization_records: RefCell::new(Vec::new()),
        };
        store.validate_payloads()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn manifest(&self) -> &FileArtifactManifest {
        &self.manifest
    }

    pub fn payload_count(&self) -> usize {
        self.manifest.artifacts.len()
    }

    pub fn materialization_records(&self) -> Vec<ArtifactPayloadMaterializationRecord> {
        self.materialization_records.borrow().clone()
    }

    pub fn validate_payloads(&self) -> Result<()> {
        self.manifest.validate()?;
        for entry in &self.manifest.artifacts {
            let record = self
                .records_by_artifact_id
                .get(&entry.artifact.id)
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "artifact payload store for bundle `{}` has no bundle record for `{}`",
                        self.manifest.bundle_id, entry.artifact.id
                    ))
                })?;
            if !entry.matches_refit_record(record) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "artifact payload store entry `{}` does not match bundle refit artifact",
                    entry.artifact.id
                )));
            }
            validate_artifact_payload_file(&self.root, &entry.artifact)?;
        }
        Ok(())
    }
}

impl RuntimeArtifactStore for FileArtifactPayloadStore {
    fn materialize(&self, request: &ArtifactMaterializationRequest) -> Result<HandleRef> {
        request.artifact.validate_portable()?;
        let record = self
            .records_by_artifact_id
            .get(&request.artifact.id)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "artifact payload store is missing refit artifact `{}` for bundle `{}`",
                    request.artifact.id, request.bundle_id
                ))
            })?;
        if record.node_id != request.node_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for node `{}` but requested for `{}`",
                request.artifact.id, record.node_id, request.node_id
            )));
        }
        if record.controller_id != request.controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` is registered for controller `{}` but requested for `{}`",
                request.artifact.id, record.controller_id, request.controller_id
            )));
        }
        if record.artifact != request.artifact {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` metadata does not match bundle record",
                request.artifact.id
            )));
        }
        if record.params_fingerprint != request.params_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` params fingerprint does not match bundle record",
                request.artifact.id
            )));
        }
        if record.training_loss_fingerprint != request.training_loss_fingerprint {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{}` training loss fingerprint does not match bundle record",
                request.artifact.id
            )));
        }
        let metadata = validate_artifact_payload_file(&self.root, &request.artifact)?;
        let fingerprint = stable_json_fingerprint(&(
            &request.run_id,
            &request.bundle_id,
            &request.node_id,
            request.phase,
            &request.variant_id,
            &request.artifact.id,
            &metadata.content_fingerprint,
            &request.params_fingerprint,
            &request.training_loss_fingerprint,
        ))?;
        let handle = HandleRef {
            handle: u64::from_str_radix(&fingerprint[..16], 16)
                .expect("sha256 hex prefix should fit into u64"),
            kind: HandleKind::Artifact,
            owner_controller: request.controller_id.clone(),
        };
        self.materialization_records
            .borrow_mut()
            .push(ArtifactPayloadMaterializationRecord {
                run_id: request.run_id.clone(),
                bundle_id: request.bundle_id.clone(),
                node_id: request.node_id.clone(),
                phase: request.phase,
                variant_id: request.variant_id.clone(),
                artifact_id: request.artifact.id.clone(),
                training_loss_fingerprint: request.training_loss_fingerprint.clone(),
                payload_uri: metadata.uri,
                content_fingerprint: metadata.content_fingerprint,
                size_bytes: metadata.size_bytes,
                handle: handle.clone(),
            });
        Ok(handle)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineageRecord {
    pub record_id: LineageId,
    pub run_id: RunId,
    pub node_id: NodeId,
    pub phase: Phase,
    pub controller_id: ControllerId,
    pub controller_version: String,
    pub variant_id: Option<VariantId>,
    pub fold_id: Option<FoldId>,
    #[serde(default)]
    pub branch_path: Vec<BranchId>,
    #[serde(default)]
    pub input_lineage: Vec<LineageId>,
    #[serde(default)]
    pub artifact_refs: Vec<ArtifactRef>,
    pub params_fingerprint: String,
    pub data_model_shape_fingerprint: Option<String>,
    pub aggregation_policy_fingerprint: Option<String>,
    pub seed: Option<u64>,
    #[serde(default)]
    pub unsafe_flags: BTreeSet<String>,
    #[serde(default)]
    pub metrics: BTreeMap<String, f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loss_attestations: Vec<LossExecutionAttestation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub early_stopping_records: Vec<EarlyStoppingRecord>,
}

impl LineageRecord {
    pub fn validate(&self) -> Result<()> {
        if self.params_fingerprint.trim().is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "lineage `{}` has empty params fingerprint",
                self.record_id
            )));
        }
        for artifact in &self.artifact_refs {
            artifact.validate()?;
        }
        for attestation in &self.loss_attestations {
            attestation.validate()?;
            if attestation.node_id != self.node_id || attestation.phase != self.phase {
                return Err(DagMlError::RuntimeValidation(format!(
                    "lineage `{}` contains a loss attestation outside its node/phase scope",
                    self.record_id
                )));
            }
        }
        let mut early_stopping_roles = BTreeSet::new();
        for record in &self.early_stopping_records {
            record.validate_against(&self.node_id, self.phase, self.fold_id.as_ref())?;
            if !early_stopping_roles.insert(record.metric_role.role_id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "lineage `{}` contains duplicate early-stopping role `{}`",
                    self.record_id, record.metric_role.role_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default)]
pub struct InMemoryLineageRecorder {
    records: BTreeMap<LineageId, LineageRecord>,
}

impl InMemoryLineageRecorder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, record: LineageRecord) -> Result<()> {
        record.validate()?;
        if self
            .records
            .insert(record.record_id.clone(), record)
            .is_some()
        {
            return Err(DagMlError::RuntimeValidation(
                "duplicate lineage record id".to_string(),
            ));
        }
        Ok(())
    }

    pub fn get(&self, id: &LineageId) -> Option<&LineageRecord> {
        self.records.get(id)
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn records(&self) -> impl Iterator<Item = &LineageRecord> {
        self.records.values()
    }
}
