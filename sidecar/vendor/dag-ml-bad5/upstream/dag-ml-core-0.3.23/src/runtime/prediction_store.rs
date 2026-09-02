// Auto-split from the former monolithic `runtime.rs` (pure refactor).
use super::*;

#[derive(Clone, Debug, Default)]
pub struct InMemoryPredictionStore {
    blocks: Vec<PredictionBlock>,
}

impl InMemoryPredictionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, block: PredictionBlock) -> Result<()> {
        block.validate_content()?;
        self.blocks.push(block);
        Ok(())
    }

    pub fn blocks(&self) -> &[PredictionBlock] {
        &self.blocks
    }

    pub fn find(
        &self,
        producer_node: Option<&NodeId>,
        phase_partition: Option<&crate::oof::PredictionPartition>,
        fold_id: Option<&FoldId>,
    ) -> Vec<&PredictionBlock> {
        self.blocks
            .iter()
            .filter(|block| {
                producer_node.is_none_or(|node_id| &block.producer_node == node_id)
                    && phase_partition.is_none_or(|partition| &block.partition == partition)
                    && fold_id.is_none_or(|requested| block.fold_id.as_ref() == Some(requested))
            })
            .collect()
    }
}

#[derive(Clone, Debug, Default)]
pub struct InMemoryAggregatedPredictionStore {
    blocks: Vec<AggregatedPredictionBlock>,
}

impl InMemoryAggregatedPredictionStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, block: AggregatedPredictionBlock) -> Result<()> {
        block.validate_shape()?;
        self.blocks.push(block);
        Ok(())
    }

    pub fn blocks(&self) -> &[AggregatedPredictionBlock] {
        &self.blocks
    }

    pub fn find(
        &self,
        producer_node: Option<&NodeId>,
        phase_partition: Option<&PredictionPartition>,
        fold_id: Option<&FoldId>,
        prediction_level: Option<PredictionLevel>,
    ) -> Vec<&AggregatedPredictionBlock> {
        self.blocks
            .iter()
            .filter(|block| {
                producer_node.is_none_or(|node_id| &block.producer_node == node_id)
                    && phase_partition.is_none_or(|partition| &block.partition == partition)
                    && fold_id.is_none_or(|requested| block.fold_id.as_ref() == Some(requested))
                    && prediction_level.is_none_or(|level| block.level == level)
            })
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PredictionCacheMaterializationRequest {
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub requirement: BundlePredictionRequirement,
    pub cache: BundlePredictionCacheRecord,
    pub producer_controller_id: ControllerId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PredictionCacheMaterializationRecord {
    pub run_id: RunId,
    pub bundle_id: BundleId,
    pub phase: Phase,
    pub variant_id: Option<VariantId>,
    pub requirement_key: String,
    pub cache_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_namespace_fingerprints: Vec<String>,
    pub handle: HandleRef,
}

impl PredictionCacheMaterializationRecord {
    pub fn validate(&self) -> Result<()> {
        validate_runtime_non_empty(
            "prediction cache materialization requirement_key",
            &self.requirement_key,
        )?;
        validate_runtime_non_empty("prediction cache materialization cache_id", &self.cache_id)?;
        validate_runtime_cache_namespace_fingerprints(
            &self.cache_id,
            &self.cache_namespace_fingerprints,
        )?;
        if self.handle.kind != HandleKind::Prediction {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization `{}` produced a non-prediction handle",
                self.cache_id
            )));
        }
        Ok(())
    }

    pub fn validate_against_request(
        &self,
        request: &PredictionCacheMaterializationRequest,
    ) -> Result<()> {
        self.validate()?;
        request.requirement.validate()?;
        request.cache.validate()?;
        if !request.cache.cache_namespace_fingerprints.is_empty() && request.variant_id.is_none() {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization for D10-enriched cache `{}` requires variant_id",
                request.cache.cache_id
            )));
        }
        let requirement_key = request.requirement.key();
        if self.run_id != request.run_id {
            return Err(DagMlError::RuntimeValidation(
                "prediction cache materialization record run_id does not match request".to_string(),
            ));
        }
        if self.bundle_id != request.bundle_id {
            return Err(DagMlError::RuntimeValidation(
                "prediction cache materialization record bundle_id does not match request"
                    .to_string(),
            ));
        }
        if self.phase != request.phase {
            return Err(DagMlError::RuntimeValidation(
                "prediction cache materialization record phase does not match request".to_string(),
            ));
        }
        if self.variant_id != request.variant_id {
            return Err(DagMlError::RuntimeValidation(
                "prediction cache materialization record variant_id does not match request"
                    .to_string(),
            ));
        }
        if self.requirement_key != requirement_key
            || self.requirement_key != request.cache.requirement_key
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization record requirement `{}` does not match request `{}` / cache `{}`",
                self.requirement_key, requirement_key, request.cache.requirement_key
            )));
        }
        if self.cache_id != request.cache.cache_id {
            return Err(DagMlError::RuntimeValidation(
                "prediction cache materialization record cache_id does not match request"
                    .to_string(),
            ));
        }
        if self.cache_namespace_fingerprints != request.cache.cache_namespace_fingerprints {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization record for `{}` dropped or changed cache namespace fingerprints",
                self.cache_id
            )));
        }
        if self.handle.owner_controller != request.producer_controller_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization record for `{}` uses a handle owned by a different controller",
                self.cache_id
            )));
        }
        Ok(())
    }
}

fn prediction_cache_materialization_record(
    request: &PredictionCacheMaterializationRequest,
    handle: HandleRef,
) -> Result<PredictionCacheMaterializationRecord> {
    let record = PredictionCacheMaterializationRecord {
        run_id: request.run_id.clone(),
        bundle_id: request.bundle_id.clone(),
        phase: request.phase,
        variant_id: request.variant_id.clone(),
        requirement_key: request.cache.requirement_key.clone(),
        cache_id: request.cache.cache_id.clone(),
        cache_namespace_fingerprints: request.cache.cache_namespace_fingerprints.clone(),
        handle,
    };
    record.validate_against_request(request)?;
    Ok(record)
}

fn prediction_cache_materialization_handle(
    request: &PredictionCacheMaterializationRequest,
) -> Result<HandleRef> {
    let fingerprint = stable_json_fingerprint(&(
        &request.run_id,
        &request.bundle_id,
        request.phase,
        &request.variant_id,
        &request.cache.requirement_key,
        &request.cache.cache_id,
        &request.cache.cache_namespace_fingerprints,
        request.cache.prediction_level,
        &request.cache.content_fingerprint,
    ))?;
    Ok(HandleRef {
        handle: u64::from_str_radix(&fingerprint[..16], 16)
            .expect("sha256 hex prefix should fit into u64"),
        kind: HandleKind::Prediction,
        owner_controller: request.producer_controller_id.clone(),
    })
}

pub trait RuntimePredictionCacheStore {
    fn load_blocks(&self, requirement_key: &str) -> Result<Vec<PredictionBlock>>;
    fn load_aggregated_blocks(
        &self,
        requirement_key: &str,
    ) -> Result<Vec<AggregatedPredictionBlock>> {
        Err(DagMlError::RuntimeValidation(format!(
            "prediction cache store does not support aggregated requirement `{requirement_key}`"
        )))
    }
    fn materialize(&self, request: &PredictionCacheMaterializationRequest) -> Result<HandleRef>;
}

pub const FILE_PREDICTION_CACHE_STORE_SCHEMA_VERSION: u32 = 1;
pub const FILE_PREDICTION_CACHE_MANIFEST_FILE: &str = "prediction_cache_manifest.json";

pub(crate) fn default_file_prediction_cache_store_schema_version() -> u32 {
    FILE_PREDICTION_CACHE_STORE_SCHEMA_VERSION
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilePredictionCacheEntry {
    pub requirement_key: String,
    pub cache_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_namespace_fingerprints: Vec<String>,
    pub file_name: String,
    #[serde(default = "default_runtime_prediction_level")]
    pub prediction_level: PredictionLevel,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unit_ids: Vec<PredictionUnitId>,
    pub block_count: usize,
    pub row_count: usize,
    pub content_fingerprint: String,
}

impl FilePredictionCacheEntry {
    pub fn validate(&self) -> Result<()> {
        validate_runtime_non_empty("requirement_key", &self.requirement_key)?;
        validate_runtime_non_empty("cache_id", &self.cache_id)?;
        validate_runtime_cache_namespace_fingerprints(
            &self.cache_id,
            &self.cache_namespace_fingerprints,
        )?;
        validate_runtime_non_empty("file_name", &self.file_name)?;
        validate_prediction_cache_file_name(&self.file_name)?;
        if self.block_count == 0 {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache `{}` has zero block_count",
                self.cache_id
            )));
        }
        if self.row_count == 0 {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache `{}` has zero row_count",
                self.cache_id
            )));
        }
        if self.prediction_level != PredictionLevel::Sample && self.unit_ids.is_empty() {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache `{}` has no aggregated unit ids",
                self.cache_id
            )));
        }
        if self
            .unit_ids
            .iter()
            .any(|unit_id| unit_id.level() != self.prediction_level)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache `{}` has unit ids outside {:?}",
                self.cache_id, self.prediction_level
            )));
        }
        validate_runtime_fingerprint("prediction cache content", &self.content_fingerprint)
    }

    fn from_payload(payload: &crate::bundle::BundlePredictionCachePayload) -> Result<Self> {
        Ok(Self {
            requirement_key: payload.requirement_key.clone(),
            cache_id: payload.cache_id.clone(),
            cache_namespace_fingerprints: payload.cache_namespace_fingerprints.clone(),
            file_name: prediction_cache_payload_file_name(payload)?,
            prediction_level: payload.prediction_level,
            unit_ids: payload
                .aggregated_blocks
                .iter()
                .flat_map(|block| block.unit_ids.iter().cloned())
                .collect(),
            block_count: payload.block_count,
            row_count: payload.row_count,
            content_fingerprint: payload.content_fingerprint.clone(),
        })
    }

    fn matches_record(&self, record: &BundlePredictionCacheRecord) -> bool {
        self.requirement_key == record.requirement_key
            && self.cache_id == record.cache_id
            && self.cache_namespace_fingerprints == record.cache_namespace_fingerprints
            && self.prediction_level == record.prediction_level
            && self.unit_ids == record.unit_ids
            && self.block_count == record.block_count
            && self.row_count == record.row_count
            && self.content_fingerprint == record.content_fingerprint
    }
}

fn validate_runtime_cache_namespace_fingerprints(
    cache_id: &str,
    fingerprints: &[String],
) -> Result<()> {
    let mut seen = BTreeSet::new();
    for fingerprint in fingerprints {
        validate_runtime_fingerprint("prediction cache namespace", fingerprint)?;
        if !seen.insert(fingerprint.as_str()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache `{cache_id}` has duplicate cache namespace fingerprint `{fingerprint}`"
            )));
        }
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilePredictionCacheManifest {
    pub bundle_id: BundleId,
    #[serde(default = "default_file_prediction_cache_store_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub caches: Vec<FilePredictionCacheEntry>,
}

impl FilePredictionCacheManifest {
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != FILE_PREDICTION_CACHE_STORE_SCHEMA_VERSION {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache manifest for bundle `{}` uses unsupported schema_version {}, expected {}",
                self.bundle_id,
                self.schema_version,
                FILE_PREDICTION_CACHE_STORE_SCHEMA_VERSION
            )));
        }
        let mut requirement_keys = BTreeSet::new();
        let mut cache_ids = BTreeSet::new();
        let mut file_names = BTreeSet::new();
        for entry in &self.caches {
            entry.validate()?;
            if !requirement_keys.insert(entry.requirement_key.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file prediction cache manifest for bundle `{}` has duplicate requirement `{}`",
                    self.bundle_id, entry.requirement_key
                )));
            }
            if !cache_ids.insert(entry.cache_id.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file prediction cache manifest for bundle `{}` has duplicate cache id `{}`",
                    self.bundle_id, entry.cache_id
                )));
            }
            if !file_names.insert(entry.file_name.as_str()) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file prediction cache manifest for bundle `{}` has duplicate file `{}`",
                    self.bundle_id, entry.file_name
                )));
            }
        }
        Ok(())
    }

    pub fn validate_against_bundle(&self, bundle: &ExecutionBundle) -> Result<()> {
        self.validate()?;
        bundle.validate()?;
        if self.bundle_id != bundle.bundle_id {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache manifest bundle `{}` does not match bundle `{}`",
                self.bundle_id, bundle.bundle_id
            )));
        }
        if self.caches.len() != bundle.prediction_caches.len() {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache manifest for bundle `{}` has {} cache(s) for {} bundle cache record(s)",
                self.bundle_id,
                self.caches.len(),
                bundle.prediction_caches.len()
            )));
        }
        let entries_by_requirement = self
            .caches
            .iter()
            .map(|entry| (entry.requirement_key.as_str(), entry))
            .collect::<BTreeMap<_, _>>();
        for record in &bundle.prediction_caches {
            let entry = entries_by_requirement
                .get(record.requirement_key.as_str())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "file prediction cache manifest for bundle `{}` is missing requirement `{}`",
                        self.bundle_id, record.requirement_key
                    ))
                })?;
            if !entry.matches_record(record) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "file prediction cache manifest entry `{}` does not match bundle cache record",
                    entry.cache_id
                )));
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct FilePredictionCacheStore {
    root: PathBuf,
    manifest: FilePredictionCacheManifest,
    records_by_requirement: BTreeMap<String, BundlePredictionCacheRecord>,
    materialization_records: RefCell<Vec<PredictionCacheMaterializationRecord>>,
}

impl FilePredictionCacheStore {
    pub fn write_payload_set(
        root: impl AsRef<Path>,
        bundle: &ExecutionBundle,
        payloads: &BundlePredictionCachePayloadSet,
    ) -> Result<FilePredictionCacheManifest> {
        payloads.validate_against_bundle(bundle)?;
        let root = root.as_ref();
        fs::create_dir_all(root).map_err(|err| {
            DagMlError::RuntimeValidation(format!(
                "failed to create prediction cache store `{}`: {err}",
                root.display()
            ))
        })?;

        let mut entries = Vec::new();
        let records_by_requirement = bundle
            .prediction_caches
            .iter()
            .map(|record| (record.requirement_key.as_str(), record))
            .collect::<BTreeMap<_, _>>();
        for payload in &payloads.caches {
            let record = records_by_requirement
                .get(payload.requirement_key.as_str())
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "prediction cache payload `{}` references unknown requirement `{}`",
                        payload.cache_id, payload.requirement_key
                    ))
                })?;
            validate_prediction_cache_payload_matches_record(payload, record)?;
            let entry = FilePredictionCacheEntry::from_payload(payload)?;
            let payload_path = root.join(&entry.file_name);
            write_runtime_json(&payload_path, payload, "prediction cache payload")?;
            entries.push(entry);
        }
        entries.sort_by(|left, right| left.requirement_key.cmp(&right.requirement_key));
        let manifest = FilePredictionCacheManifest {
            bundle_id: bundle.bundle_id.clone(),
            schema_version: FILE_PREDICTION_CACHE_STORE_SCHEMA_VERSION,
            caches: entries,
        };
        manifest.validate_against_bundle(bundle)?;
        write_runtime_json(
            &root.join(FILE_PREDICTION_CACHE_MANIFEST_FILE),
            &manifest,
            "prediction cache manifest",
        )?;
        Ok(manifest)
    }

    pub fn open(root: impl Into<PathBuf>, bundle: &ExecutionBundle) -> Result<Self> {
        bundle.validate()?;
        let root = root.into();
        let manifest: FilePredictionCacheManifest = read_runtime_json(
            &root.join(FILE_PREDICTION_CACHE_MANIFEST_FILE),
            "prediction cache manifest",
        )?;
        manifest.validate_against_bundle(bundle)?;
        let records_by_requirement = bundle
            .prediction_caches
            .iter()
            .cloned()
            .map(|record| (record.requirement_key.clone(), record))
            .collect::<BTreeMap<_, _>>();
        Ok(Self {
            root,
            manifest,
            records_by_requirement,
            materialization_records: RefCell::new(Vec::new()),
        })
    }

    pub fn manifest(&self) -> &FilePredictionCacheManifest {
        &self.manifest
    }

    pub fn materialization_records(&self) -> Vec<PredictionCacheMaterializationRecord> {
        self.materialization_records.borrow().clone()
    }

    fn payload_for_requirement(
        &self,
        requirement_key: &str,
    ) -> Result<crate::bundle::BundlePredictionCachePayload> {
        let entry = self
            .manifest
            .caches
            .iter()
            .find(|entry| entry.requirement_key == requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "file prediction cache store is missing requirement `{requirement_key}`"
                ))
            })?;
        let record = self
            .records_by_requirement
            .get(requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "file prediction cache store has no bundle record for requirement `{requirement_key}`"
                ))
            })?;
        let payload: crate::bundle::BundlePredictionCachePayload = read_runtime_json(
            &self.root.join(&entry.file_name),
            "prediction cache payload",
        )?;
        validate_prediction_cache_payload_matches_record(&payload, record)?;
        Ok(payload)
    }
}

impl RuntimePredictionCacheStore for FilePredictionCacheStore {
    fn load_blocks(&self, requirement_key: &str) -> Result<Vec<PredictionBlock>> {
        let payload = self.payload_for_requirement(requirement_key)?;
        if payload.prediction_level != PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache store requirement `{requirement_key}` contains {:?} predictions, not sample blocks",
                payload.prediction_level
            )));
        }
        Ok(payload.blocks)
    }

    fn load_aggregated_blocks(
        &self,
        requirement_key: &str,
    ) -> Result<Vec<AggregatedPredictionBlock>> {
        let payload = self.payload_for_requirement(requirement_key)?;
        if payload.prediction_level == PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache store requirement `{requirement_key}` contains sample predictions, not aggregated blocks"
            )));
        }
        Ok(payload.aggregated_blocks)
    }

    fn materialize(&self, request: &PredictionCacheMaterializationRequest) -> Result<HandleRef> {
        request.requirement.validate()?;
        request.cache.validate()?;
        let requirement_key = request.requirement.key();
        let record = self
            .records_by_requirement
            .get(&requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "file prediction cache store is missing requirement `{requirement_key}`"
                ))
            })?;
        if record != &request.cache {
            return Err(DagMlError::RuntimeValidation(format!(
                "file prediction cache materialization request for `{requirement_key}` does not match bundle cache record"
            )));
        }
        let payload = self.payload_for_requirement(&requirement_key)?;
        validate_prediction_cache_payload_matches_record(&payload, record)?;
        let handle = prediction_cache_materialization_handle(request)?;
        self.materialization_records
            .borrow_mut()
            .push(prediction_cache_materialization_record(
                request,
                handle.clone(),
            )?);
        Ok(handle)
    }
}

pub(crate) fn prediction_cache_payload_file_name(
    payload: &crate::bundle::BundlePredictionCachePayload,
) -> Result<String> {
    let fingerprint = stable_json_fingerprint(&(
        &payload.requirement_key,
        &payload.cache_id,
        &payload.cache_namespace_fingerprints,
        payload.prediction_level,
        &payload.content_fingerprint,
        payload.block_count,
        payload.row_count,
    ))?;
    Ok(format!("prediction-cache-{}.json", &fingerprint[..16]))
}

pub(crate) fn validate_prediction_cache_file_name(file_name: &str) -> Result<()> {
    if file_name == "." || file_name == ".." || file_name.contains('/') || file_name.contains('\\')
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "prediction cache file name `{file_name}` must be a plain file name"
        )));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq)]
pub struct ColumnarPredictionCacheBlock {
    pub prediction_id: Option<String>,
    pub producer_node: NodeId,
    pub producer_port: Option<String>,
    pub partition: PredictionPartition,
    pub fold_id: Option<FoldId>,
    pub prediction_level: PredictionLevel,
    pub unit_ids: Vec<PredictionUnitId>,
    pub sample_ids: Vec<SampleId>,
    pub target_names: Vec<String>,
    pub width: usize,
    pub columns: Vec<Vec<f64>>,
}

impl ColumnarPredictionCacheBlock {
    pub fn from_prediction_block(block: &PredictionBlock) -> Result<Self> {
        let width = block.validate_shape()?;
        let mut columns = vec![Vec::with_capacity(block.values.len()); width];
        for row in &block.values {
            for (column_idx, value) in row.iter().enumerate() {
                columns[column_idx].push(*value);
            }
        }
        Ok(Self {
            prediction_id: block.prediction_id.clone(),
            producer_node: block.producer_node.clone(),
            producer_port: block.producer_port.clone(),
            partition: block.partition.clone(),
            fold_id: block.fold_id.clone(),
            prediction_level: PredictionLevel::Sample,
            unit_ids: Vec::new(),
            sample_ids: block.sample_ids.clone(),
            target_names: block.target_names.clone(),
            width,
            columns,
        })
    }

    pub fn from_aggregated_prediction_block(block: &AggregatedPredictionBlock) -> Result<Self> {
        let width = block.validate_shape()?;
        if block.level == PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar aggregated prediction block for `{}` must use target/group level, got sample",
                block.producer_node
            )));
        }
        let mut columns = vec![Vec::with_capacity(block.values.len()); width];
        for row in &block.values {
            for (column_idx, value) in row.iter().enumerate() {
                columns[column_idx].push(*value);
            }
        }
        Ok(Self {
            prediction_id: block.prediction_id.clone(),
            producer_node: block.producer_node.clone(),
            producer_port: block.producer_port.clone(),
            partition: block.partition.clone(),
            fold_id: block.fold_id.clone(),
            prediction_level: block.level,
            unit_ids: block.unit_ids.clone(),
            sample_ids: Vec::new(),
            target_names: block.target_names.clone(),
            width,
            columns,
        })
    }

    pub fn row_count(&self) -> usize {
        match self.prediction_level {
            PredictionLevel::Sample => self.sample_ids.len(),
            PredictionLevel::Target | PredictionLevel::Group => self.unit_ids.len(),
            PredictionLevel::Observation => 0,
        }
    }

    pub fn value_count(&self) -> usize {
        self.columns.iter().map(Vec::len).sum()
    }

    pub fn validate(&self) -> Result<()> {
        match self.prediction_level {
            PredictionLevel::Observation => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction block for `{}` cannot store observation-level predictions",
                    self.producer_node
                )));
            }
            PredictionLevel::Sample => {
                if self.sample_ids.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "columnar sample prediction block for `{}` has no sample ids",
                        self.producer_node
                    )));
                }
                if !self.unit_ids.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "columnar sample prediction block for `{}` unexpectedly carries unit ids",
                        self.producer_node
                    )));
                }
            }
            PredictionLevel::Target | PredictionLevel::Group => {
                if !self.sample_ids.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "columnar aggregated prediction block for `{}` unexpectedly carries sample ids",
                        self.producer_node
                    )));
                }
                if self.unit_ids.is_empty() {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "columnar aggregated prediction block for `{}` has no unit ids",
                        self.producer_node
                    )));
                }
                if self
                    .unit_ids
                    .iter()
                    .any(|unit_id| unit_id.level() != self.prediction_level)
                {
                    return Err(DagMlError::RuntimeValidation(format!(
                        "columnar aggregated prediction block for `{}` carries unit ids outside {:?}",
                        self.producer_node, self.prediction_level
                    )));
                }
            }
        }
        if self.width == 0 {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction block for `{}` has zero width",
                self.producer_node
            )));
        }
        if self.columns.len() != self.width {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction block for `{}` has {} column(s), expected {}",
                self.producer_node,
                self.columns.len(),
                self.width
            )));
        }
        for (column_idx, column) in self.columns.iter().enumerate() {
            if column.len() != self.row_count() {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction block for `{}` column {} has {} value(s), expected {}",
                    self.producer_node,
                    column_idx,
                    column.len(),
                    self.row_count()
                )));
            }
        }
        if !self.target_names.is_empty() && self.target_names.len() != self.width {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction block for `{}` has {} target names for width {}",
                self.producer_node,
                self.target_names.len(),
                self.width
            )));
        }
        Ok(())
    }

    pub fn to_prediction_block(&self) -> Result<PredictionBlock> {
        self.validate()?;
        if self.prediction_level != PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction block for `{}` contains {:?} predictions, not sample predictions",
                self.producer_node, self.prediction_level
            )));
        }
        let values = (0..self.row_count())
            .map(|row_idx| {
                self.columns
                    .iter()
                    .map(|column| column[row_idx])
                    .collect::<Vec<_>>()
            })
            .collect();
        let block = PredictionBlock {
            prediction_id: self.prediction_id.clone(),
            producer_node: self.producer_node.clone(),
            producer_port: self.producer_port.clone(),
            partition: self.partition.clone(),
            fold_id: self.fold_id.clone(),
            sample_ids: self.sample_ids.clone(),
            values,
            target_names: self.target_names.clone(),
        };
        block.validate_shape()?;
        Ok(block)
    }

    pub fn to_aggregated_prediction_block(&self) -> Result<AggregatedPredictionBlock> {
        self.validate()?;
        if self.prediction_level == PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction block for `{}` contains sample predictions, not aggregated predictions",
                self.producer_node
            )));
        }
        let values = (0..self.row_count())
            .map(|row_idx| {
                self.columns
                    .iter()
                    .map(|column| column[row_idx])
                    .collect::<Vec<_>>()
            })
            .collect();
        let block = AggregatedPredictionBlock {
            prediction_id: self.prediction_id.clone(),
            producer_node: self.producer_node.clone(),
            producer_port: self.producer_port.clone(),
            partition: self.partition.clone(),
            fold_id: self.fold_id.clone(),
            level: self.prediction_level,
            unit_ids: self.unit_ids.clone(),
            values,
            target_names: self.target_names.clone(),
        };
        block.validate_shape()?;
        Ok(block)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnarPredictionCacheManifest {
    pub requirement_key: String,
    pub cache_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cache_namespace_fingerprints: Vec<String>,
    pub prediction_level: PredictionLevel,
    pub block_count: usize,
    pub row_count: usize,
    pub prediction_width: usize,
    pub value_count: usize,
    pub estimated_value_bytes: usize,
    pub content_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ColumnarPredictionCacheEntry {
    cache: BundlePredictionCacheRecord,
    blocks: Vec<ColumnarPredictionCacheBlock>,
}

impl ColumnarPredictionCacheEntry {
    fn from_payload(
        payload: BundlePredictionCachePayload,
        cache: BundlePredictionCacheRecord,
    ) -> Result<Self> {
        validate_prediction_cache_payload_matches_record(&payload, &cache)?;
        let blocks = match payload.prediction_level {
            PredictionLevel::Sample => payload
                .blocks
                .iter()
                .map(ColumnarPredictionCacheBlock::from_prediction_block)
                .collect::<Result<Vec<_>>>()?,
            PredictionLevel::Target | PredictionLevel::Group => payload
                .aggregated_blocks
                .iter()
                .map(ColumnarPredictionCacheBlock::from_aggregated_prediction_block)
                .collect::<Result<Vec<_>>>()?,
            PredictionLevel::Observation => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction cache payload `{}` cannot use observation-level predictions",
                    payload.cache_id
                )));
            }
        };
        let entry = Self { cache, blocks };
        entry.validate()?;
        Ok(entry)
    }

    fn validate(&self) -> Result<()> {
        self.cache.validate()?;
        if self.blocks.len() != self.cache.block_count {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache `{}` has {} block(s), expected {}",
                self.cache.cache_id,
                self.blocks.len(),
                self.cache.block_count
            )));
        }
        let mut row_count = 0usize;
        let mut value_count = 0usize;
        for block in &self.blocks {
            block.validate()?;
            if block.prediction_level != self.cache.prediction_level {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction cache `{}` contains a {:?} block, expected {:?}",
                    self.cache.cache_id, block.prediction_level, self.cache.prediction_level
                )));
            }
            if block.partition != self.cache.partition {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction cache `{}` contains a block from partition {:?}",
                    self.cache.cache_id, block.partition
                )));
            }
            row_count += block.row_count();
            value_count += block.value_count();
        }
        if row_count != self.cache.row_count {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache `{}` has {} row(s), expected {}",
                self.cache.cache_id, row_count, self.cache.row_count
            )));
        }
        let expected_values = self
            .cache
            .row_count
            .checked_mul(self.cache.prediction_width)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "columnar prediction cache `{}` value count overflow",
                    self.cache.cache_id
                ))
            })?;
        if value_count != expected_values {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache `{}` has {} value(s), expected {}",
                self.cache.cache_id, value_count, expected_values
            )));
        }
        Ok(())
    }

    fn to_blocks(&self) -> Result<Vec<PredictionBlock>> {
        self.validate()?;
        self.blocks
            .iter()
            .map(ColumnarPredictionCacheBlock::to_prediction_block)
            .collect()
    }

    fn to_aggregated_blocks(&self) -> Result<Vec<AggregatedPredictionBlock>> {
        self.validate()?;
        self.blocks
            .iter()
            .map(ColumnarPredictionCacheBlock::to_aggregated_prediction_block)
            .collect()
    }

    fn validate_against_cache_record(&self, cache: &BundlePredictionCacheRecord) -> Result<()> {
        if &self.cache != cache {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache materialization request for `{}` does not match bundle cache record",
                cache.requirement_key
            )));
        }
        let (blocks, aggregated_blocks) = match self.cache.prediction_level {
            PredictionLevel::Sample => (self.to_blocks()?, Vec::new()),
            PredictionLevel::Target | PredictionLevel::Group => {
                (Vec::new(), self.to_aggregated_blocks()?)
            }
            PredictionLevel::Observation => {
                return Err(DagMlError::RuntimeValidation(format!(
                    "columnar prediction cache `{}` cannot materialize observation-level predictions",
                    self.cache.cache_id
                )));
            }
        };
        let payload = BundlePredictionCachePayload {
            requirement_key: self.cache.requirement_key.clone(),
            cache_id: self.cache.cache_id.clone(),
            cache_namespace_fingerprints: self.cache.cache_namespace_fingerprints.clone(),
            format: self.cache.format.clone(),
            partition: self.cache.partition.clone(),
            prediction_level: self.cache.prediction_level,
            block_count: self.cache.block_count,
            row_count: self.cache.row_count,
            content_fingerprint: self.cache.content_fingerprint.clone(),
            blocks,
            aggregated_blocks,
        };
        validate_prediction_cache_payload_matches_record(&payload, cache)
    }

    fn manifest(&self) -> ColumnarPredictionCacheManifest {
        let value_count = self
            .blocks
            .iter()
            .map(ColumnarPredictionCacheBlock::value_count)
            .sum::<usize>();
        ColumnarPredictionCacheManifest {
            requirement_key: self.cache.requirement_key.clone(),
            cache_id: self.cache.cache_id.clone(),
            cache_namespace_fingerprints: self.cache.cache_namespace_fingerprints.clone(),
            prediction_level: self.cache.prediction_level,
            block_count: self.cache.block_count,
            row_count: self.cache.row_count,
            prediction_width: self.cache.prediction_width,
            value_count,
            estimated_value_bytes: value_count * std::mem::size_of::<f64>(),
            content_fingerprint: self.cache.content_fingerprint.clone(),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ColumnarPredictionCacheStore {
    entries: BTreeMap<String, ColumnarPredictionCacheEntry>,
    materialization_records: RefCell<Vec<PredictionCacheMaterializationRecord>>,
}

impl ColumnarPredictionCacheStore {
    pub fn from_payloads(
        bundle: &ExecutionBundle,
        payloads: BundlePredictionCachePayloadSet,
    ) -> Result<Self> {
        payloads.validate_against_bundle(bundle)?;
        let records_by_requirement = bundle
            .prediction_caches
            .iter()
            .cloned()
            .map(|cache| (cache.requirement_key.clone(), cache))
            .collect::<BTreeMap<_, _>>();
        let mut entries = BTreeMap::new();
        for payload in payloads.caches {
            let cache = records_by_requirement
                .get(&payload.requirement_key)
                .cloned()
                .ok_or_else(|| {
                    DagMlError::RuntimeValidation(format!(
                        "columnar prediction cache payload `{}` references unknown requirement `{}`",
                        payload.cache_id, payload.requirement_key
                    ))
                })?;
            let requirement_key = payload.requirement_key.clone();
            let previous = entries.insert(
                requirement_key,
                ColumnarPredictionCacheEntry::from_payload(payload, cache)?,
            );
            debug_assert!(previous.is_none());
        }
        Ok(Self {
            entries,
            materialization_records: RefCell::new(Vec::new()),
        })
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    pub fn manifests(&self) -> Vec<ColumnarPredictionCacheManifest> {
        self.entries
            .values()
            .map(ColumnarPredictionCacheEntry::manifest)
            .collect()
    }

    pub fn materialization_records(&self) -> Vec<PredictionCacheMaterializationRecord> {
        self.materialization_records.borrow().clone()
    }
}

impl RuntimePredictionCacheStore for ColumnarPredictionCacheStore {
    fn load_blocks(&self, requirement_key: &str) -> Result<Vec<PredictionBlock>> {
        let entry = self.entries.get(requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "columnar prediction cache store is missing requirement `{requirement_key}`"
            ))
        })?;
        if entry.cache.prediction_level != PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache store requirement `{requirement_key}` contains {:?} predictions, not sample blocks",
                entry.cache.prediction_level
            )));
        }
        entry.validate_against_cache_record(&entry.cache)?;
        entry.to_blocks()
    }

    fn load_aggregated_blocks(
        &self,
        requirement_key: &str,
    ) -> Result<Vec<AggregatedPredictionBlock>> {
        let entry = self.entries.get(requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "columnar prediction cache store is missing requirement `{requirement_key}`"
            ))
        })?;
        if entry.cache.prediction_level == PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache store requirement `{requirement_key}` contains sample predictions, not aggregated blocks"
            )));
        }
        entry.validate_against_cache_record(&entry.cache)?;
        entry.to_aggregated_blocks()
    }

    fn materialize(&self, request: &PredictionCacheMaterializationRequest) -> Result<HandleRef> {
        request.requirement.validate()?;
        request.cache.validate()?;
        let requirement_key = request.requirement.key();
        if requirement_key != request.cache.requirement_key {
            return Err(DagMlError::RuntimeValidation(format!(
                "columnar prediction cache materialization request for `{}` uses cache `{}` with mismatched requirement `{}`",
                requirement_key, request.cache.cache_id, request.cache.requirement_key
            )));
        }
        let entry = self.entries.get(&requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "columnar prediction cache store is missing requirement `{requirement_key}`"
            ))
        })?;
        entry.validate_against_cache_record(&request.cache)?;
        let handle = prediction_cache_materialization_handle(request)?;
        self.materialization_records
            .borrow_mut()
            .push(prediction_cache_materialization_record(
                request,
                handle.clone(),
            )?);
        Ok(handle)
    }
}

pub(crate) fn validate_runtime_non_empty(label: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(format!("{label} is empty")));
    }
    Ok(())
}

pub(crate) fn validate_artifact_optional_text(
    label: &str,
    value: &Option<String>,
    artifact_id: &ArtifactId,
) -> Result<()> {
    let Some(value) = value else {
        return Ok(());
    };
    if value.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` has empty {label}"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` has control characters in {label}"
        )));
    }
    Ok(())
}

pub(crate) fn artifact_payload_path(root: &Path, artifact: &ArtifactRef) -> Result<PathBuf> {
    artifact.validate_portable()?;
    let uri = artifact
        .uri
        .as_deref()
        .expect("portable artifact validation requires uri");
    Ok(root.join(uri))
}

pub(crate) fn validate_artifact_payload_file(
    root: &Path,
    artifact: &ArtifactRef,
) -> Result<ArtifactPayloadMetadata> {
    artifact.validate_portable()?;
    let uri = artifact
        .uri
        .as_deref()
        .expect("portable artifact validation requires uri")
        .to_string();
    let path = artifact_payload_path(root, artifact)?;
    validate_payload_path_stays_within_root(root, &path, artifact)?;
    let metadata = fs::metadata(&path).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to stat artifact payload `{}` at {}: {err}",
            artifact.id,
            path.display()
        ))
    })?;
    if !metadata.is_file() {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact payload `{}` at {} is not a regular file",
            artifact.id,
            path.display()
        )));
    }
    let size_bytes = metadata.len();
    if let Some(expected_size) = artifact.size_bytes {
        if expected_size != size_bytes {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact payload `{}` size mismatch: expected {}, got {}",
                artifact.id, expected_size, size_bytes
            )));
        }
    }
    let content_fingerprint =
        sha256_file_hex(&path, &format!("artifact payload `{}`", artifact.id))?;
    let expected_fingerprint = artifact
        .content_fingerprint
        .as_deref()
        .expect("portable artifact validation requires content_fingerprint");
    if !content_fingerprint.eq_ignore_ascii_case(expected_fingerprint) {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact payload `{}` content fingerprint mismatch",
            artifact.id
        )));
    }
    Ok(ArtifactPayloadMetadata {
        uri,
        content_fingerprint,
        size_bytes,
    })
}

pub(crate) fn validate_payload_path_stays_within_root(
    root: &Path,
    path: &Path,
    artifact: &ArtifactRef,
) -> Result<()> {
    let root = fs::canonicalize(root).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to canonicalize artifact payload root `{}`: {err}",
            root.display()
        ))
    })?;
    let path = fs::canonicalize(path).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to canonicalize artifact payload `{}` at {}: {err}",
            artifact.id,
            path.display()
        ))
    })?;
    if !path.starts_with(&root) {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact payload `{}` resolves outside store root `{}`",
            artifact.id,
            root.display()
        )));
    }
    Ok(())
}

pub(crate) fn sha256_file_hex(path: &Path, label: &str) -> Result<String> {
    let mut file = fs::File::open(path).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to open {label} at {}: {err}",
            path.display()
        ))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|err| {
            DagMlError::RuntimeValidation(format!(
                "failed to read {label} at {}: {err}",
                path.display()
            ))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(bytes_to_hex(&hasher.finalize()))
}

#[cfg(test)]
pub(crate) fn sha256_bytes_hex(bytes: &[u8]) -> String {
    bytes_to_hex(&Sha256::digest(bytes))
}

pub(crate) fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut out, "{byte:02x}").expect("writing to String cannot fail");
    }
    out
}

/// Deterministic path safety for relative artifact URIs. Rejects empty values,
/// control characters, absolute paths (POSIX root, Windows root or drive
/// prefix), URI schemes such as `http://`, `s3://` or `file://` (any colon in
/// the leading path segment) and any `..` traversal component. Parsing is
/// platform-independent so portable manifests validate identically everywhere;
/// it adds no dependency.
pub(crate) fn validate_relative_artifact_uri(artifact_id: &ArtifactId, uri: &str) -> Result<()> {
    if uri.is_empty() {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` has empty uri"
        )));
    }
    if uri.chars().any(char::is_control) {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` uri has control characters"
        )));
    }
    if uri.starts_with('/') || uri.starts_with('\\') {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` uri `{uri}` must be a relative path"
        )));
    }
    let mut prefix = uri.chars();
    if let (Some(drive), Some(':')) = (prefix.next(), prefix.next()) {
        if drive.is_ascii_alphabetic() {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{artifact_id}` uri `{uri}` must be a relative path"
            )));
        }
    }
    // Reject URI schemes (`http://`, `s3://`, `file://`, ...) and any other
    // colon in the leading path segment. A scheme always places a colon in the
    // first segment, so a strictly relative artifact path never carries one.
    let first_segment = uri.split(['/', '\\']).next().unwrap_or(uri);
    if first_segment.contains(':') {
        return Err(DagMlError::RuntimeValidation(format!(
            "artifact `{artifact_id}` uri `{uri}` must not include a scheme or colon in its first path segment"
        )));
    }
    for segment in uri.split(['/', '\\']) {
        if segment == ".." {
            return Err(DagMlError::RuntimeValidation(format!(
                "artifact `{artifact_id}` uri `{uri}` must not contain `..` components"
            )));
        }
    }
    Ok(())
}

pub(crate) fn validate_runtime_fingerprint(label: &str, value: &str) -> Result<()> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(DagMlError::RuntimeValidation(format!(
            "{label} fingerprint must be a 64-character hex digest"
        )));
    }
    Ok(())
}

pub(crate) fn read_runtime_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    label: &str,
) -> Result<T> {
    let data = fs::read(path).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to read {label} at {}: {err}",
            path.display()
        ))
    })?;
    serde_json::from_slice(&data).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to parse {label} at {}: {err}",
            path.display()
        ))
    })
}

pub(crate) fn write_runtime_json<T: Serialize>(path: &Path, value: &T, label: &str) -> Result<()> {
    let mut data = serde_json::to_vec_pretty(value).map_err(|err| {
        DagMlError::RuntimeValidation(format!("failed to serialize {label}: {err}"))
    })?;
    data.push(b'\n');
    fs::write(path, data).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to write {label} at {}: {err}",
            path.display()
        ))
    })
}
#[derive(Clone, Debug, Default)]
pub struct InMemoryPredictionCacheStore {
    payloads: BTreeMap<String, crate::bundle::BundlePredictionCachePayload>,
    materialization_records: RefCell<Vec<PredictionCacheMaterializationRecord>>,
}

impl InMemoryPredictionCacheStore {
    pub fn from_payloads(
        bundle: &ExecutionBundle,
        payloads: BundlePredictionCachePayloadSet,
    ) -> Result<Self> {
        payloads.validate_against_bundle(bundle)?;
        Ok(Self {
            payloads: payloads
                .caches
                .into_iter()
                .map(|payload| (payload.requirement_key.clone(), payload))
                .collect(),
            materialization_records: RefCell::new(Vec::new()),
        })
    }

    pub fn payload_count(&self) -> usize {
        self.payloads.len()
    }

    pub fn materialization_records(&self) -> Vec<PredictionCacheMaterializationRecord> {
        self.materialization_records.borrow().clone()
    }
}

impl RuntimePredictionCacheStore for InMemoryPredictionCacheStore {
    fn load_blocks(&self, requirement_key: &str) -> Result<Vec<PredictionBlock>> {
        let payload = self.payloads.get(requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache store is missing requirement `{requirement_key}`"
            ))
        })?;
        payload.validate()?;
        if payload.prediction_level != PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache store requirement `{requirement_key}` contains {:?} predictions, not sample blocks",
                payload.prediction_level
            )));
        }
        Ok(payload.blocks.clone())
    }

    fn load_aggregated_blocks(
        &self,
        requirement_key: &str,
    ) -> Result<Vec<AggregatedPredictionBlock>> {
        let payload = self.payloads.get(requirement_key).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "prediction cache store is missing requirement `{requirement_key}`"
            ))
        })?;
        payload.validate()?;
        if payload.prediction_level == PredictionLevel::Sample {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache store requirement `{requirement_key}` contains sample predictions, not aggregated blocks"
            )));
        }
        Ok(payload.aggregated_blocks.clone())
    }

    fn materialize(&self, request: &PredictionCacheMaterializationRequest) -> Result<HandleRef> {
        request.requirement.validate()?;
        request.cache.validate()?;
        if request.requirement.key() != request.cache.requirement_key {
            return Err(DagMlError::RuntimeValidation(format!(
                "prediction cache materialization request for `{}` uses cache `{}` with mismatched requirement `{}`",
                request.requirement.key(),
                request.cache.cache_id,
                request.cache.requirement_key
            )));
        }
        let payload = self
            .payloads
            .get(&request.cache.requirement_key)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "prediction cache store is missing requirement `{}`",
                    request.cache.requirement_key
                ))
            })?;
        validate_prediction_cache_payload_matches_record(payload, &request.cache)?;
        let handle = prediction_cache_materialization_handle(request)?;
        self.materialization_records
            .borrow_mut()
            .push(prediction_cache_materialization_record(
                request,
                handle.clone(),
            )?);
        Ok(handle)
    }
}
