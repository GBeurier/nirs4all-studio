//! Setup routes release the global state lock before inspecting the runtime.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

use serde_json::{json, Value};

use crate::{
    recommended_config, settings::AppSettingsStore, HttpRequest, HttpResponse, SidecarState,
};

pub fn route(state: &Arc<Mutex<SidecarState>>, request: &HttpRequest) -> Option<HttpResponse> {
    if !matches!(
        (request.method.as_str(), request.path.as_str()),
        (
            "GET",
            "/api/config/recommended"
                | "/api/config/detect-gpu"
                | "/api/config/diff"
                | "/api/updates/dependencies"
        ) | (
            "POST",
            "/api/config/complete-setup" | "/api/updates/dependencies/refresh"
        )
    ) {
        return None;
    }
    let (settings, host, scientific, reused_runtime, probes) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.app_settings.clone(),
            state.python_plugin_host.clone(),
            state.scientific_host.clone(),
            !state.python_plugin_host_bundled,
            state.python_probes.clone(),
        )
    };
    Some(handle_with_policy(
        &settings,
        request,
        &|| {
            let host = host.as_deref().ok_or("No Python runtime is configured")?;
            crate::cached_python_system_build(&probes, host)
                .map_err(|error| error.as_str().to_owned())
        },
        &|operation, payload| {
            if request.path == "/api/config/complete-setup"
                && scientific
                    .as_ref()
                    .is_none_or(|host| !host.library_facades_available())
            {
                return Err("The scientific runtime is not ready. Prepare the Python environment before completing setup.".into());
            }
            let host = host.as_deref().ok_or("No Python runtime is configured")?;
            inspect_runtime_configuration(host, operation, payload)
        },
        reused_runtime,
    ))
}

// Package metadata remains inspectable before the scientific plugin is ready.
// This bounded probe embeds Studio's adapter and never imports nirs4all or pip.
fn inspect_runtime_configuration(
    host: &std::path::Path,
    operation: &str,
    payload: &Value,
) -> Result<Value, String> {
    let function = match operation {
        "config.dependencies" => "dependency_inventory",
        "config.compare" => "compare_configuration",
        _ => return Err("Unknown runtime configuration operation".into()),
    };
    let document = serde_json::to_string(payload).map_err(|error| error.to_string())?;
    let literal = serde_json::to_string(&document).map_err(|error| error.to_string())?;
    let script = format!(
        "{}\nimport json\nprint(json.dumps({function}(json.loads({literal})), allow_nan=False))",
        include_str!("../../api/library_runtime_config.py")
    );
    crate::run_python_plugin_json_with_limit(
        host,
        &script,
        crate::PYTHON_PLUGIN_CAPABILITIES_TIMEOUT,
        crate::document_cpython::MAX_DOCUMENT_BYTES,
    )
    .map_err(|error| format!("Python package inventory unavailable: {}", error.as_str()))
}

#[cfg(test)]
fn handle(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    probe: &impl Fn() -> Result<Value, String>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> HttpResponse {
    handle_with_policy(settings, request, probe, adapt, false)
}

fn handle_with_policy(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    probe: &impl Fn() -> Result<Value, String>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
    reused_runtime: bool,
) -> HttpResponse {
    let result = (|| -> Result<Value, (u16, String)> {
        let config = recommended_config::bundled().map_err(|error| (500, error))?;
        let mut query = BTreeMap::new();
        for (key, value) in
            url::form_urlencoded::parse(request.query.as_deref().unwrap_or("").as_bytes())
        {
            if query.insert(key.into_owned(), value.into_owned()).is_some() {
                return Err((400, "Duplicate configuration query field".into()));
            }
        }
        match request.path.as_str() {
            "/api/updates/dependencies" | "/api/updates/dependencies/refresh" => {
                dependency_inventory_response(request, &query, &config, adapt)
            }

            "/api/config/recommended" => {
                if query.keys().any(|key| key != "force_refresh") {
                    return Err((400, "Unknown recommended configuration query".into()));
                }
                if query
                    .get("force_refresh")
                    .is_some_and(|value| value.parse::<bool>().is_err())
                {
                    return Err((400, "force_refresh must be true or false".into()));
                }
                recommended_config::recommended_response(
                    &config,
                    &crate::websocket_transport::rfc3339_now(),
                )
                .map_err(|error| (500, error))
            }
            "/api/config/detect-gpu" => {
                if !query.is_empty() {
                    return Err((400, "GPU detection takes no query fields".into()));
                }
                recommended_config::gpu_response(&config, &probe().map_err(|error| (503, error))?)
                    .map_err(|error| (503, error))
            }
            "/api/config/diff" => {
                if query.keys().any(|key| {
                    !matches!(
                        key.as_str(),
                        "profile" | "include_optional" | "include_latest"
                    )
                }) {
                    return Err((400, "Unknown configuration comparison query".into()));
                }
                let status = settings.setup_status().map_err(|error| (500, error))?;
                let profile = query
                    .get("profile")
                    .map(String::as_str)
                    .or_else(|| status["selected_profile"].as_str())
                    .unwrap_or("cpu");
                recommended_config::validate_profile(&config, profile)
                    .map_err(|error| (400, error))?;
                let mut payload = json!({"config":config,"profile":profile});
                for name in ["include_optional", "include_latest"] {
                    if let Some(value) = query.get(name) {
                        let parsed = value
                            .parse::<bool>()
                            .map_err(|_| (400, format!("{name} must be true or false")))?;
                        payload[name] = json!(parsed);
                    }
                }
                adapt("config.compare", &payload).map_err(|error| (503, error))
            }
            "/api/config/complete-setup" => {
                if !query.is_empty() {
                    return Err((400, "Setup completion takes no query fields".into()));
                }
                let profile = setup_profile(&config, &request.body)?;
                let ready = if reused_runtime {
                    let inventory = adapt("config.dependencies", &json!({"config":config}))
                        .map_err(|error| (503, error))?;
                    inventory["runtime_valid"] == true
                } else {
                    let comparison = adapt(
                        "config.compare",
                        &json!({"config":config,"profile":profile,"include_optional":false,"include_latest":false}),
                    ).map_err(|error| (503, error))?;
                    comparison["is_aligned"] == true
                };
                if !ready {
                    return Err((409, "Required runtime packages are missing or incompatible. Repair the Studio installation before completing setup.".into()));
                }
                // Only persist a profile verified against this runtime.
                settings
                    .complete_setup(&profile)
                    .map_err(|error| (500, error))
            }
            _ => Err((404, "Unknown configuration route".into())),
        }
    })();
    match result {
        Ok(value) => HttpResponse::json(200, value.to_string()),
        Err((status, detail)) => HttpResponse::json(status, json!({"detail":detail}).to_string()),
    }
}

fn dependency_inventory_response(
    request: &HttpRequest,
    query: &BTreeMap<String, String>,
    config: &Value,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
) -> Result<Value, (u16, String)> {
    if (request.method == "POST" && !query.is_empty())
        || query.keys().any(|key| key != "force_refresh")
        || query
            .get("force_refresh")
            .is_some_and(|value| value.parse::<bool>().is_err())
    {
        return Err((400, "Invalid dependency inventory query".into()));
    }
    let inventory =
        adapt("config.dependencies", &json!({"config":config})).map_err(|error| (503, error))?;
    if request.method == "POST" {
        Ok(json!({"success":true,"message":"Dependency inventory refreshed"}))
    } else {
        Ok(inventory)
    }
}

fn setup_profile(config: &Value, bytes: &[u8]) -> Result<String, (u16, String)> {
    let body: Value = serde_json::from_slice(bytes).map_err(|error| (400, error.to_string()))?;
    if body.as_object().is_none_or(|value| {
        value
            .keys()
            .any(|key| !matches!(key.as_str(), "profile" | "optional_packages"))
    }) {
        return Err((400, "Invalid setup completion document".into()));
    }
    let profile = body["profile"]
        .as_str()
        .ok_or_else(|| (400, "Setup requires a profile".into()))?;
    recommended_config::validate_profile(config, profile).map_err(|error| (400, error))?;
    if let Some(packages) = body.get("optional_packages") {
        if packages
            .as_array()
            .is_none_or(|items| items.len() > 128 || items.iter().any(|item| !item.is_string()))
        {
            return Err((
                400,
                "optional_packages must be a bounded string array".into(),
            ));
        }
    }
    Ok(profile.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_diagnostics_do_not_qualify_an_unready_scientific_runtime_for_setup() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path());
        let state = Arc::new(Mutex::new(SidecarState {
            app_settings: settings.clone(),
            ..SidecarState::default()
        }));
        let mut request = HttpRequest {
            method: "POST".into(),
            path: "/api/config/complete-setup".into(),
            query: None,
            headers: BTreeMap::new(),
            body: br#"{"profile":"cpu"}"#.to_vec(),
        };
        assert_eq!(route(&state, &request).unwrap().status, 503);
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], false);
        request.body = br#"{"profile":"unknown"}"#.to_vec();
        assert_eq!(route(&state, &request).unwrap().status, 400);
    }

    #[cfg(unix)]
    #[test]
    fn metadata_inventory_uses_its_document_budget_without_a_scientific_host() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let host = root.path().join("python");
        let inventory = json!({"read_only":true,"runtime_valid":false,"categories":[],
            "description":"x".repeat(crate::MAX_PYTHON_PLUGIN_OUTPUT_BYTES + 1)});
        std::fs::write(&host, format!("#!/bin/sh\n[ \"$1\" = '-I' ] && [ \"$2\" = '-B' ] && [ \"$3\" = '-c' ] || exit 1\nprintf '%s' '{inventory}'\n")).unwrap();
        std::fs::set_permissions(&host, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            inspect_runtime_configuration(&host, "config.dependencies", &json!({"config":{}}))
                .unwrap(),
            inventory
        );
        assert!(inspect_runtime_configuration(&host, "pip.install", &json!({})).is_err());
    }

    #[test]
    fn inventory_and_refresh_use_read_only_adapter_and_validate_queries() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path());
        let probe = || panic!("inventory invoked GPU probe");
        let adapt = |operation: &str, payload: &Value| {
            assert_eq!(operation, "config.dependencies");
            assert!(payload["config"]["optional"].is_object());
            Ok(json!({"read_only":true,"categories":[]}))
        };
        let mut request = HttpRequest {
            method: "GET".into(),
            path: "/api/updates/dependencies".into(),
            query: Some("force_refresh=true".into()),
            headers: BTreeMap::new(),
            body: Vec::new(),
        };
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 200);
        for query in [
            "force_refresh=1",
            "install=true",
            "force_refresh=true&force_refresh=false",
        ] {
            request.query = Some(query.into());
            assert_eq!(handle(&settings, &request, &probe, &adapt).status, 400);
        }
        request.method = "POST".into();
        request.path = "/api/updates/dependencies/refresh".into();
        request.query = None;
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 200);
        let unavailable = |_: &str, _: &Value| Err("No attested runtime is configured".into());
        assert_eq!(
            handle(&settings, &request, &probe, &unavailable).status,
            503
        );
        request.query = Some("force_refresh=true".into());
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 400);
    }

    #[test]
    fn invalid_setup_does_not_persist_and_diff_reuses_confirmed_profile() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path());
        let mut request = HttpRequest {
            method: "POST".into(),
            path: "/api/config/complete-setup".into(),
            query: None,
            headers: BTreeMap::new(),
            body: br#"{"profile":"not-a-profile"}"#.to_vec(),
        };
        let probe = || panic!("setup invoked GPU probe");
        let adapt = |operation: &str, _: &Value| {
            assert_eq!(operation, "config.compare");
            Ok(json!({"is_aligned":true}))
        };
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 400);
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], false);
        request.body = br#"{"profile":"cpu-lite"}"#.to_vec();
        let incomplete = |_: &str, _: &Value| Ok(json!({"is_aligned":false}));
        assert_eq!(handle(&settings, &request, &probe, &incomplete).status, 409);
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], false);
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 200);
        request.method = "GET".into();
        request.path = "/api/config/diff".into();
        request.body.clear();
        request.query = Some("include_optional=true".into());
        let response = handle(&settings, &request, &probe, &|operation, payload| {
            assert_eq!(operation, "config.compare");
            assert_eq!(payload["profile"], "cpu-lite");
            assert_eq!(payload["include_optional"], true);
            Ok(json!({"is_aligned":false}))
        });
        assert_eq!(response.status, 200);
    }
    #[test]
    fn existing_runtime_setup_does_not_require_optional_profile_packages() {
        let root = tempfile::tempdir().unwrap();
        let settings = AppSettingsStore::new(root.path());
        let request = HttpRequest {
            method: "POST".into(),
            path: "/api/config/complete-setup".into(),
            query: None,
            headers: BTreeMap::new(),
            body: br#"{"profile":"cpu"}"#.to_vec(),
        };
        let probe = || panic!("setup invoked GPU probe");
        let incompatible = |_: &str, _: &Value| Ok(json!({"runtime_valid":false}));
        assert_eq!(
            handle_with_policy(&settings, &request, &probe, &incompatible, true).status,
            409
        );
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], false);
        let compatible = |operation: &str, _: &Value| {
            assert_eq!(operation, "config.dependencies");
            Ok(json!({"runtime_valid":true}))
        };
        assert_eq!(
            handle_with_policy(&settings, &request, &probe, &compatible, true).status,
            200
        );
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], true);
    }
}
