use std::collections::{BTreeMap, BTreeSet};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::bundle::ExecutionBundle;
use crate::data::ExternalDataPlanEnvelope;
use crate::error::{DagMlError, Result};
use crate::ids::{ArtifactId, LineageId};
use crate::plan::ExecutionPlan;
use crate::runtime::{
    FileArtifactManifest, FilePredictionCacheManifest, LineageRecord, FILE_ARTIFACT_MANIFEST_FILE,
    FILE_PREDICTION_CACHE_MANIFEST_FILE,
};

pub const RESEARCH_PROVENANCE_SCHEMA_VERSION: u32 = 1;
pub const EXECUTION_PLAN_FILE: &str = "execution_plan.json";
pub const EXECUTION_BUNDLE_FILE: &str = "execution_bundle.json";
pub const LINEAGE_RECORDS_FILE: &str = "lineage_records.json";
pub const PROV_JSONLD_FILE: &str = "lineage.prov.jsonld";
pub const RO_CRATE_METADATA_FILE: &str = "ro-crate-metadata.json";
pub const OPENLINEAGE_RUN_EVENT_SCHEMA_URL: &str =
    "https://openlineage.io/spec/1-0-0/OpenLineage.json#/definitions/RunEvent";
pub const DAGML_OPENLINEAGE_FACET_SCHEMA_URL: &str =
    "https://github.com/GBeurier/dag-ml/schemas/openlineage_dagml_facets.v1.schema.json";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ResearchProvenanceExport {
    pub schema_version: u32,
    pub prov_jsonld: Value,
    pub ro_crate_metadata: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchProvenancePackage {
    pub schema_version: u32,
    pub files: BTreeMap<String, ResearchProvenancePackageFile>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchProvenancePackageFile {
    pub path: String,
    pub sha256: String,
    pub size_bytes: usize,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ResearchProvenancePackageValidation {
    pub schema_version: u32,
    pub plan_id: String,
    pub bundle_id: String,
    pub file_count: usize,
    pub checksummed_file_count: usize,
    pub lineage_record_count: usize,
    pub data_envelope_count: usize,
    pub has_prediction_cache_manifest: bool,
    pub has_artifact_manifest: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenLineageRunEventOptions {
    pub namespace: String,
    pub event_time: String,
}

pub fn build_research_provenance_export(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Result<ResearchProvenanceExport> {
    validate_provenance_inputs(
        plan,
        bundle,
        lineage,
        data_envelopes,
        prediction_cache_manifest,
        artifact_manifest,
    )?;

    Ok(ResearchProvenanceExport {
        schema_version: RESEARCH_PROVENANCE_SCHEMA_VERSION,
        prov_jsonld: build_prov_jsonld(
            plan,
            bundle,
            lineage,
            data_envelopes,
            prediction_cache_manifest,
            artifact_manifest,
        )?,
        ro_crate_metadata: build_ro_crate_metadata(
            plan,
            bundle,
            data_envelopes,
            prediction_cache_manifest,
            artifact_manifest,
        )?,
    })
}

pub fn build_research_provenance_package(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Result<ResearchProvenancePackage> {
    let export = build_research_provenance_export(
        plan,
        bundle,
        lineage,
        data_envelopes,
        prediction_cache_manifest,
        artifact_manifest,
    )?;
    let mut files = BTreeMap::new();
    add_json_package_file(&mut files, EXECUTION_PLAN_FILE, plan, "execution plan")?;
    add_json_package_file(
        &mut files,
        EXECUTION_BUNDLE_FILE,
        bundle,
        "execution bundle",
    )?;
    add_json_package_file(
        &mut files,
        LINEAGE_RECORDS_FILE,
        &lineage,
        "lineage records",
    )?;
    add_json_package_file(
        &mut files,
        PROV_JSONLD_FILE,
        &export.prov_jsonld,
        "PROV JSON-LD",
    )?;
    if let Some(manifest) = prediction_cache_manifest {
        add_json_package_file(
            &mut files,
            FILE_PREDICTION_CACHE_MANIFEST_FILE,
            manifest,
            "prediction cache manifest",
        )?;
    }
    if let Some(manifest) = artifact_manifest {
        add_json_package_file(
            &mut files,
            FILE_ARTIFACT_MANIFEST_FILE,
            manifest,
            "artifact manifest",
        )?;
    }
    for (key, envelope) in data_envelopes {
        add_json_package_file(
            &mut files,
            &data_envelope_file_path(key)?,
            envelope,
            "data envelope",
        )?;
    }

    let mut ro_crate_metadata = export.ro_crate_metadata;
    annotate_ro_crate_package_files(&mut ro_crate_metadata, &files)?;
    add_json_package_file(
        &mut files,
        RO_CRATE_METADATA_FILE,
        &ro_crate_metadata,
        "RO-Crate metadata",
    )?;

    Ok(ResearchProvenancePackage {
        schema_version: RESEARCH_PROVENANCE_SCHEMA_VERSION,
        files,
    })
}

pub fn validate_research_provenance_package_files(
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<ResearchProvenancePackageValidation> {
    if files.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "research provenance package has no files".to_string(),
        ));
    }
    for path in files.keys() {
        validate_package_path(path)?;
    }
    require_package_file(files, EXECUTION_PLAN_FILE)?;
    require_package_file(files, EXECUTION_BUNDLE_FILE)?;
    require_package_file(files, LINEAGE_RECORDS_FILE)?;
    require_package_file(files, PROV_JSONLD_FILE)?;
    let ro_crate_metadata: Value = parse_package_json(
        require_package_file(files, RO_CRATE_METADATA_FILE)?,
        RO_CRATE_METADATA_FILE,
    )?;

    let checksummed_file_count = validate_ro_crate_package_checksums(&ro_crate_metadata, files)?;
    validate_prov_jsonld_root(parse_package_json(
        require_package_file(files, PROV_JSONLD_FILE)?,
        PROV_JSONLD_FILE,
    )?)?;

    let plan: ExecutionPlan = parse_package_json(
        require_package_file(files, EXECUTION_PLAN_FILE)?,
        EXECUTION_PLAN_FILE,
    )?;
    let bundle: ExecutionBundle = parse_package_json(
        require_package_file(files, EXECUTION_BUNDLE_FILE)?,
        EXECUTION_BUNDLE_FILE,
    )?;
    let lineage: Vec<LineageRecord> = parse_package_json(
        require_package_file(files, LINEAGE_RECORDS_FILE)?,
        LINEAGE_RECORDS_FILE,
    )?;
    let data_envelopes = parse_package_data_envelopes(files)?;
    let prediction_cache_manifest: Option<FilePredictionCacheManifest> = files
        .get(FILE_PREDICTION_CACHE_MANIFEST_FILE)
        .map(|bytes| parse_package_json(bytes, FILE_PREDICTION_CACHE_MANIFEST_FILE))
        .transpose()?;
    let artifact_manifest: Option<FileArtifactManifest> = files
        .get(FILE_ARTIFACT_MANIFEST_FILE)
        .map(|bytes| parse_package_json(bytes, FILE_ARTIFACT_MANIFEST_FILE))
        .transpose()?;

    validate_provenance_inputs(
        &plan,
        &bundle,
        &lineage,
        &data_envelopes,
        prediction_cache_manifest.as_ref(),
        artifact_manifest.as_ref(),
    )?;

    Ok(ResearchProvenancePackageValidation {
        schema_version: RESEARCH_PROVENANCE_SCHEMA_VERSION,
        plan_id: plan.id.to_string(),
        bundle_id: bundle.bundle_id.to_string(),
        file_count: files.len(),
        checksummed_file_count,
        lineage_record_count: lineage.len(),
        data_envelope_count: data_envelopes.len(),
        has_prediction_cache_manifest: prediction_cache_manifest.is_some(),
        has_artifact_manifest: artifact_manifest.is_some(),
    })
}

pub fn build_openlineage_run_event_from_package_files(
    files: &BTreeMap<String, Vec<u8>>,
    namespace: &str,
    event_time: &str,
) -> Result<Value> {
    validate_research_provenance_package_files(files)?;
    let plan: ExecutionPlan = parse_package_json(
        require_package_file(files, EXECUTION_PLAN_FILE)?,
        EXECUTION_PLAN_FILE,
    )?;
    let bundle: ExecutionBundle = parse_package_json(
        require_package_file(files, EXECUTION_BUNDLE_FILE)?,
        EXECUTION_BUNDLE_FILE,
    )?;
    let lineage: Vec<LineageRecord> = parse_package_json(
        require_package_file(files, LINEAGE_RECORDS_FILE)?,
        LINEAGE_RECORDS_FILE,
    )?;
    let data_envelopes = parse_package_data_envelopes(files)?;
    let prediction_cache_manifest: Option<FilePredictionCacheManifest> = files
        .get(FILE_PREDICTION_CACHE_MANIFEST_FILE)
        .map(|bytes| parse_package_json(bytes, FILE_PREDICTION_CACHE_MANIFEST_FILE))
        .transpose()?;
    let artifact_manifest: Option<FileArtifactManifest> = files
        .get(FILE_ARTIFACT_MANIFEST_FILE)
        .map(|bytes| parse_package_json(bytes, FILE_ARTIFACT_MANIFEST_FILE))
        .transpose()?;
    let options = OpenLineageRunEventOptions {
        namespace: namespace.to_string(),
        event_time: event_time.to_string(),
    };

    build_openlineage_run_event(
        &plan,
        &bundle,
        &lineage,
        &data_envelopes,
        prediction_cache_manifest.as_ref(),
        artifact_manifest.as_ref(),
        &options,
    )
}

pub fn build_openlineage_run_event(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
    options: &OpenLineageRunEventOptions,
) -> Result<Value> {
    validate_provenance_inputs(
        plan,
        bundle,
        lineage,
        data_envelopes,
        prediction_cache_manifest,
        artifact_manifest,
    )?;
    validate_openlineage_namespace(options.namespace.as_str())?;
    validate_openlineage_event_time(options.event_time.as_str())?;

    Ok(json!({
        "eventType": "COMPLETE",
        "eventTime": options.event_time.as_str(),
        "run": {
            "runId": openlineage_run_id(plan, bundle),
            "facets": {
                "dagml_reproducibility": dagml_openlineage_reproducibility_run_facet(plan, bundle),
                "dagml_oof_safety": dagml_openlineage_oof_safety_run_facet(bundle, lineage),
            },
        },
        "job": {
            "namespace": options.namespace.as_str(),
            "name": format!("{}::{}", plan.id, bundle.bundle_id),
            "facets": {
                "dagml_plan": dagml_openlineage_plan_job_facet(plan, bundle),
            },
        },
        "inputs": openlineage_input_datasets(bundle, data_envelopes),
        "outputs": openlineage_output_datasets(bundle, prediction_cache_manifest, artifact_manifest),
        "producer": "https://github.com/GBeurier/dag-ml",
        "schemaURL": OPENLINEAGE_RUN_EVENT_SCHEMA_URL,
    }))
}

fn validate_provenance_inputs(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Result<()> {
    plan.validate()?;
    bundle.validate_against_plan(plan)?;
    if !data_envelopes.is_empty() {
        bundle.validate_replay_envelopes(data_envelopes)?;
    }
    if let Some(manifest) = prediction_cache_manifest {
        manifest.validate_against_bundle(bundle)?;
    }
    if let Some(manifest) = artifact_manifest {
        manifest.validate_against_bundle(bundle)?;
    }

    let mut lineage_ids = BTreeSet::<&LineageId>::new();
    for record in lineage {
        record.validate()?;
        if !plan.node_plans.contains_key(&record.node_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "provenance lineage `{}` references unknown node `{}`",
                record.record_id, record.node_id
            )));
        }
        if !plan
            .controller_manifests
            .contains_key(&record.controller_id)
        {
            return Err(DagMlError::RuntimeValidation(format!(
                "provenance lineage `{}` references unknown controller `{}`",
                record.record_id, record.controller_id
            )));
        }
        if !lineage_ids.insert(&record.record_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate provenance lineage record `{}`",
                record.record_id
            )));
        }
    }
    for record in lineage {
        for input_id in &record.input_lineage {
            if !lineage_ids.contains(input_id) {
                return Err(DagMlError::RuntimeValidation(format!(
                    "provenance lineage `{}` references missing input lineage `{}`",
                    record.record_id, input_id
                )));
            }
        }
    }
    Ok(())
}

fn build_prov_jsonld(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Result<Value> {
    let plan_entity_id = format!("dagml:execution-plan:{}", plan.id);
    let bundle_entity_id = format!("dagml:execution-bundle:{}", bundle.bundle_id);
    let packaging_activity_id = format!("dagml:activity:package-bundle:{}", bundle.bundle_id);
    let coordinator_agent_id = "dagml:agent:dag-ml".to_string();

    let mut entity = BTreeMap::<String, Value>::new();
    entity.insert(
        plan_entity_id.clone(),
        json!({
            "prov:type": ["prov:Entity", "dagml:ExecutionPlan"],
            "dagml:plan_id": plan.id,
            "dagml:graph_fingerprint": plan.graph_fingerprint,
            "dagml:campaign_fingerprint": plan.campaign_fingerprint,
            "dagml:controller_fingerprint": plan.controller_fingerprint,
            "dagml:variant_count": plan.variants.len(),
            "dagml:has_fold_set": plan.fold_set.is_some(),
        }),
    );
    entity.insert(
        bundle_entity_id.clone(),
        json!({
            "prov:type": ["prov:Entity", "dagml:ExecutionBundle"],
            "dagml:bundle_id": bundle.bundle_id,
            "dagml:schema_version": bundle.schema_version,
            "dagml:plan_id": bundle.plan_id,
            "dagml:selected_variant_id": bundle.selected_variant_id,
            "dagml:graph_fingerprint": bundle.graph_fingerprint,
            "dagml:campaign_fingerprint": bundle.campaign_fingerprint,
            "dagml:controller_fingerprint": bundle.controller_fingerprint,
            "dagml:unsafe_flags": bundle.unsafe_flags,
            "dagml:selection_count": bundle.selections.len(),
        }),
    );

    for requirement in &bundle.data_requirements {
        let key = requirement.key();
        entity.insert(
            data_requirement_entity_id(&key),
            json!({
                "prov:type": ["prov:Entity", "dagml:DataRequirement"],
                "dagml:requirement_key": key,
                "dagml:node_id": requirement.node_id,
                "dagml:input_name": requirement.input_name,
                "dagml:schema_fingerprint": requirement.schema_fingerprint,
                "dagml:plan_fingerprint": requirement.plan_fingerprint,
                "dagml:relation_fingerprint": requirement.relation_fingerprint,
                "dagml:feature_set_id": requirement.feature_set_id,
            }),
        );
    }
    for (key, envelope) in data_envelopes {
        entity.insert(
            data_envelope_entity_id(key),
            json!({
                "prov:type": ["prov:Entity", "dagml:ExternalDataPlanEnvelope"],
                "dagml:envelope_key": key,
                "dagml:schema_version": envelope.schema_version,
                "dagml:schema_fingerprint": envelope.schema_fingerprint,
                "dagml:plan_fingerprint": envelope.plan_fingerprint,
                "dagml:relation_fingerprint": envelope.relation_fingerprint,
            }),
        );
    }
    for requirement in &bundle.prediction_requirements {
        let key = requirement.key();
        entity.insert(
            prediction_requirement_entity_id(&key),
            json!({
                "prov:type": ["prov:Entity", "dagml:PredictionRequirement"],
                "dagml:requirement_key": key,
                "dagml:producer_node": requirement.producer_node,
                "dagml:consumer_node": requirement.consumer_node,
                "dagml:prediction_level": requirement.prediction_level,
                "dagml:fold_ids": requirement.fold_ids,
                "dagml:unit_ids": requirement.unit_ids,
                "dagml:sample_ids": requirement.sample_ids,
                "dagml:prediction_width": requirement.prediction_width,
                "dagml:target_names": requirement.target_names,
            }),
        );
    }
    for cache in &bundle.prediction_caches {
        entity.insert(
            prediction_cache_entity_id(&cache.cache_id),
            json!({
                "prov:type": ["prov:Entity", "dagml:PredictionCache"],
                "dagml:requirement_key": cache.requirement_key,
                "dagml:cache_id": cache.cache_id,
                "dagml:format": cache.format,
                "dagml:prediction_level": cache.prediction_level,
                "dagml:unit_ids": cache.unit_ids,
                "dagml:block_count": cache.block_count,
                "dagml:row_count": cache.row_count,
                "dagml:content_fingerprint": cache.content_fingerprint,
            }),
        );
    }
    if let Some(manifest) = prediction_cache_manifest {
        entity.insert(
            "dagml:file:prediction-cache-manifest".to_string(),
            json!({
                "prov:type": ["prov:Entity", "dagml:PredictionCacheManifest"],
                "dagml:file": FILE_PREDICTION_CACHE_MANIFEST_FILE,
                "dagml:schema_version": manifest.schema_version,
                "dagml:cache_count": manifest.caches.len(),
            }),
        );
    }
    for record in &bundle.refit_artifacts {
        entity.insert(
            artifact_entity_id(&record.artifact.id),
            json!({
                "prov:type": ["prov:Entity", "dagml:ModelArtifact"],
                "dagml:artifact_id": record.artifact.id,
                "dagml:kind": record.artifact.kind,
                "dagml:node_id": record.node_id,
                "dagml:controller_id": record.controller_id,
                "dagml:backend": record.artifact.backend,
                "dagml:uri": record.artifact.uri,
                "dagml:content_fingerprint": record.artifact.content_fingerprint,
                "dagml:size_bytes": record.artifact.size_bytes,
                "dagml:plugin": record.artifact.plugin,
                "dagml:plugin_version": record.artifact.plugin_version,
                "dagml:params_fingerprint": record.params_fingerprint,
                "dagml:training_loss_fingerprint": record.training_loss_fingerprint,
                "dagml:data_requirement_keys": record.data_requirement_keys,
                "dagml:prediction_requirement_keys": record.prediction_requirement_keys,
            }),
        );
    }
    if let Some(manifest) = artifact_manifest {
        entity.insert(
            "dagml:file:artifact-manifest".to_string(),
            json!({
                "prov:type": ["prov:Entity", "dagml:ArtifactManifest"],
                "dagml:file": FILE_ARTIFACT_MANIFEST_FILE,
                "dagml:schema_version": manifest.schema_version,
                "dagml:artifact_count": manifest.artifacts.len(),
            }),
        );
    }
    for record in lineage {
        entity.insert(
            lineage_record_entity_id(&record.record_id),
            json!({
                "prov:type": ["prov:Entity", "dagml:LineageRecord"],
                "dagml:lineage_id": record.record_id,
                "dagml:run_id": record.run_id,
                "dagml:node_id": record.node_id,
                "dagml:phase": record.phase,
                "dagml:controller_id": record.controller_id,
                "dagml:variant_id": record.variant_id,
                "dagml:fold_id": record.fold_id,
                "dagml:branch_path": record.branch_path,
                "dagml:input_lineage": record.input_lineage,
                "dagml:artifact_refs": record
                    .artifact_refs
                    .iter()
                    .map(|artifact| artifact.id.clone())
                    .collect::<Vec<_>>(),
            }),
        );
    }

    let mut agent = BTreeMap::<String, Value>::new();
    agent.insert(
        coordinator_agent_id.clone(),
        json!({
            "prov:type": ["prov:Agent", "dagml:Coordinator"],
            "dagml:name": "dag-ml",
            "dagml:provenance_schema_version": RESEARCH_PROVENANCE_SCHEMA_VERSION,
        }),
    );
    for manifest in plan.controller_manifests.values() {
        agent.insert(
            controller_agent_id(manifest.controller_id.as_str()),
            json!({
                "prov:type": ["prov:Agent", "dagml:Controller"],
                "dagml:controller_id": manifest.controller_id,
                "dagml:controller_version": manifest.controller_version,
                "dagml:operator_kind": manifest.operator_kind,
                "dagml:fit_scope": manifest.fit_scope,
                "dagml:rng_policy": manifest.rng_policy,
                "dagml:artifact_policy": manifest.artifact_policy,
                "dagml:capabilities": manifest.capabilities,
            }),
        );
    }

    let mut activity = BTreeMap::<String, Value>::new();
    activity.insert(
        packaging_activity_id.clone(),
        json!({
            "prov:type": ["prov:Activity", "dagml:BundlePackaging"],
            "dagml:bundle_id": bundle.bundle_id,
            "dagml:plan_id": bundle.plan_id,
            "dagml:selected_variant_id": bundle.selected_variant_id,
        }),
    );
    for record in lineage {
        activity.insert(
            lineage_activity_id(record),
            json!({
                "prov:type": ["prov:Activity", "dagml:NodeExecution"],
                "dagml:lineage_id": record.record_id,
                "dagml:run_id": record.run_id,
                "dagml:node_id": record.node_id,
                "dagml:phase": record.phase,
                "dagml:controller_id": record.controller_id,
                "dagml:controller_version": record.controller_version,
                "dagml:variant_id": record.variant_id,
                "dagml:fold_id": record.fold_id,
                "dagml:branch_path": record.branch_path,
                "dagml:params_fingerprint": record.params_fingerprint,
                "dagml:data_model_shape_fingerprint": record.data_model_shape_fingerprint,
                "dagml:aggregation_policy_fingerprint": record.aggregation_policy_fingerprint,
                "dagml:seed": record.seed,
                "dagml:unsafe_flags": record.unsafe_flags,
                "dagml:metrics": record.metrics,
                "dagml:loss_attestations": record.loss_attestations,
            }),
        );
    }

    let mut used = BTreeMap::<String, Value>::new();
    used.insert(
        "dagml:used:bundle-plan".to_string(),
        json!({
            "prov:activity": packaging_activity_id,
            "prov:entity": plan_entity_id,
        }),
    );
    for record in lineage {
        for input_id in &record.input_lineage {
            used.insert(
                format!("dagml:used:{}:{}", record.record_id, input_id),
                json!({
                    "prov:activity": lineage_activity_id(record),
                    "prov:entity": lineage_record_entity_id(input_id),
                    "dagml:input_lineage_id": input_id,
                }),
            );
        }
    }

    let lineage_by_artifact = lineage_artifact_index(lineage);
    let mut was_generated_by = BTreeMap::<String, Value>::new();
    was_generated_by.insert(
        "dagml:generated:bundle".to_string(),
        json!({
            "prov:entity": bundle_entity_id,
            "prov:activity": packaging_activity_id,
        }),
    );
    for record in lineage {
        was_generated_by.insert(
            format!("dagml:generated:lineage:{}", record.record_id),
            json!({
                "prov:entity": lineage_record_entity_id(&record.record_id),
                "prov:activity": lineage_activity_id(record),
            }),
        );
    }
    for record in &bundle.refit_artifacts {
        let activity_id = lineage_by_artifact
            .get(&record.artifact.id)
            .cloned()
            .unwrap_or_else(|| packaging_activity_id.clone());
        was_generated_by.insert(
            format!("dagml:generated:artifact:{}", record.artifact.id),
            json!({
                "prov:entity": artifact_entity_id(&record.artifact.id),
                "prov:activity": activity_id,
            }),
        );
    }

    let mut was_derived_from = BTreeMap::<String, Value>::new();
    was_derived_from.insert(
        "dagml:derived:bundle-plan".to_string(),
        json!({
            "prov:generatedEntity": bundle_entity_id,
            "prov:usedEntity": plan_entity_id,
        }),
    );
    for record in &bundle.refit_artifacts {
        for key in &record.data_requirement_keys {
            was_derived_from.insert(
                format!("dagml:derived:{}:data:{key}", record.artifact.id),
                json!({
                    "prov:generatedEntity": artifact_entity_id(&record.artifact.id),
                    "prov:usedEntity": data_requirement_entity_id(key),
                    "dagml:refit_dependency": "data_requirement",
                }),
            );
        }
        for key in &record.prediction_requirement_keys {
            was_derived_from.insert(
                format!("dagml:derived:{}:prediction:{key}", record.artifact.id),
                json!({
                    "prov:generatedEntity": artifact_entity_id(&record.artifact.id),
                    "prov:usedEntity": prediction_requirement_entity_id(key),
                    "dagml:refit_dependency": "prediction_requirement",
                    "dagml:oof_dependency": true,
                }),
            );
        }
    }
    for cache in &bundle.prediction_caches {
        was_derived_from.insert(
            format!("dagml:derived:cache:{}", cache.cache_id),
            json!({
                "prov:generatedEntity": prediction_cache_entity_id(&cache.cache_id),
                "prov:usedEntity": prediction_requirement_entity_id(&cache.requirement_key),
            }),
        );
    }
    for record in lineage {
        for input_id in &record.input_lineage {
            was_derived_from.insert(
                format!("dagml:derived:lineage:{}:{input_id}", record.record_id),
                json!({
                    "prov:generatedEntity": lineage_record_entity_id(&record.record_id),
                    "prov:usedEntity": lineage_record_entity_id(input_id),
                    "dagml:lineage_dependency": true,
                }),
            );
        }
    }

    let mut was_associated_with = BTreeMap::<String, Value>::new();
    was_associated_with.insert(
        "dagml:associated:bundle-packaging".to_string(),
        json!({
            "prov:activity": packaging_activity_id,
            "prov:agent": coordinator_agent_id,
        }),
    );
    for record in lineage {
        was_associated_with.insert(
            format!("dagml:associated:{}", record.record_id),
            json!({
                "prov:activity": lineage_activity_id(record),
                "prov:agent": controller_agent_id(record.controller_id.as_str()),
            }),
        );
    }

    Ok(json!({
        "@context": {
            "prov": "http://www.w3.org/ns/prov#",
            "dagml": "https://dag-ml.dev/ns#",
        },
        "entity": entity,
        "activity": activity,
        "agent": agent,
        "used": used,
        "wasGeneratedBy": was_generated_by,
        "wasDerivedFrom": was_derived_from,
        "wasAssociatedWith": was_associated_with,
    }))
}

fn build_ro_crate_metadata(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Result<Value> {
    let mut has_part = vec![
        json!({"@id": "execution_plan.json"}),
        json!({"@id": "execution_bundle.json"}),
        json!({"@id": PROV_JSONLD_FILE}),
    ];
    let mut graph = vec![
        json!({
            "@id": RO_CRATE_METADATA_FILE,
            "@type": "CreativeWork",
            "about": {"@id": "./"},
            "conformsTo": {"@id": "https://w3id.org/ro/crate/1.1"},
        }),
        json!({
            "@id": "./",
            "@type": "Dataset",
            "name": format!("DAG-ML research bundle {}", bundle.bundle_id),
            "mainEntity": {"@id": "#workflow"},
            "hasPart": has_part.clone(),
            "dagml:schema_version": RESEARCH_PROVENANCE_SCHEMA_VERSION,
            "dagml:bundle_id": bundle.bundle_id,
            "dagml:plan_id": plan.id,
            "dagml:unsafe_flags": bundle.unsafe_flags,
        }),
        json!({
            "@id": "#workflow",
            "@type": ["ComputationalWorkflow", "SoftwareSourceCode"],
            "name": "DAG-ML compiled workflow",
            "programmingLanguage": "Rust",
            "dagml:plan_id": plan.id,
            "dagml:graph_fingerprint": plan.graph_fingerprint,
            "dagml:campaign_fingerprint": plan.campaign_fingerprint,
            "dagml:controller_fingerprint": plan.controller_fingerprint,
            "dagml:selected_variant_id": bundle.selected_variant_id,
            "dagml:variant_count": plan.variants.len(),
        }),
        file_entity(
            "execution_plan.json",
            "DAG-ML execution plan",
            "dagml:ExecutionPlan",
        ),
        file_entity(
            "execution_bundle.json",
            "DAG-ML execution bundle",
            "dagml:ExecutionBundle",
        ),
        file_entity(PROV_JSONLD_FILE, "DAG-ML W3C PROV export", "prov:Bundle"),
    ];

    if prediction_cache_manifest.is_some() {
        has_part.push(json!({"@id": FILE_PREDICTION_CACHE_MANIFEST_FILE}));
        graph.push(file_entity(
            FILE_PREDICTION_CACHE_MANIFEST_FILE,
            "DAG-ML prediction cache manifest",
            "dagml:PredictionCacheManifest",
        ));
    }
    if artifact_manifest.is_some() {
        has_part.push(json!({"@id": FILE_ARTIFACT_MANIFEST_FILE}));
        graph.push(file_entity(
            FILE_ARTIFACT_MANIFEST_FILE,
            "DAG-ML artifact manifest",
            "dagml:ArtifactManifest",
        ));
    }
    for (key, envelope) in data_envelopes {
        let id = format!("data_envelopes/{key}.json");
        has_part.push(json!({"@id": id}));
        graph.push(json!({
            "@id": id,
            "@type": ["File", "dagml:ExternalDataPlanEnvelope"],
            "name": format!("DAG-ML data envelope {key}"),
            "dagml:envelope_key": key,
            "dagml:schema_version": envelope.schema_version,
            "dagml:schema_fingerprint": envelope.schema_fingerprint,
            "dagml:plan_fingerprint": envelope.plan_fingerprint,
            "dagml:relation_fingerprint": envelope.relation_fingerprint,
        }));
    }

    graph[1]["hasPart"] = Value::Array(has_part);

    for manifest in plan.controller_manifests.values() {
        graph.push(json!({
            "@id": controller_agent_id(manifest.controller_id.as_str()),
            "@type": ["SoftwareApplication", "dagml:Controller"],
            "name": manifest.controller_id,
            "softwareVersion": manifest.controller_version,
            "dagml:operator_kind": manifest.operator_kind,
            "dagml:capabilities": manifest.capabilities,
            "dagml:artifact_policy": manifest.artifact_policy,
        }));
    }
    for artifact in &bundle.refit_artifacts {
        graph.push(json!({
            "@id": artifact_entity_id(&artifact.artifact.id),
            "@type": ["File", "dagml:ModelArtifact"],
            "name": artifact.artifact.id,
            "encodingFormat": artifact.artifact.kind,
            "dagml:node_id": artifact.node_id,
            "dagml:controller_id": artifact.controller_id,
            "dagml:backend": artifact.artifact.backend,
            "dagml:uri": artifact.artifact.uri,
            "dagml:content_fingerprint": artifact.artifact.content_fingerprint,
            "dagml:plugin": artifact.artifact.plugin,
            "dagml:plugin_version": artifact.artifact.plugin_version,
            "dagml:refit_data_requirement_keys": artifact.data_requirement_keys,
            "dagml:refit_prediction_requirement_keys": artifact.prediction_requirement_keys,
        }));
    }

    Ok(json!({
        "@context": [
            "https://w3id.org/ro/crate/1.1/context",
            {
                "dagml": "https://dag-ml.dev/ns#",
                "prov": "http://www.w3.org/ns/prov#",
            }
        ],
        "@graph": graph,
    }))
}

fn file_entity(id: &str, name: &str, dagml_type: &str) -> Value {
    json!({
        "@id": id,
        "@type": ["File", dagml_type],
        "name": name,
    })
}

fn add_json_package_file<T: Serialize + ?Sized>(
    files: &mut BTreeMap<String, ResearchProvenancePackageFile>,
    path: &str,
    value: &T,
    label: &str,
) -> Result<()> {
    validate_package_path(path)?;
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|err| {
        DagMlError::RuntimeValidation(format!("failed to serialize {label}: {err}"))
    })?;
    bytes.push(b'\n');
    let sha256 = sha256_hex(&bytes);
    let previous = files.insert(
        path.to_string(),
        ResearchProvenancePackageFile {
            path: path.to_string(),
            sha256,
            size_bytes: bytes.len(),
            bytes,
        },
    );
    if previous.is_some() {
        return Err(DagMlError::RuntimeValidation(format!(
            "duplicate research provenance package file `{path}`"
        )));
    }
    Ok(())
}

fn validate_package_path(path: &str) -> Result<()> {
    if path.is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "research provenance package path is empty".to_string(),
        ));
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(DagMlError::RuntimeValidation(format!(
            "research provenance package path `{path}` must be relative"
        )));
    }
    if path.chars().any(char::is_control) {
        return Err(DagMlError::RuntimeValidation(format!(
            "research provenance package path `{path}` has control characters"
        )));
    }
    for segment in path.split(['/', '\\']) {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(DagMlError::RuntimeValidation(format!(
                "research provenance package path `{path}` has an invalid path component"
            )));
        }
    }
    Ok(())
}

fn data_envelope_file_path(key: &str) -> Result<String> {
    if key.contains(['/', '\\']) {
        return Err(DagMlError::RuntimeValidation(format!(
            "data envelope key `{key}` cannot be used as a research provenance package path"
        )));
    }
    Ok(format!("data_envelopes/{key}.json"))
}

fn require_package_file<'a>(files: &'a BTreeMap<String, Vec<u8>>, path: &str) -> Result<&'a [u8]> {
    files.get(path).map(Vec::as_slice).ok_or_else(|| {
        DagMlError::RuntimeValidation(format!("research provenance package is missing `{path}`"))
    })
}

fn parse_package_json<T: DeserializeOwned>(bytes: &[u8], path: &str) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|err| {
        DagMlError::RuntimeValidation(format!(
            "failed to parse research provenance package JSON `{path}`: {err}"
        ))
    })
}

fn parse_package_data_envelopes(
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<BTreeMap<String, ExternalDataPlanEnvelope>> {
    let mut envelopes = BTreeMap::new();
    for (path, bytes) in files {
        let Some(key) = path
            .strip_prefix("data_envelopes/")
            .and_then(|suffix| suffix.strip_suffix(".json"))
        else {
            continue;
        };
        if key.is_empty() || key.contains(['/', '\\']) {
            return Err(DagMlError::RuntimeValidation(format!(
                "research provenance data envelope path `{path}` has an invalid key"
            )));
        }
        let previous = envelopes.insert(key.to_string(), parse_package_json(bytes, path)?);
        if previous.is_some() {
            return Err(DagMlError::RuntimeValidation(format!(
                "duplicate research provenance data envelope key `{key}`"
            )));
        }
    }
    Ok(envelopes)
}

fn validate_prov_jsonld_root(prov_jsonld: Value) -> Result<()> {
    if prov_jsonld.get("@context").is_none()
        || prov_jsonld.get("entity").is_none()
        || prov_jsonld.get("activity").is_none()
        || prov_jsonld.get("agent").is_none()
    {
        return Err(DagMlError::RuntimeValidation(
            "research provenance PROV JSON-LD root is missing required sections".to_string(),
        ));
    }
    Ok(())
}

fn validate_openlineage_namespace(namespace: &str) -> Result<()> {
    if namespace.trim().is_empty() {
        return Err(DagMlError::RuntimeValidation(
            "OpenLineage namespace must not be empty".to_string(),
        ));
    }
    if namespace.chars().any(char::is_control) {
        return Err(DagMlError::RuntimeValidation(
            "OpenLineage namespace contains control characters".to_string(),
        ));
    }
    Ok(())
}

fn validate_openlineage_event_time(event_time: &str) -> Result<()> {
    if event_time.trim().is_empty() || !event_time.contains('T') {
        return Err(DagMlError::RuntimeValidation(
            "OpenLineage event_time must be a non-empty RFC3339-like timestamp".to_string(),
        ));
    }
    if event_time.chars().any(char::is_control) {
        return Err(DagMlError::RuntimeValidation(
            "OpenLineage event_time contains control characters".to_string(),
        ));
    }
    Ok(())
}

fn dagml_openlineage_reproducibility_run_facet(
    plan: &ExecutionPlan,
    bundle: &ExecutionBundle,
) -> Value {
    json!({
        "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlReproducibilityRunFacet"),
        "plan_id": plan.id,
        "bundle_id": bundle.bundle_id,
        "graph_fingerprint": bundle.graph_fingerprint,
        "campaign_fingerprint": bundle.campaign_fingerprint,
        "controller_fingerprint": bundle.controller_fingerprint,
        "selected_variant_id": bundle.selected_variant_id,
        "variant_count": plan.variants.len(),
        "unsafe_flags": bundle.unsafe_flags,
    })
}

fn dagml_openlineage_oof_safety_run_facet(
    bundle: &ExecutionBundle,
    lineage: &[LineageRecord],
) -> Value {
    json!({
        "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlOofSafetyRunFacet"),
        "prediction_requirement_count": bundle.prediction_requirements.len(),
        "prediction_cache_count": bundle.prediction_caches.len(),
        "lineage_record_count": lineage.len(),
        "requires_oof_prediction_count": bundle.prediction_requirements.len(),
        "refit_artifact_count": bundle.refit_artifacts.len(),
    })
}

fn dagml_openlineage_plan_job_facet(plan: &ExecutionPlan, bundle: &ExecutionBundle) -> Value {
    json!({
        "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlPlanJobFacet"),
        "plan_id": plan.id,
        "bundle_id": bundle.bundle_id,
        "node_count": plan.node_plans.len(),
        "controller_count": plan.controller_manifests.len(),
        "has_fold_set": plan.fold_set.is_some(),
        "selected_variant_id": bundle.selected_variant_id,
    })
}

fn openlineage_input_datasets(
    bundle: &ExecutionBundle,
    data_envelopes: &BTreeMap<String, ExternalDataPlanEnvelope>,
) -> Vec<Value> {
    bundle
        .data_requirements
        .iter()
        .map(|requirement| {
            let key = requirement.key();
            let envelope = data_envelopes.get(&key);
            json!({
                "namespace": "dagml:data-requirement",
                "name": key,
                "facets": {
                    "dagml_contract": {
                        "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlDatasetContractFacet"),
                        "node_id": requirement.node_id,
                        "input_name": requirement.input_name,
                        "schema_fingerprint": requirement.schema_fingerprint,
                        "plan_fingerprint": requirement.plan_fingerprint,
                        "relation_fingerprint": requirement.relation_fingerprint,
                        "feature_set_id": requirement.feature_set_id,
                        "envelope_schema_fingerprint": envelope.map(|envelope| envelope.schema_fingerprint.clone()),
                        "envelope_plan_fingerprint": envelope.map(|envelope| envelope.plan_fingerprint.clone()),
                    }
                }
            })
        })
        .collect()
}

fn openlineage_output_datasets(
    bundle: &ExecutionBundle,
    prediction_cache_manifest: Option<&FilePredictionCacheManifest>,
    artifact_manifest: Option<&FileArtifactManifest>,
) -> Vec<Value> {
    let mut outputs = vec![json!({
        "namespace": "dagml:bundle",
        "name": bundle.bundle_id,
        "facets": {
            "dagml_contract": {
                "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlDatasetContractFacet"),
                "schema_version": bundle.schema_version,
                "plan_id": bundle.plan_id,
                "selected_variant_id": bundle.selected_variant_id,
                "graph_fingerprint": bundle.graph_fingerprint,
                "campaign_fingerprint": bundle.campaign_fingerprint,
                "controller_fingerprint": bundle.controller_fingerprint,
            }
        }
    })];
    for cache in &bundle.prediction_caches {
        outputs.push(json!({
            "namespace": "dagml:prediction-cache",
            "name": cache.cache_id,
            "facets": {
                "dagml_contract": {
                    "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlDatasetContractFacet"),
                    "requirement_key": cache.requirement_key,
                    "prediction_level": cache.prediction_level,
                    "row_count": cache.row_count,
                    "block_count": cache.block_count,
                    "content_fingerprint": cache.content_fingerprint,
                    "has_file_manifest": prediction_cache_manifest.is_some(),
                }
            }
        }));
    }
    for artifact in &bundle.refit_artifacts {
        outputs.push(json!({
            "namespace": "dagml:artifact",
            "name": artifact.artifact.id,
            "facets": {
                "dagml_contract": {
                    "_schemaURL": format!("{DAGML_OPENLINEAGE_FACET_SCHEMA_URL}#/$defs/DagmlDatasetContractFacet"),
                    "node_id": artifact.node_id,
                    "controller_id": artifact.controller_id,
                    "backend": artifact.artifact.backend,
                    "uri": artifact.artifact.uri,
                    "content_fingerprint": artifact.artifact.content_fingerprint,
                    "plugin": artifact.artifact.plugin,
                    "plugin_version": artifact.artifact.plugin_version,
                    "data_requirement_keys": artifact.data_requirement_keys,
                    "prediction_requirement_keys": artifact.prediction_requirement_keys,
                    "has_file_manifest": artifact_manifest.is_some(),
                }
            }
        }));
    }
    outputs
}

fn openlineage_run_id(plan: &ExecutionPlan, bundle: &ExecutionBundle) -> String {
    let input = format!("dag-ml/openlineage/run/{}/{}", plan.id, bundle.bundle_id);
    let digest = Sha256::digest(input.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

fn validate_ro_crate_package_checksums(
    ro_crate_metadata: &Value,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<usize> {
    let graph = ro_crate_metadata
        .get("@graph")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RO-Crate metadata has no @graph array".to_string())
        })?;
    let root = graph
        .iter()
        .find(|entry| entry.get("@id").and_then(Value::as_str) == Some("./"))
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RO-Crate metadata has no root dataset".to_string())
        })?;
    if root.get("dagml:schema_version").and_then(Value::as_u64)
        != Some(RESEARCH_PROVENANCE_SCHEMA_VERSION as u64)
    {
        return Err(DagMlError::RuntimeValidation(format!(
            "RO-Crate root has unsupported dagml:schema_version, expected {}",
            RESEARCH_PROVENANCE_SCHEMA_VERSION
        )));
    }
    let root_has_part = root
        .get("hasPart")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RO-Crate root hasPart is not an array".to_string())
        })?;
    let root_has_part_ids = root_has_part
        .iter()
        .filter_map(|entry| entry.get("@id").and_then(Value::as_str))
        .collect::<BTreeSet<_>>();

    let mut checksummed = 0;
    for (path, bytes) in files {
        if path == RO_CRATE_METADATA_FILE {
            continue;
        }
        if !root_has_part_ids.contains(path.as_str()) {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate root does not list package file `{path}` in hasPart"
            )));
        }
        let entry = graph
            .iter()
            .find(|entry| entry.get("@id").and_then(Value::as_str) == Some(path.as_str()))
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "RO-Crate metadata is missing package file entry `{path}`"
                ))
            })?;
        let expected_sha256 = sha256_hex(bytes);
        let declared_sha256 = entry.get("sha256").and_then(Value::as_str).ok_or_else(|| {
            DagMlError::RuntimeValidation(format!(
                "RO-Crate package file `{path}` is missing sha256"
            ))
        })?;
        if declared_sha256 != expected_sha256 {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate package file `{path}` sha256 mismatch"
            )));
        }
        let declared_dagml_sha256 = entry
            .get("dagml:sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                DagMlError::RuntimeValidation(format!(
                    "RO-Crate package file `{path}` is missing dagml:sha256"
                ))
            })?;
        if declared_dagml_sha256 != declared_sha256 {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate package file `{path}` has inconsistent checksum fields"
            )));
        }
        if entry.get("contentSize").and_then(Value::as_u64) != Some(bytes.len() as u64) {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate package file `{path}` contentSize mismatch"
            )));
        }
        if entry.get("encodingFormat").and_then(Value::as_str) != Some("application/json") {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate package file `{path}` must declare application/json"
            )));
        }
        checksummed += 1;
    }

    for has_part_id in root_has_part_ids {
        if has_part_id != RO_CRATE_METADATA_FILE && !files.contains_key(has_part_id) {
            return Err(DagMlError::RuntimeValidation(format!(
                "RO-Crate root references missing package file `{has_part_id}`"
            )));
        }
    }

    Ok(checksummed)
}

fn annotate_ro_crate_package_files(
    ro_crate_metadata: &mut Value,
    files: &BTreeMap<String, ResearchProvenancePackageFile>,
) -> Result<()> {
    let graph = ro_crate_metadata
        .get_mut("@graph")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RO-Crate metadata has no @graph array".to_string())
        })?;

    let mut existing_ids = graph
        .iter()
        .filter_map(|entry| entry.get("@id").and_then(Value::as_str).map(str::to_string))
        .collect::<BTreeSet<_>>();
    for file in files.values() {
        if !existing_ids.contains(&file.path) {
            graph.push(file_entity(
                &file.path,
                &format!("DAG-ML contract file {}", file.path),
                "dagml:ContractArtifact",
            ));
            existing_ids.insert(file.path.clone());
        }
    }

    for entry in graph.iter_mut() {
        let Some(id) = entry.get("@id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let Some(file) = files.get(id.as_str()) else {
            continue;
        };
        let object = entry.as_object_mut().ok_or_else(|| {
            DagMlError::RuntimeValidation(format!("RO-Crate graph entry `{id}` is not an object"))
        })?;
        object.insert("encodingFormat".to_string(), json!("application/json"));
        object.insert("contentSize".to_string(), json!(file.size_bytes));
        object.insert("sha256".to_string(), json!(file.sha256));
        object.insert("dagml:sha256".to_string(), json!(file.sha256));
    }

    let root = graph
        .iter_mut()
        .find(|entry| entry.get("@id") == Some(&json!("./")))
        .ok_or_else(|| {
            DagMlError::RuntimeValidation("RO-Crate metadata has no root dataset".to_string())
        })?;
    let root_object = root.as_object_mut().ok_or_else(|| {
        DagMlError::RuntimeValidation("RO-Crate root dataset is not an object".to_string())
    })?;
    let has_part = root_object
        .entry("hasPart".to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let has_part = has_part.as_array_mut().ok_or_else(|| {
        DagMlError::RuntimeValidation("RO-Crate root hasPart is not an array".to_string())
    })?;
    let mut has_part_ids = has_part
        .iter()
        .filter_map(|entry| entry.get("@id").and_then(Value::as_str).map(str::to_string))
        .collect::<BTreeSet<_>>();
    for path in files.keys() {
        if has_part_ids.insert(path.clone()) {
            has_part.push(json!({"@id": path}));
        }
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        write!(&mut out, "{byte:02x}").expect("writing to string cannot fail");
    }
    out
}

fn lineage_artifact_index(lineage: &[LineageRecord]) -> BTreeMap<ArtifactId, String> {
    let mut index = BTreeMap::new();
    for record in lineage {
        for artifact in &record.artifact_refs {
            index.insert(artifact.id.clone(), lineage_activity_id(record));
        }
    }
    index
}

fn lineage_activity_id(record: &LineageRecord) -> String {
    format!("dagml:activity:{}", record.record_id)
}

fn controller_agent_id(controller_id: &str) -> String {
    format!("dagml:controller:{controller_id}")
}

fn artifact_entity_id(artifact_id: &ArtifactId) -> String {
    format!("dagml:artifact:{artifact_id}")
}

fn lineage_record_entity_id(lineage_id: &LineageId) -> String {
    format!("dagml:lineage-record:{lineage_id}")
}

fn data_requirement_entity_id(key: &str) -> String {
    format!("dagml:data-requirement:{key}")
}

fn data_envelope_entity_id(key: &str) -> String {
    format!("dagml:data-envelope:{key}")
}

fn prediction_requirement_entity_id(key: &str) -> String {
    format!("dagml:prediction-requirement:{key}")
}

fn prediction_cache_entity_id(cache_id: &str) -> String {
    format!("dagml:prediction-cache:{cache_id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller::{ControllerManifest, ControllerRegistry};
    use crate::ids::{ControllerId, LineageId, NodeId, RunId};
    use crate::plan::build_execution_plan;
    use crate::{CampaignSpec, GraphSpec, Phase};

    fn fixture_plan() -> ExecutionPlan {
        let graph: GraphSpec =
            serde_json::from_str(include_str!("../tests/fixtures/package/minimal_graph.json"))
                .unwrap();
        let campaign: CampaignSpec = serde_json::from_str(include_str!(
            "../tests/fixtures/package/campaign_oof_generation.json"
        ))
        .unwrap();
        let manifests: Vec<ControllerManifest> = serde_json::from_str(include_str!(
            "../tests/fixtures/package/controller_manifests.json"
        ))
        .unwrap();
        let mut registry = ControllerRegistry::new();
        for manifest in manifests {
            registry.register(manifest).unwrap();
        }
        build_execution_plan("plan:cli.bundle", graph, campaign, &registry).unwrap()
    }

    fn fixture_bundle() -> ExecutionBundle {
        serde_json::from_str(include_str!(
            "../tests/fixtures/package/provenance/execution_bundle_minimal.json"
        ))
        .unwrap()
    }

    fn fixture_lineage(plan: &ExecutionPlan) -> LineageRecord {
        let node_id = NodeId::new("model:base").unwrap();
        let node_plan = plan.node_plans.get(&node_id).unwrap();
        LineageRecord {
            record_id: LineageId::new("lineage:test:model:base").unwrap(),
            run_id: RunId::new("run:provenance").unwrap(),
            node_id,
            phase: Phase::Refit,
            controller_id: node_plan.controller_id.clone(),
            controller_version: node_plan.controller_version.clone(),
            variant_id: plan
                .variants
                .first()
                .map(|variant| variant.variant_id.clone()),
            fold_id: None,
            branch_path: Vec::new(),
            input_lineage: Vec::new(),
            artifact_refs: vec![fixture_bundle().refit_artifacts[0].artifact.clone()],
            params_fingerprint: node_plan.params_fingerprint.clone(),
            data_model_shape_fingerprint: None,
            aggregation_policy_fingerprint: None,
            seed: Some(42),
            unsafe_flags: BTreeSet::new(),
            metrics: BTreeMap::new(),
            loss_attestations: Vec::new(),
            early_stopping_records: Vec::new(),
        }
    }

    #[test]
    fn research_provenance_export_contains_prov_and_ro_crate_contracts() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let lineage = vec![fixture_lineage(&plan)];
        let export = build_research_provenance_export(
            &plan,
            &bundle,
            &lineage,
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap();

        assert_eq!(export.schema_version, RESEARCH_PROVENANCE_SCHEMA_VERSION);
        assert!(export.prov_jsonld["@context"]["prov"]
            .as_str()
            .unwrap()
            .contains("prov"));
        assert!(export.prov_jsonld["activity"]
            .as_object()
            .unwrap()
            .contains_key("dagml:activity:lineage:test:model:base"));
        assert!(export.prov_jsonld["agent"]
            .as_object()
            .unwrap()
            .contains_key("dagml:controller:controller:model.mock"));
        assert!(export.prov_jsonld["entity"]
            .as_object()
            .unwrap()
            .contains_key("dagml:artifact:artifact:model:base:refit"));

        let graph = export.ro_crate_metadata["@graph"].as_array().unwrap();
        assert!(graph
            .iter()
            .any(|entry| entry["@type"].to_string().contains("ComputationalWorkflow")));
        assert!(graph
            .iter()
            .any(|entry| entry["@id"] == json!("lineage.prov.jsonld")));
        assert!(graph
            .iter()
            .any(|entry| entry["@id"] == json!("execution_bundle.json")));
    }

    #[test]
    fn research_provenance_package_contains_contract_files_and_checksums() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let lineage = vec![fixture_lineage(&plan)];
        let package = build_research_provenance_package(
            &plan,
            &bundle,
            &lineage,
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap();

        for path in [
            EXECUTION_PLAN_FILE,
            EXECUTION_BUNDLE_FILE,
            LINEAGE_RECORDS_FILE,
            PROV_JSONLD_FILE,
            RO_CRATE_METADATA_FILE,
        ] {
            assert!(
                package.files.contains_key(path),
                "package is missing {path}"
            );
        }
        for (path, file) in &package.files {
            assert_eq!(file.path, *path);
            assert_eq!(file.sha256.len(), 64, "invalid sha256 for {path}");
            assert!(file.size_bytes > 0, "empty package file {path}");
            assert_eq!(file.size_bytes, file.bytes.len());
        }

        let ro_crate_file = package.files.get(RO_CRATE_METADATA_FILE).unwrap();
        let ro_crate_metadata: Value = serde_json::from_slice(&ro_crate_file.bytes).unwrap();
        let graph = ro_crate_metadata["@graph"].as_array().unwrap();
        for path in [
            EXECUTION_PLAN_FILE,
            EXECUTION_BUNDLE_FILE,
            LINEAGE_RECORDS_FILE,
            PROV_JSONLD_FILE,
        ] {
            let entry = graph
                .iter()
                .find(|entry| entry["@id"] == json!(path))
                .unwrap_or_else(|| panic!("RO-Crate metadata is missing file entry {path}"));
            assert_eq!(entry["sha256"].as_str().map(str::len), Some(64));
            assert_eq!(entry["dagml:sha256"].as_str(), entry["sha256"].as_str());
            assert_eq!(entry["encodingFormat"], json!("application/json"));
            assert!(entry["contentSize"].as_u64().unwrap() > 0);
        }
        let root = graph
            .iter()
            .find(|entry| entry["@id"] == json!("./"))
            .expect("RO-Crate root dataset is present");
        let has_part = root["hasPart"].as_array().unwrap();
        assert!(has_part
            .iter()
            .any(|entry| entry["@id"] == json!(LINEAGE_RECORDS_FILE)));
    }

    #[test]
    fn research_provenance_package_validation_reopens_exported_contracts() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let lineage = vec![fixture_lineage(&plan)];
        let package = build_research_provenance_package(
            &plan,
            &bundle,
            &lineage,
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap();
        let files = package
            .files
            .iter()
            .map(|(path, file)| (path.clone(), file.bytes.clone()))
            .collect::<BTreeMap<_, _>>();

        let validation = validate_research_provenance_package_files(&files).unwrap();

        assert_eq!(
            validation.schema_version,
            RESEARCH_PROVENANCE_SCHEMA_VERSION
        );
        assert_eq!(validation.plan_id, plan.id.to_string());
        assert_eq!(validation.bundle_id, bundle.bundle_id.to_string());
        assert_eq!(validation.file_count, package.files.len());
        assert_eq!(validation.checksummed_file_count, package.files.len() - 1);
        assert_eq!(validation.lineage_record_count, 1);
    }

    #[test]
    fn research_provenance_package_validation_refuses_tampered_file() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let package =
            build_research_provenance_package(&plan, &bundle, &[], &BTreeMap::new(), None, None)
                .unwrap();
        let mut files = package
            .files
            .iter()
            .map(|(path, file)| (path.clone(), file.bytes.clone()))
            .collect::<BTreeMap<_, _>>();
        files.insert(LINEAGE_RECORDS_FILE.to_string(), b"[]\n\n".to_vec());

        let error = validate_research_provenance_package_files(&files)
            .unwrap_err()
            .to_string();

        assert!(
            error.contains("sha256 mismatch"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn openlineage_export_uses_validated_research_package() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let lineage = vec![fixture_lineage(&plan)];
        let package = build_research_provenance_package(
            &plan,
            &bundle,
            &lineage,
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap();
        let files = package
            .files
            .iter()
            .map(|(path, file)| (path.clone(), file.bytes.clone()))
            .collect::<BTreeMap<_, _>>();

        let event = build_openlineage_run_event_from_package_files(
            &files,
            "dag-ml-test",
            "2026-05-27T00:00:00Z",
        )
        .unwrap();

        assert_eq!(event["eventType"], json!("COMPLETE"));
        assert_eq!(event["schemaURL"], json!(OPENLINEAGE_RUN_EVENT_SCHEMA_URL));
        assert_eq!(event["job"]["namespace"], json!("dag-ml-test"));
        assert_eq!(event["run"]["runId"].as_str().map(str::len), Some(36));
        assert!(
            event["run"]["facets"]["dagml_reproducibility"]["graph_fingerprint"]
                .as_str()
                .is_some()
        );
        assert!(!event["inputs"].as_array().unwrap().is_empty());
        assert!(event["outputs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|output| output["namespace"] == json!("dagml:bundle")));
    }

    #[test]
    fn research_provenance_export_refuses_unknown_lineage_node() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let mut lineage = fixture_lineage(&plan);
        lineage.node_id = NodeId::new("model:missing").unwrap();

        let error = build_research_provenance_export(
            &plan,
            &bundle,
            &[lineage],
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("unknown node"), "unexpected error: {error}");
    }

    #[test]
    fn research_provenance_export_refuses_mismatched_artifact_manifest() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let mut manifest = FileArtifactManifest {
            bundle_id: bundle.bundle_id.clone(),
            schema_version: crate::runtime::FILE_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            artifacts: Vec::new(),
        };
        manifest.bundle_id = crate::ids::BundleId::new("bundle:wrong").unwrap();

        let error = build_research_provenance_export(
            &plan,
            &bundle,
            &[],
            &BTreeMap::new(),
            None,
            Some(&manifest),
        )
        .unwrap_err()
        .to_string();

        assert!(
            error.contains("does not match bundle"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn research_provenance_export_refuses_unknown_lineage_controller() {
        let plan = fixture_plan();
        let bundle = fixture_bundle();
        let mut lineage = fixture_lineage(&plan);
        lineage.controller_id = ControllerId::new("controller:missing").unwrap();

        let error = build_research_provenance_export(
            &plan,
            &bundle,
            &[lineage],
            &BTreeMap::new(),
            None,
            None,
        )
        .unwrap_err()
        .to_string();

        assert!(
            error.contains("unknown controller"),
            "unexpected error: {error}"
        );
    }
}
