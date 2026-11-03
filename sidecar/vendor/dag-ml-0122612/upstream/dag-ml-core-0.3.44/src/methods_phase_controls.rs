//! Closed, additive PLS RolePipeline phase contract. No numerical operations.
use crate::plan::ExecutionPlan;
use crate::training::{ParameterNamespace, ParameterPatch, TrainingRequest};
use crate::{DagMlError, NodeId, Phase, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub const METHODS_PLS_ROLE_PROFILE: &str = "n4m.pls_role_pipeline.v1";
pub const METHODS_NATIVE_REGRESSION_CONTROLLER: &str = "controller:methods.native.regression";
pub const METHODS_NATIVE_REGRESSION_PLUGIN: &str = "dagml.methods.native.regression";
pub const METHODS_NATIVE_REGRESSION_VERSION: &str = "1.0.0";

fn refuse(reason: &str) -> DagMlError {
    DagMlError::RuntimeValidation(format!("native PLS phase profile: {reason}"))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePlsPipeline {
    pub schema_version: u32,
    pub pipeline_type: String,
    pub savgol_window: i64,
    pub savgol_poly_degree: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePlsPhaseControls {
    #[serde(default)]
    pub train_params: BTreeMap<String, Value>,
    #[serde(default)]
    pub refit_params: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NativePlsRoleParams {
    pub native_profile: String,
    pub n_components: i64,
    pub scale: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pipeline: Option<NativePlsPipeline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_controls: Option<NativePlsPhaseControls>,
}

pub fn validate_native_pls_model_controls(params: &BTreeMap<String, Value>) -> Result<()> {
    for (key, value) in params {
        match key.as_str() {
            "n_components" if value.as_i64().is_some_and(|n| n > 0 && n <= i32::MAX as i64) => {},
            "scale" if value.is_boolean() => {},
            _ => return Err(refuse("only positive integer n_components and boolean scale are executable controls; aliases and unknown keys are refused")),
        }
    }
    Ok(())
}

pub(crate) fn native_pls_fit_patch_values(
    patch: &ParameterPatch,
) -> Result<BTreeMap<String, Value>> {
    patch.validate()?;
    if patch.namespace != ParameterNamespace::Fit
        || patch.path.len() != 1
        || !matches!(patch.path[0].as_str(), "train_params" | "refit_params")
    {
        return Err(refuse(
            "fit namespace supports only train_params/refit_params objects",
        ));
    }
    let values = serde_json::from_value(patch.value.clone())
        .map_err(|_| refuse("phase controls must be objects"))?;
    validate_native_pls_model_controls(&values)?;
    Ok(values)
}

/// Validate the signed phase object against its execution-derived materialization.
pub(crate) fn validate_native_pls_materialized_fit_patch(
    plan: &ExecutionPlan,
    patch: &ParameterPatch,
) -> Result<()> {
    let values = native_pls_fit_patch_values(patch)?;
    validate_native_pls_phase_plan(plan)?;
    let node = plan
        .node_plans
        .get(&patch.node_id)
        .ok_or_else(|| refuse("fit patch names an absent node"))?;
    if node.controller_id.as_str() != METHODS_NATIVE_REGRESSION_CONTROLLER {
        return Err(refuse(
            "fit patch requires the dedicated native PLS controller",
        ));
    }
    let params = NativePlsRoleParams::from_params(&node.params)?;
    let controls = params
        .phase_controls
        .ok_or_else(|| refuse("fit patch has no materialized phase_controls"))?;
    let actual = if patch.path[0] == "train_params" {
        &controls.train_params
    } else {
        &controls.refit_params
    };
    if actual != &values {
        return Err(refuse("fit patch differs from materialized phase_controls"));
    }
    let provenance = plan
        .campaign
        .metadata
        .get("native_pls_phase_controls")
        .and_then(Value::as_object)
        .ok_or_else(|| refuse("missing phase control provenance"))?;
    if provenance.len() != 1
        || provenance.get(patch.node_id.as_str()) != Some(&serde_json::to_value(&controls)?)
    {
        return Err(refuse("phase controls differ from campaign provenance"));
    }
    if controls
        .train_params
        .iter()
        .any(|(key, value)| node.params.get(key) != Some(value))
    {
        return Err(refuse(
            "train controls are not materialized in the effective node params",
        ));
    }
    Ok(())
}

impl NativePlsRoleParams {
    pub fn from_params(params: &BTreeMap<String, Value>) -> Result<Self> {
        let value = serde_json::to_value(params)?;
        let parsed: Self = serde_json::from_value(value)
            .map_err(|e| refuse(&format!("invalid closed parameters: {e}")))?;
        if parsed.native_profile != METHODS_PLS_ROLE_PROFILE {
            return Err(refuse("unknown native_profile"));
        }
        validate_native_pls_model_controls(&BTreeMap::from([
            ("n_components".into(), json!(parsed.n_components)),
            ("scale".into(), json!(parsed.scale)),
        ]))?;
        if let Some(p) = &parsed.pipeline {
            if p.schema_version != 1
                || p.pipeline_type != "n4m.snv_savgol_smooth.v1"
                || !(3..=501).contains(&p.savgol_window)
                || p.savgol_window % 2 != 1
                || !(0..p.savgol_window).contains(&p.savgol_poly_degree)
            {
                return Err(refuse(
                    "SNV/Savitzky-Golay declaration is outside the existing bounded constructor",
                ));
            }
        }
        if let Some(p) = &parsed.phase_controls {
            validate_native_pls_model_controls(&p.train_params)?;
            validate_native_pls_model_controls(&p.refit_params)?;
        }
        Ok(parsed)
    }
    /// Effective native recipe. scale owns both flags, always atomically.
    pub fn recipe(&self, phase: Phase) -> Vec<Value> {
        let mut components = self.n_components;
        let mut scale = self.scale;
        if matches!(phase, Phase::Refit | Phase::Predict) {
            if let Some(p) = &self.phase_controls {
                if let Some(n) = p.refit_params.get("n_components") {
                    components = n.as_i64().expect("validated integer");
                }
                if let Some(b) = p.refit_params.get("scale") {
                    scale = b.as_bool().expect("validated boolean");
                }
            }
        }
        let mut steps = Vec::new();
        if let Some(p) = &self.pipeline {
            steps.push(json!({"methodId":"preprocessing.scatter.snv", "params":{"with_mean":true,"with_std":true,"ddof":0}}));
            steps.push(json!({"methodId":"preprocessing.derivatives.savitzky_golay", "params":{"window_length":p.savgol_window,"polyorder":p.savgol_poly_degree,"deriv":0,"delta":1.0,"mode":"interp","cval":0.0}}));
        }
        steps.push(json!({"methodId":"models.pls.pls_regression", "params":{"n_components":components,"solver":"nipals","center_x":true,"center_y":true,"scale_x":scale,"scale_y":scale}}));
        steps
    }
}

/// Pure public helper used by SDK compilation: no native library/data access.
pub fn methods_pls_role_pipeline_contract(params: &BTreeMap<String, Value>) -> Result<Value> {
    let parsed = NativePlsRoleParams::from_params(params)?;
    if params.contains_key("phase_controls") {
        return Err(refuse(
            "phase_controls is internal; supply signed fit patches",
        ));
    }
    let manifest = json!({
        "controller_id":METHODS_NATIVE_REGRESSION_CONTROLLER,"controller_version":METHODS_NATIVE_REGRESSION_VERSION,
        "operator_kind":"model","priority":100,"supported_phases":["FIT_CV","REFIT","PREDICT"],
        "input_ports":[{"name":"x","kind":"data","representation":"tabular_numeric","cardinality":"one"}],
        "output_ports":[{"name":"oof","kind":"prediction","representation":null,"cardinality":"one"},{"name":"model","kind":"artifact","representation":null,"cardinality":"one"}],
        "data_requirements":{"schema_version":1,"ports":[{"name":"x","accepted_representations":["tabular_numeric"],"accepted_types":["table"],"rank":2,"multi_source":false,"optional":false}],"metadata":{}},
        "capabilities":["deterministic","thread_safe","process_safe","emits_predictions","emits_artifacts","stateful","supports_portable_full_refit"],
        "operator_selectors":[{"refs":["N4mRolePipeline"],"types":["N4mRolePipeline"]}],"fit_scope":"fold_train","rng_policy":"uses_core_seed","artifact_policy":"serializable"
    });
    Ok(
        json!({"operator":{"type":"N4mRolePipeline","steps":parsed.recipe(Phase::FitCv)},"manifest":manifest}),
    )
}

/// Materialize only the signed fit namespace owned by this closed profile.
/// Keep phase controls in node params and campaign provenance, so CV caches,
/// REFIT bytes and resumed optimizers are all bound to the same scientific recipe.
pub(crate) fn materialize_native_pls_phase_controls(
    plan: &mut ExecutionPlan,
    request: &TrainingRequest,
) -> Result<()> {
    if request
        .campaign
        .metadata
        .contains_key("native_pls_phase_controls")
    {
        return Err(refuse(
            "native_pls_phase_controls is execution-derived, not a caller metadata override",
        ));
    }
    let mut all = BTreeMap::<NodeId, NativePlsPhaseControls>::new();
    let mut seen = BTreeSet::new();
    for patch in &request.parameter_patches {
        if patch.namespace != ParameterNamespace::Fit {
            continue;
        }
        let node = plan
            .node_plans
            .get(&patch.node_id)
            .ok_or_else(|| refuse("fit patch names an absent node"))?;
        if node.controller_id.as_str() != METHODS_NATIVE_REGRESSION_CONTROLLER
            || patch.path.len() != 1
            || !matches!(patch.path[0].as_str(), "train_params" | "refit_params")
        {
            return Err(refuse(
                "fit namespace supports only train_params/refit_params objects on this profile",
            ));
        }
        if !seen.insert((patch.node_id.clone(), patch.path.clone())) {
            return Err(refuse("duplicate phase control owner"));
        }
        let values: BTreeMap<String, Value> = serde_json::from_value(patch.value.clone())
            .map_err(|_| refuse("phase controls must be objects"))?;
        validate_native_pls_model_controls(&values)?;
        let entry = all.entry(patch.node_id.clone()).or_default();
        if patch.path[0] == "train_params" {
            entry.train_params = values;
        } else {
            entry.refit_params = values;
        }
    }
    for (id, controls) in &all {
        let node = plan.node_plans.get_mut(id).expect("validated node");
        if node.params.contains_key("phase_controls") {
            return Err(refuse("phase_controls cannot be supplied by an operator"));
        }
        node.params.extend(controls.train_params.clone());
        let mut phase_controls = serde_json::to_value(controls)?;
        // Struct-to-Value preserves declaration order with preserve_order.
        // These dynamic objects must retain the legacy sorted-map encoding
        // when a host persists a package with sorted JSON keys.
        phase_controls.sort_all_objects();
        node.params.insert("phase_controls".into(), phase_controls);
        node.params_fingerprint = crate::campaign::stable_json_fingerprint(&node.params)?;
    }
    if !all.is_empty() {
        let mut provenance = serde_json::to_value(&all)?;
        provenance.sort_all_objects();
        plan.campaign
            .metadata
            .insert("native_pls_phase_controls".into(), provenance);
        plan.campaign_fingerprint = crate::campaign::stable_json_fingerprint(&plan.campaign)?;
    }
    validate_native_pls_phase_plan(plan)
}

pub(crate) fn validate_native_pls_phase_plan(plan: &ExecutionPlan) -> Result<()> {
    let native_count = plan
        .node_plans
        .values()
        .filter(|n| n.controller_id.as_str() == METHODS_NATIVE_REGRESSION_CONTROLLER)
        .count();
    if native_count > 0
        && (native_count != 1
            || plan.node_plans.len() != 1
            || plan.graph_plan.graph.nodes.len() != 1
            || !plan.graph_plan.graph.edges.is_empty())
    {
        return Err(refuse(
            "closed PLS role profile requires one model recipe, not an extended graph",
        ));
    }
    for node in plan
        .node_plans
        .values()
        .filter(|n| n.controller_id.as_str() == METHODS_NATIVE_REGRESSION_CONTROLLER)
    {
        if node.controller_version != METHODS_NATIVE_REGRESSION_VERSION
            || node.kind != crate::graph::NodeKind::Model
        {
            return Err(refuse("controller identity/kind mismatch"));
        }
        NativePlsRoleParams::from_params(&node.params)?;
        let graph_node = plan
            .graph_plan
            .graph
            .nodes
            .iter()
            .find(|n| n.id == node.node_id)
            .ok_or_else(|| refuse("missing graph declaration"))?;
        let base = NativePlsRoleParams::from_params(&graph_node.params)?;
        if graph_node.params.contains_key("phase_controls") {
            return Err(refuse("internal phase_controls forbidden in graph"));
        }
        if graph_node.operator.as_ref()
            != Some(&json!({"type":"N4mRolePipeline","steps":base.recipe(Phase::FitCv)}))
        {
            return Err(refuse(
                "graph operator differs from canonical closed recipe",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_native_pls_hpo_space(
    space: &crate::hpo::HpoSearchSpace,
    paths: &BTreeMap<String, String>,
) -> Result<()> {
    use crate::hpo::{HpoCategory, HpoParameter};
    if space.parameters.is_empty() || space.parameters.len() > 2 {
        return Err(refuse("HPOv2 requires n_components and/or scale"));
    }
    let mut expected = BTreeMap::new();
    for p in &space.parameters {
        let name = match p {
            HpoParameter::Int {
                name,
                low: 1,
                high: 3,
                step: 1,
                log: false,
            } if name == "n_components" => name,
            HpoParameter::Categorical { name, values }
                if name == "scale"
                    && values == &vec![HpoCategory::Boolean(false), HpoCategory::Boolean(true)] =>
            {
                name
            }
            _ => return Err(refuse(
                "HPOv2 supports integer n_components=1..3 and categorical scale=[false,true] only",
            )),
        };
        if expected.insert(name.clone(), name.clone()).is_some() {
            return Err(refuse("duplicate HPO owner"));
        }
    }
    if paths != &expected {
        return Err(refuse("HPOv2 parameter_paths must map each public key identically; scale has an atomic native projection"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn params(scale: bool) -> BTreeMap<String, Value> {
        serde_json::from_value(
            json!({"native_profile":METHODS_PLS_ROLE_PROFILE,"n_components":2,"scale":scale}),
        )
        .unwrap()
    }
    #[test]
    fn atomic_scale_has_real_native_flags_and_separate_refit_controls() {
        let mut p = params(true);
        p.insert(
            "phase_controls".into(),
            json!({"train_params":{},"refit_params":{"scale":false,"n_components":1}}),
        );
        let parsed = NativePlsRoleParams::from_params(&p).unwrap();
        let cv = parsed.recipe(Phase::FitCv);
        let refit = parsed.recipe(Phase::Refit);
        assert_eq!(cv[0]["params"]["n_components"], json!(2));
        assert_eq!(cv[0]["params"]["scale_x"], json!(true));
        assert_eq!(refit[0]["params"]["scale_x"], json!(false));
        assert_eq!(refit[0]["params"]["scale_y"], json!(false));
        assert_eq!(refit[0]["params"]["n_components"], json!(1));
        assert_eq!(refit, parsed.recipe(Phase::Predict));
    }
    #[test]
    fn constructor_and_controls_refuse_aliases_and_nonexecuted_keys() {
        for (key, value) in [
            ("tol", json!(1e-6)),
            ("scale_x", json!(false)),
            ("scale_y", json!(true)),
            ("epochs", json!(3)),
            ("warm_start", json!(true)),
        ] {
            let mut p = params(true);
            p.insert(key.into(), value.clone());
            assert!(methods_pls_role_pipeline_contract(&p).is_err(), "{key}");
            assert!(
                validate_native_pls_model_controls(&BTreeMap::from([(key.into(), value)])).is_err()
            );
        }
        for value in [
            json!(true),
            json!(0),
            json!(-1),
            json!(2.5),
            json!(2147483648_i64),
        ] {
            let mut p = params(true);
            p.insert("n_components".into(), value);
            assert!(methods_pls_role_pipeline_contract(&p).is_err());
        }
        let mut p = params(true);
        p.insert("scale".into(), json!(1));
        assert!(methods_pls_role_pipeline_contract(&p).is_err());
    }
    #[test]
    fn snv_sg_recipe_keeps_interp_and_closed_constructor_bounds() {
        let mut p = params(false);
        p.insert("pipeline".into(),json!({"schema_version":1,"pipeline_type":"n4m.snv_savgol_smooth.v1","savgol_window":7,"savgol_poly_degree":2}));
        let result = methods_pls_role_pipeline_contract(&p).unwrap();
        assert_eq!(
            result["operator"]["steps"][1]["params"]["mode"],
            json!("interp")
        );
        assert_eq!(
            result["operator"]["steps"][2]["params"]["scale_y"],
            json!(false)
        );
        p.get_mut("pipeline").unwrap()["savgol_window"] = json!(4);
        assert!(methods_pls_role_pipeline_contract(&p).is_err());
        p.get_mut("pipeline").unwrap()["savgol_window"] = json!(503);
        assert!(methods_pls_role_pipeline_contract(&p).is_err());
    }
    #[test]
    fn hpo_v2_is_closed_and_boolean_categories_cannot_be_numeric_aliases() {
        let combined:crate::hpo::HpoSearchSpace=serde_json::from_value(json!({"parameters":[{"kind":"int","name":"n_components","low":1,"high":3,"step":1,"log":false},{"kind":"categorical","name":"scale","values":[false,true]}]})).unwrap();
        let paths = BTreeMap::from([
            ("n_components".into(), "n_components".into()),
            ("scale".into(), "scale".into()),
        ]);
        validate_native_pls_hpo_space(&combined, &paths).unwrap();
        let scale: crate::hpo::HpoSearchSpace = serde_json::from_value(
            json!({"parameters":[{"kind":"categorical","name":"scale","values":[false,true]}]}),
        )
        .unwrap();
        validate_native_pls_hpo_space(&scale, &BTreeMap::from([("scale".into(), "scale".into())]))
            .unwrap();
        for values in [
            json!([0, 1]),
            json!(["false", "true"]),
            json!([true, false]),
            json!([false]),
        ] {
            let bad: crate::hpo::HpoSearchSpace = serde_json::from_value(
                json!({"parameters":[{"kind":"categorical","name":"scale","values":values}]}),
            )
            .unwrap();
            assert!(validate_native_pls_hpo_space(
                &bad,
                &BTreeMap::from([("scale".into(), "scale".into())])
            )
            .is_err());
        }
        assert!(validate_native_pls_hpo_space(
            &combined,
            &BTreeMap::from([("scale".into(), "scale_x".into())])
        )
        .is_err());
    }
    #[test]
    fn public_contract_resolves_dsl_reference_and_canonical_object_only() {
        let contract = methods_pls_role_pipeline_contract(&params(true)).unwrap();
        let mut registry = crate::ControllerRegistry::new();
        registry
            .register(serde_json::from_value(contract["manifest"].clone()).unwrap())
            .unwrap();
        for operator in [json!("N4mRolePipeline"), contract["operator"].clone()] {
            assert_eq!(
                registry.infer_operator_kind(&operator).unwrap(),
                Some(crate::NodeKind::Model)
            );
        }
        for operator in [
            json!("OtherRolePipeline"),
            json!({"type":"OtherRolePipeline"}),
        ] {
            assert_eq!(registry.infer_operator_kind(&operator).unwrap(), None);
        }
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    fn phase_fixture() -> (ExecutionPlan, TrainingRequest) {
        let request = TrainingRequest::from_json(include_str!(
            "../../../examples/fixtures/training/training_request_refit.v1.json"
        ))
        .unwrap();
        let mut plan = request.project().unwrap().plan;
        let id = NodeId::new("model:base").unwrap();
        let base = params(true);
        let contract = methods_pls_role_pipeline_contract(&base).unwrap();
        let node = plan.node_plans.get_mut(&id).unwrap();
        node.controller_id =
            crate::ControllerId::new(METHODS_NATIVE_REGRESSION_CONTROLLER).unwrap();
        node.controller_version = METHODS_NATIVE_REGRESSION_VERSION.into();
        node.params = base.clone();
        let graph = plan
            .graph_plan
            .graph
            .nodes
            .iter_mut()
            .find(|n| n.id == id)
            .unwrap();
        graph.params = base;
        graph.operator = Some(contract["operator"].clone());
        plan.node_plans.retain(|key, _| key == &id);
        plan.graph_plan.graph.nodes.retain(|n| n.id == id);
        plan.graph_plan.graph.edges.clear();
        (plan, request)
    }
    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn signed_fit_materialization_retains_cv_values_and_binds_refit_to_resume_provenance() {
        let (mut plan, mut request) = phase_fixture();
        request.parameter_patches = vec![
            ParameterPatch {
                schema_version: 1,
                node_id: NodeId::new("model:base").unwrap(),
                namespace: ParameterNamespace::Fit,
                path: vec!["train_params".into()],
                value: json!({"scale":false}),
            },
            ParameterPatch {
                schema_version: 1,
                node_id: NodeId::new("model:base").unwrap(),
                namespace: ParameterNamespace::Fit,
                path: vec!["refit_params".into()],
                value: json!({"scale":true,"n_components":1}),
            },
        ];
        materialize_native_pls_phase_controls(&mut plan, &request).unwrap();
        let node = &plan.node_plans[&NodeId::new("model:base").unwrap()];
        assert_eq!(node.params["scale"], json!(false));
        let parsed = NativePlsRoleParams::from_params(&node.params).unwrap();
        assert_eq!(
            parsed.recipe(Phase::Refit)[0]["params"]["scale_x"],
            json!(true)
        );
        let mut wire = serde_json::to_value(&plan).unwrap();
        wire.sort_all_objects();
        let restored: ExecutionPlan = serde_json::from_value(wire).unwrap();
        assert_eq!(
            restored.campaign_fingerprint,
            crate::campaign::stable_json_fingerprint(&restored.campaign).unwrap()
        );
        let restored_node = &restored.node_plans[&NodeId::new("model:base").unwrap()];
        assert_eq!(
            restored_node.params_fingerprint,
            crate::campaign::stable_json_fingerprint(&restored_node.params).unwrap()
        );
        for patch in &request.parameter_patches {
            validate_native_pls_materialized_fit_patch(&restored, patch).unwrap();
        }
        let before = crate::hpo::campaign_provenance_fingerprint(&plan.campaign).unwrap();
        plan.campaign
            .metadata
            .get_mut("native_pls_phase_controls")
            .unwrap()["model:base"]["refit_params"]["scale"] = json!(false);
        assert_ne!(
            before,
            crate::hpo::campaign_provenance_fingerprint(&plan.campaign).unwrap()
        );
    }
    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn fit_duplicate_and_foreign_owners_are_not_silently_ignored() {
        let (mut plan, mut request) = phase_fixture();
        let patch = ParameterPatch {
            schema_version: 1,
            node_id: NodeId::new("model:base").unwrap(),
            namespace: ParameterNamespace::Fit,
            path: vec!["train_params".into()],
            value: json!({"scale":false}),
        };
        request.parameter_patches = vec![patch.clone(), patch];
        assert!(materialize_native_pls_phase_controls(&mut plan, &request).is_err());
        let (mut plan, mut request) = phase_fixture();
        request.parameter_patches = vec![ParameterPatch {
            schema_version: 1,
            node_id: NodeId::new("transform:snv").unwrap(),
            namespace: ParameterNamespace::Fit,
            path: vec!["train_params".into()],
            value: json!({"scale":false}),
        }];
        assert!(materialize_native_pls_phase_controls(&mut plan, &request).is_err());
    }

    #[cfg(dag_ml_workspace_contract_fixtures)]
    #[test]
    fn materialized_fit_evidence_requires_exact_owner_values_and_provenance() {
        let (mut plan, mut request) = phase_fixture();
        let patch = ParameterPatch {
            schema_version: 1,
            node_id: NodeId::new("model:base").unwrap(),
            namespace: ParameterNamespace::Fit,
            path: vec!["train_params".into()],
            value: json!({"n_components":1,"scale":false}),
        };
        request.parameter_patches = vec![patch.clone()];
        materialize_native_pls_phase_controls(&mut plan, &request).unwrap();
        validate_native_pls_materialized_fit_patch(&plan, &patch).unwrap();
        let mut tampered = patch.clone();
        tampered.value["scale"] = json!(true);
        assert!(validate_native_pls_materialized_fit_patch(&plan, &tampered).is_err());
        let mut tampered = plan.clone();
        tampered
            .node_plans
            .get_mut(&patch.node_id)
            .unwrap()
            .params
            .insert("n_components".into(), json!(2));
        assert!(validate_native_pls_materialized_fit_patch(&tampered, &patch).is_err());
        let mut tampered = plan.clone();
        tampered
            .campaign
            .metadata
            .remove("native_pls_phase_controls");
        assert!(validate_native_pls_materialized_fit_patch(&tampered, &patch).is_err());
        let mut tampered = plan.clone();
        tampered
            .node_plans
            .get_mut(&patch.node_id)
            .unwrap()
            .controller_id = crate::ControllerId::new("controller:methods.pls").unwrap();
        assert!(validate_native_pls_materialized_fit_patch(&tampered, &patch).is_err());
        for path in [
            vec!["train_params".into(), "scale".into()],
            vec!["epochs".into()],
        ] {
            let mut tampered = patch.clone();
            tampered.path = path;
            assert!(validate_native_pls_materialized_fit_patch(&plan, &tampered).is_err());
        }
    }
}
