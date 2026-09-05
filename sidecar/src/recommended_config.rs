//! Bundled setup configuration and runtime GPU presentation, without installers.

use std::collections::BTreeSet;

use serde_json::{json, Value};

pub fn bundled() -> Result<Value, String> {
    serde_json::from_str(include_str!("../../recommended-config.json"))
        .map_err(|error| format!("Invalid bundled configuration: {error}"))
}

pub const fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

pub fn validate_profile(config: &Value, id: &str) -> Result<(), String> {
    let profile = config["profiles"]
        .get(id)
        .and_then(Value::as_object)
        .ok_or("Unknown compute profile")?;
    if profile
        .get("platforms")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty() && !items.iter().any(|item| item == platform()))
    {
        return Err("Compute profile is incompatible with this platform".into());
    }
    Ok(())
}

pub fn recommended_response(config: &Value, timestamp: &str) -> Result<Value, String> {
    let raw_profiles = config["profiles"]
        .as_object()
        .ok_or("Missing compute profiles")?;
    let mut profiles = Vec::new();
    let mut managed = BTreeSet::new();
    for (id, raw) in raw_profiles {
        if let Some(packages) = raw["packages"].as_object() {
            managed.extend(packages.keys().cloned());
        }
        if validate_profile(config, id).is_err() {
            continue;
        }
        let mut profile = raw.clone();
        profile["id"] = json!(id);
        profiles.push(profile);
    }
    let mut optional = Vec::new();
    if let Some(packages) = config["optional"].as_object() {
        for (name, raw) in packages {
            if managed.contains(name) && raw["show_when_profile_managed"] != true {
                continue;
            }
            let mut package = raw.clone();
            package["name"] = json!(name);
            optional.push(package);
        }
    }
    Ok(
        json!({"schema_version":config["schema_version"],"app_version":config["app_version"],
        "nirs4all":config["nirs4all"],"profiles":profiles,"optional":optional,
        "fetched_from":"bundled","fetched_at":timestamp}),
    )
}

/// Report runtime capability, not an unverified claim about physical hardware.
pub fn gpu_response(config: &Value, probe: &Value) -> Result<Value, String> {
    let gpu = probe["gpu"]
        .as_object()
        .ok_or("Missing GPU runtime probe")?;
    let cuda = gpu
        .get("cuda_available")
        .and_then(Value::as_bool)
        .ok_or("Missing CUDA probe")?;
    let metal = gpu
        .get("metal_available")
        .and_then(Value::as_bool)
        .ok_or("Missing Metal probe")?;
    let candidates = if cuda {
        vec!["gpu-cuda-torch", "cpu"]
    } else if metal {
        vec!["gpu-mps", "cpu"]
    } else {
        vec!["cpu"]
    };
    let recommended: Vec<_> = candidates
        .into_iter()
        .filter(|id| validate_profile(config, id).is_ok())
        .collect();
    Ok(
        json!({"has_cuda":cuda,"has_metal":metal,"cuda_version":gpu.get("cuda_version"),
        "gpu_name":gpu.get("device_name"),"driver_version":gpu.get("driver_version"),
        "torch_cuda_available":gpu.get("torch_cuda_available"),"torch_version":gpu.get("torch_version"),
        "detection_source":gpu.get("detection_source"),"recommended_profiles":recommended,
        "detection_scope":"selected_runtime_capabilities"}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_profiles_and_optionals_preserve_historical_document_contract() {
        let config = bundled().unwrap();
        let response = recommended_response(&config, "2026-09-05T00:00:00Z").unwrap();
        assert_eq!(response["fetched_from"], "bundled");
        let profiles = response["profiles"].as_array().unwrap();
        assert!(profiles.iter().any(|profile| profile["id"] == "cpu"));
        assert!(profiles.iter().any(|profile| profile["id"] == "cpu-lite"));
        assert!(response["optional"]
            .as_array()
            .unwrap()
            .iter()
            .any(|package| package["name"] == "tabicl"));
        assert!(validate_profile(&config, "not-a-profile").is_err());
    }

    #[test]
    fn recommends_only_confirmed_runtime_capabilities_and_compatible_profiles() {
        let config = bundled().unwrap();
        let probe = json!({"gpu":{"cuda_available":false,"metal_available":false,
            "torch_cuda_available":false,"torch_version":null,"detection_source":"python_plugin_no_torch"}});
        let response = gpu_response(&config, &probe).unwrap();
        assert_eq!(response["recommended_profiles"], json!(["cpu"]));
        assert_eq!(response["has_cuda"], false);
        assert_eq!(response["detection_scope"], "selected_runtime_capabilities");
        assert!(gpu_response(&config, &json!({"gpu":{}})).is_err());
    }
}
