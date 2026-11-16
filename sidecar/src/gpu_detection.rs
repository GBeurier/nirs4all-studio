//! On-demand GPU probe of the selected Python environment.
//!
//! This is the only route that imports torch. It runs when the renderer asks
//! for it, outside the global state lock, and never at application startup.

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use serde_json::{json, Value};

use crate::{
    python_probe_cache::ProbeKind, HttpRequest, HttpResponse, PythonPluginBridgeFailure,
    SidecarState,
};

pub const ROUTE: &str = "/api/config/detect-gpu";

const PROBE_SCRIPT: &str = "import json\ngpu={'cuda_available':False,'metal_available':False,'device_name':None,'cuda_version':None,'torch_version':None,'detection_source':'python_plugin_no_torch'}\ntry:\n import torch\n gpu['detection_source']='python_plugin_torch'\n gpu['torch_version']=str(getattr(torch,'__version__','unknown'))\n gpu['cuda_version']=getattr(getattr(torch,'version',None),'cuda',None)\n gpu['cuda_available']=bool(torch.cuda.is_available())\n gpu['metal_available']=bool(getattr(getattr(torch,'backends',None),'mps',None) and torch.backends.mps.is_available())\n if gpu['cuda_available'] and torch.cuda.device_count(): gpu['device_name']=str(torch.cuda.get_device_name(0))\nexcept Exception: pass\nprint(json.dumps(gpu, separators=(',',':'), sort_keys=True))";

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if request.path != ROUTE {
        return None;
    }
    if request.method != "GET" {
        return Some(crate::method_not_allowed(&request.method, ROUTE, "GET"));
    }
    let detail =
        |status, detail: &str| HttpResponse::json(status, json!({"detail": detail}).to_string());
    if request.query.is_some() {
        return Some(detail(400, "GPU detection takes no query fields"));
    }
    let (host, probes) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.python_plugin_host.clone(),
            state.python_probes.clone(),
        )
    };
    let Some(host) = host else {
        return Some(detail(503, "No Python runtime is configured"));
    };
    Some(
        match probes.get_or_probe(ProbeKind::Gpu, &host, || probe(&host)) {
            Ok(gpu) => HttpResponse::json(200, response(&gpu).to_string()),
            Err(error) => detail(503, error.as_str()),
        },
    )
}

fn probe(host: &Path) -> Result<Value, PythonPluginBridgeFailure> {
    let gpu = crate::run_python_plugin_json(
        host,
        PROBE_SCRIPT,
        crate::PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
    )?;
    let nullable_string = |key: &str| gpu.get(key).is_some_and(|v| v.is_null() || v.is_string());
    if ["cuda_available", "metal_available"]
        .iter()
        .all(|key| gpu.get(*key).is_some_and(Value::is_boolean))
        && ["device_name", "cuda_version", "torch_version"]
            .iter()
            .all(|key| nullable_string(key))
        && gpu.get("detection_source").is_some_and(Value::is_string)
    {
        Ok(gpu)
    } else {
        Err(PythonPluginBridgeFailure::MalformedResponse)
    }
}

/// Report what the selected environment can use, not an unverified claim
/// about physical hardware.
fn response(gpu: &Value) -> Value {
    json!({
        "has_cuda": gpu["cuda_available"],
        "has_metal": gpu["metal_available"],
        "cuda_version": gpu["cuda_version"],
        "gpu_name": gpu["device_name"],
        "torch_version": gpu["torch_version"],
        "detection_source": gpu["detection_source"],
        "detection_scope": "selected_runtime_capabilities",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn request(method: &str, query: Option<&str>) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: ROUTE.into(),
            query: query.map(str::to_owned),
            headers: BTreeMap::new(),
            body: Vec::new(),
        }
    }

    #[test]
    fn detection_is_a_bare_get_that_needs_a_configured_environment() {
        let state = Arc::new(Mutex::new(SidecarState::default()));
        assert_eq!(route(&state, &request("GET", None)).unwrap().status, 503);
        assert_eq!(
            route(&state, &request("GET", Some("refresh=true")))
                .unwrap()
                .status,
            400
        );
        assert_eq!(route(&state, &request("POST", None)).unwrap().status, 405);
        let mut other = request("GET", None);
        other.path = "/api/config/recommended".into();
        assert!(route(&state, &other).is_none());
    }

    #[test]
    fn response_reports_the_probed_runtime_without_profiles() {
        let gpu = json!({"cuda_available":true,"metal_available":false,"device_name":"Example GPU",
            "cuda_version":"12.4","torch_version":"2.6.0","detection_source":"python_plugin_torch"});
        assert_eq!(
            response(&gpu),
            json!({"has_cuda":true,"has_metal":false,"cuda_version":"12.4","gpu_name":"Example GPU",
                "torch_version":"2.6.0","detection_source":"python_plugin_torch",
                "detection_scope":"selected_runtime_capabilities"})
        );
    }

    #[cfg(unix)]
    #[test]
    fn probe_runs_in_the_selected_interpreter_and_refuses_open_shapes() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let host = |name: &str, output: &str| {
            let path = root.path().join(name);
            std::fs::write(&path, format!("#!/bin/sh\nprintf '%s' '{output}'\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
            path
        };
        let reported = r#"{"cuda_available":false,"metal_available":false,"device_name":null,"cuda_version":null,"torch_version":null,"detection_source":"python_plugin_no_torch"}"#;
        assert_eq!(
            probe(&host("python", reported)).unwrap()["detection_source"],
            "python_plugin_no_torch"
        );
        assert_eq!(
            probe(&host("open", r#"{"cuda_available":"yes"}"#)),
            Err(PythonPluginBridgeFailure::MalformedResponse)
        );
    }
}
