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
            "/api/config/recommended" | "/api/config/detect-gpu" | "/api/config/diff"
        ) | ("POST", "/api/config/complete-setup")
    ) {
        return None;
    }
    let (settings, host, scientific) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.app_settings.clone(),
            state.python_plugin_host.clone(),
            state.scientific_host.clone(),
        )
    };
    Some(handle(
        &settings,
        request,
        &|| {
            let host = host.as_deref().ok_or("No Python runtime is configured")?;
            crate::read_python_system_build(host).map_err(|error| error.as_str().to_owned())
        },
        &|operation, payload| {
            scientific
                .as_ref()
                .ok_or("No attested runtime is configured")?
                .adapt_document(operation, payload)
        },
    ))
}

fn handle(
    settings: &AppSettingsStore,
    request: &HttpRequest,
    probe: &impl Fn() -> Result<Value, String>,
    adapt: &impl Fn(&str, &Value) -> Result<Value, String>,
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
                let body: Value = serde_json::from_slice(&request.body)
                    .map_err(|error| (400, error.to_string()))?;
                if body.as_object().is_none_or(|value| {
                    value
                        .keys()
                        .any(|key| !matches!(key.as_str(), "profile" | "optional_packages"))
                }) {
                    return Err((400, "Invalid setup completion document".into()));
                }
                let profile = body["profile"]
                    .as_str()
                    .ok_or((400, "Setup requires a profile".into()))?;
                recommended_config::validate_profile(&config, profile)
                    .map_err(|error| (400, error))?;
                if let Some(packages) = body.get("optional_packages") {
                    if packages.as_array().is_none_or(|items| {
                        items.len() > 128 || items.iter().any(|item| !item.is_string())
                    }) {
                        return Err((
                            400,
                            "optional_packages must be a bounded string array".into(),
                        ));
                    }
                }
                // This marks the user's profile choice; it never claims to
                // have installed the listed optional packages.
                settings
                    .complete_setup(profile)
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

#[cfg(test)]
mod tests {
    use super::*;

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
        let adapt = |_: &str, _: &Value| panic!("setup invoked package comparison");
        assert_eq!(handle(&settings, &request, &probe, &adapt).status, 400);
        assert_eq!(settings.setup_status().unwrap()["setup_completed"], false);
        request.body = br#"{"profile":"cpu-lite"}"#.to_vec();
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
}
