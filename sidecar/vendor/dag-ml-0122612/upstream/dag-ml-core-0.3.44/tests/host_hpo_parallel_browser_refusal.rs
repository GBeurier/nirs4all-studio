//! Public worker APIs used by the browser must not accept a native-only profile.
#![cfg(dag_ml_workspace_contract_fixtures)]
use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use dag_ml_core::*;
use serde_json::{json, Value};

#[derive(Default)]
struct Calls {
    proposals: AtomicUsize,
    feedback: AtomicUsize,
    progress: AtomicUsize,
    providers: AtomicUsize,
    controllers: AtomicUsize,
}

struct Proposals(Arc<Calls>);
impl HostHpoProposalSource for Proposals {
    fn ask(&mut self, _: u32) -> Result<Option<BTreeMap<String, Value>>> {
        self.0.proposals.fetch_add(1, Ordering::SeqCst);
        Ok(Some(BTreeMap::from([("n_estimators".into(), json!(10))])))
    }
    fn tell(&mut self, _: u32, _: f64) -> Result<()> {
        self.0.feedback.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn fail(&mut self, _: u32, _: &str) -> Result<()> {
        self.0.feedback.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

struct Progress(Arc<Calls>);
impl HostHpoProgress for Progress {
    fn prepare_terminal(&mut self, _: &HostHpoCheckpoint, _: HostHpoSearchStatus) -> Result<()> {
        self.0.progress.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn checkpoint(&mut self, _: &HostHpoCheckpoint, _: HostHpoSearchStatus) -> Result<bool> {
        self.0.progress.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    }
}

struct Provider(Arc<Calls>);
impl Provider {
    fn unexpected<T>(&self) -> Result<T> {
        self.0.providers.fetch_add(1, Ordering::SeqCst);
        Err(DagMlError::RuntimeValidation(
            "unexpected browser provider callback".into(),
        ))
    }
}
impl RuntimeDataProvider for Provider {
    fn materialize(&self, _: &DataMaterializationRequest) -> Result<HandleRef> {
        self.unexpected()
    }
    fn make_view(&self, _: &DataViewRequest) -> Result<HandleRef> {
        self.unexpected()
    }
    fn coordinator_relations(&self, _: &DataBinding) -> Result<Option<SampleRelationSet>> {
        self.unexpected()
    }
    fn generated_view_manifest(&self) -> Result<Option<Value>> {
        self.unexpected()
    }
}

struct Controller {
    id: ControllerId,
    calls: Arc<Calls>,
}
impl RuntimeController for Controller {
    fn controller_id(&self) -> &ControllerId {
        &self.id
    }
    fn invoke(&self, _: &NodeTask) -> Result<NodeResult> {
        self.calls.controllers.fetch_add(1, Ordering::SeqCst);
        Err(DagMlError::RuntimeValidation(
            "unexpected browser controller callback".into(),
        ))
    }
}

fn fixture(
    calls: &Arc<Calls>,
) -> (
    ExecutionPlan,
    HostHpoSearchRequest,
    RuntimeControllerRegistry,
) {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../examples/fixtures/training/python_training_smoke.v1.json"
    ))
    .unwrap();
    let training: TrainingRequest = serde_json::from_value(fixture["request"].clone()).unwrap();
    let mut manifests = ControllerRegistry::new();
    let mut controllers = RuntimeControllerRegistry::new();
    for manifest in training.controller_manifests {
        controllers
            .register(Box::new(Controller {
                id: manifest.controller_id.clone(),
                calls: calls.clone(),
            }))
            .unwrap();
        manifests.register(manifest).unwrap();
    }
    let plan = build_execution_plan(
        "plan:browser.profile.refusal",
        training.graph,
        training.campaign,
        &manifests,
    )
    .unwrap();
    let request = serde_json::from_value(json!({
        "target_node": "model:base", "trial_budget": 2, "metric": "rmse",
        "direction": "minimize", "optimizer_descriptor": {
            "owner": "browser.legacy.test", "sampler": "random", "n_jobs": 2
        }
    }))
    .unwrap();
    (plan, request, controllers)
}

#[test]
fn public_browser_worker_apis_refuse_all_native_profile_declarations_before_callbacks() {
    let calls = Arc::new(Calls::default());
    let (plan, mut request, controllers) = fixture(&calls);
    let options = HostHpoResumeOptions {
        checkpoint: None,
        data_fingerprint: "browser.profile.refusal:data".into(),
    };
    let mut legacy_proposals = Proposals(calls.clone());
    let legacy_wire = serde_json::to_value(&request).unwrap();
    let window =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut legacy_proposals, 2)
            .unwrap();
    assert_eq!(window.tasks.len(), 2);
    assert_eq!(calls.proposals.swap(0, Ordering::SeqCst), 2);
    let provider = Provider(calls.clone());
    let valid = json!({
        "schema_version": 1, "profile": "methods_sequential_cpu_v1", "workers": 2,
        "cpu_threads": 1, "gpu_devices": [],
        "methods_build": {"schema_version": 1, "blas": false, "openmp": false, "cuda": false}
    });
    let mut accelerated = valid.clone();
    accelerated["methods_build"]["openmp"] = json!(true);
    let mut oversized = valid.clone();
    oversized["workers"] = json!(5);
    for (name, descriptor, workers) in [
        ("valid", valid, 2),
        ("null", json!(null), 2),
        ("malformed", json!("not a profile"), 2),
        (
            "unknown fields",
            json!({"schema_version": 1, "extra": true}),
            2,
        ),
        ("accelerated", accelerated, 2),
        ("oversized", oversized, 5),
    ] {
        request
            .optimizer_descriptor
            .insert("parallel_execution".into(), descriptor);
        request
            .optimizer_descriptor
            .insert("n_jobs".into(), json!(workers));
        if name == "valid" {
            assert!(request.validate_parallel_execution(workers).is_ok());
        }
        let mut proposals = Proposals(calls.clone());
        let mut progress = Progress(calls.clone());
        // A genuine historical task cannot bypass admission through a direct API.
        let errors = [
            prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, workers)
                .unwrap_err(),
            evaluate_host_hpo_worker_task(&window.tasks[0], &request, &controllers, &provider)
                .unwrap_err(),
            evaluate_host_hpo_worker_fold(
                &window.tasks[0],
                &request,
                0,
                &controllers,
                &provider,
                &options.data_fingerprint,
            )
            .unwrap_err(),
            complete_host_hpo_worker_window(
                &plan,
                &request,
                &options,
                window.clone(),
                Vec::new(),
                &mut proposals,
                &mut progress,
            )
            .unwrap_err(),
        ];
        for error in errors {
            assert!(
                error.to_string().contains("native-only profile"),
                "{name}: {error}"
            );
        }
        for count in [
            &calls.proposals,
            &calls.feedback,
            &calls.progress,
            &calls.providers,
            &calls.controllers,
        ] {
            assert_eq!(
                count.load(Ordering::SeqCst),
                0,
                "{name} reached a host callback"
            );
        }
    }
    request.optimizer_descriptor.remove("parallel_execution");
    request
        .optimizer_descriptor
        .insert("n_jobs".into(), json!(2));
    assert_eq!(serde_json::to_value(&request).unwrap(), legacy_wire);
    let mut proposals = Proposals(calls.clone());
    let legacy =
        prepare_host_hpo_worker_window(&plan, &request, &options, &mut proposals, 2).unwrap();
    assert_eq!(legacy.window_id, window.window_id);
    assert_eq!(calls.proposals.load(Ordering::SeqCst), 2);
}
