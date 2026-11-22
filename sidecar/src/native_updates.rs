//! Application update discovery for the desktop product.
//!
//! Studio is published as platform installers only. This module asks GitHub
//! for the newest release of the configured repository, selects the installer
//! published for the running platform, reads the SHA-256 checksum file
//! published next to it and reports the result, so that the application can
//! offer the user a link to download that installer. It never downloads or
//! installs the application itself.

use std::{
    env,
    io::Read,
    sync::{Arc, Mutex},
    time::Duration,
};

use reqwest::blocking::{Client, Response};
use reqwest::redirect::Policy;
use semver::Version;
use serde_json::{json, Value};
use url::Url;

use crate::{websocket_transport::rfc3339_now, HttpResponse, SidecarState};

const MAX_INSTALLER_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_RELEASE_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug)]
pub struct NativeUpdater {
    config: Arc<UpdateConfig>,
    release: Arc<Mutex<Option<ReleaseInfo>>>,
    last_check: Arc<Mutex<Option<String>>>,
    preferences: Arc<Mutex<UpdatePreferences>>,
}

#[derive(Debug)]
struct UpdateConfig {
    current_version: String,
    api_base: String,
}

#[derive(Clone, Debug)]
struct UpdatePreferences {
    github_repo: String,
    prerelease: bool,
    offline_mode: String,
    check_interval_hours: i64,
}

impl Default for UpdatePreferences {
    fn default() -> Self {
        Self {
            github_repo: "GBeurier/nirs4all-studio".into(),
            prerelease: false,
            offline_mode: "auto".into(),
            check_interval_hours: 24,
        }
    }
}

#[derive(Clone, Debug)]
struct ReleaseInfo {
    version: String,
    release_url: Option<String>,
    notes: String,
    published_at: Option<String>,
    asset_name: String,
    download_url: String,
    size: u64,
    sha256: String,
    prerelease: bool,
}

impl Default for NativeUpdater {
    fn default() -> Self {
        Self::from_environment()
    }
}

impl NativeUpdater {
    #[must_use]
    pub fn from_environment() -> Self {
        Self::new(
            env::var("NIRS4ALL_APP_VERSION")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "unknown".into()),
            (env::var("CI").as_deref() == Ok("1"))
                .then(|| env::var("NIRS4ALL_UPDATE_API_BASE").ok())
                .flatten()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "https://api.github.com".into()),
        )
    }

    fn new(current_version: String, api_base: String) -> Self {
        Self {
            config: Arc::new(UpdateConfig {
                current_version,
                api_base,
            }),
            release: Arc::new(Mutex::new(None)),
            last_check: Arc::new(Mutex::new(None)),
            preferences: Arc::new(Mutex::new(UpdatePreferences::default())),
        }
    }

    fn sync_preferences(&self, settings: &Value) {
        let mut preferences = self
            .preferences
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let previous_channel = (preferences.github_repo.clone(), preferences.prerelease);
        if let Some(repo) = settings.get("github_repo").and_then(Value::as_str) {
            preferences.github_repo = repo.into();
        }
        preferences.prerelease = settings
            .get("prerelease_channel")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        preferences.offline_mode = settings
            .get("offline_mode")
            .and_then(Value::as_str)
            .unwrap_or("auto")
            .into();
        preferences.check_interval_hours = settings
            .get("check_interval_hours")
            .and_then(Value::as_i64)
            .unwrap_or(24);
        if previous_channel != (preferences.github_repo.clone(), preferences.prerelease) {
            *self
                .release
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
            *self
                .last_check
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        }
    }

    fn check(&self) -> Result<ReleaseInfo, String> {
        let preferences = self
            .preferences
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if effective_offline(&preferences) {
            return Err("Update check is disabled by offline mode".into());
        }
        if !valid_github_repo(&preferences.github_repo) {
            return Err("Configured GitHub repository must be an owner/name identifier".into());
        }
        let base = validate_network_url(&self.config.api_base, true)?;
        let endpoint = base
            .join(&format!(
                "/repos/{}/releases{}",
                preferences.github_repo,
                if preferences.prerelease {
                    "?per_page=20"
                } else {
                    "/latest"
                }
            ))
            .map_err(|error| format!("Invalid GitHub release endpoint: {error}"))?;
        let fixture = base.scheme() == "http";
        let client = Client::builder()
            .timeout(NETWORK_TIMEOUT)
            .redirect(update_redirect_policy(fixture))
            .user_agent(format!("nirs4all-studio/{}", self.config.current_version))
            .build()
            .map_err(|error| format!("Could not create update HTTP client: {error}"))?;
        let response = client
            .get(endpoint)
            .header("Accept", "application/vnd.github+json")
            .send()
            .map_err(|error| format!("GitHub release check failed: {error}"))?
            .error_for_status()
            .map_err(|error| format!("GitHub release check failed: {error}"))?;
        let payload = read_bounded_response(response, MAX_RELEASE_RESPONSE_BYTES)?;
        let mut release_json: Value = serde_json::from_slice(&payload)
            .map_err(|error| format!("GitHub release response is invalid JSON: {error}"))?;
        if preferences.prerelease {
            release_json = release_json
                .as_array()
                .and_then(|releases| releases.first())
                .cloned()
                .ok_or("GitHub release list is empty")?;
        }
        let release = parse_release(&client, &base, &release_json, preferences.prerelease)?;
        *self
            .release
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(release.clone());
        *self
            .last_check
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(rfc3339_now());
        Ok(release)
    }

    fn update_available(&self, version: &str) -> bool {
        strictly_newer(version, &self.config.current_version).unwrap_or(false)
    }

    fn status_json(&self, refresh: bool) -> Result<Value, String> {
        let release = if refresh {
            Some(self.check()?)
        } else {
            self.release
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        };
        Ok(json!({
            "webapp": release.as_ref().map_or_else(
                || json!({
                    "current_version": self.config.current_version,
                    "latest_version": null,
                    "update_available": false,
                    "release_url": null,
                    "release_notes": null,
                    "published_at": null,
                    "download_size_bytes": null,
                    "download_url": null,
                    "asset_name": null,
                    "checksum_sha256": null,
                    "is_prerelease": false,
                    "installer_download_url": null,
                    "installer_asset_name": null,
                }),
                |release| self.release_json(release),
            ),
            "update_capability": update_capability(),
            "last_check": self.last_check.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            "check_interval_hours": self.preferences.lock().unwrap_or_else(std::sync::PoisonError::into_inner).check_interval_hours,
        }))
    }

    fn release_json(&self, release: &ReleaseInfo) -> Value {
        json!({
            "current_version": self.config.current_version,
            "latest_version": release.version,
            "update_available": self.update_available(&release.version),
            "release_url": release.release_url,
            "release_notes": release.notes,
            "published_at": release.published_at,
            "download_size_bytes": release.size,
            "download_url": release.download_url,
            "asset_name": release.asset_name,
            "checksum_sha256": release.sha256,
            "is_prerelease": release.prerelease,
            "installer_download_url": release.download_url,
            "installer_asset_name": release.asset_name,
        })
    }

    fn changelog(&self, current_version: Option<&str>) -> Value {
        let release = self
            .release
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let entries = release.into_iter().map(|release| {
            json!({
                "version": release.version,
                "date": release.published_at,
                "body": release.notes,
                "prerelease": release.prerelease,
            })
        });
        json!({
            "entries": entries.collect::<Vec<_>>(),
            "current_version": current_version.unwrap_or(&self.config.current_version),
        })
    }
}

/// Serve the application-update routes.
///
/// Any path below `/api/updates/webapp/` that is not listed is refused with
/// 404.
#[must_use]
pub fn route(state: &SidecarState, method: &str, path: &str) -> Option<HttpResponse> {
    if method == "GET" && path.starts_with("/api/updates/webapp/changelog") {
        let current_version = match parse_changelog_query(path) {
            Ok(version) => version,
            Err(error) => return Some(detail(400, error)),
        };
        let updater = state.native_updater.clone();
        updater.sync_preferences(&state.update_settings.load());
        return Some(HttpResponse::json(
            200,
            updater.changelog(current_version.as_deref()).to_string(),
        ));
    }
    let owned = path == "/api/updates/status"
        || path == "/api/updates/check"
        || path.starts_with("/api/updates/webapp/");
    if !owned {
        return None;
    }
    let expected = match path {
        "/api/updates/status" => "GET",
        "/api/updates/check" | "/api/updates/webapp/restart" => "POST",
        _ => return Some(detail(404, "Update route not found")),
    };
    if method != expected {
        return Some(detail(405, "Method Not Allowed").with_header("Allow", expected));
    }
    let updater = state.native_updater.clone();
    updater.sync_preferences(&state.update_settings.load());
    let result = match path {
        "/api/updates/status" => updater.status_json(false),
        "/api/updates/check" => updater.status_json(true),
        // The restart request is the only other path admitted above.
        _ => Ok(json!({
            "success": true,
            "message": "Restart requested; Electron will restart the native backend",
            "restart_required": true,
        })),
    };
    Some(result.map_or_else(
        |error| detail(400, error),
        |value| HttpResponse::json(200, value.to_string()),
    ))
}

/// Release check with the network request outside the global route lock.
pub(crate) fn check_without_global_lock(state: &Arc<Mutex<SidecarState>>) -> HttpResponse {
    let (updater, settings) = {
        let state = state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.native_updater.clone(), state.update_settings.load())
    };
    updater.sync_preferences(&settings);
    updater.status_json(true).map_or_else(
        |error| detail(400, error),
        |value| HttpResponse::json(200, value.to_string()),
    )
}

fn parse_changelog_query(path: &str) -> Result<Option<String>, String> {
    let (pathname, query) = path
        .split_once('?')
        .map_or((path, None), |(pathname, query)| (pathname, Some(query)));
    if pathname != "/api/updates/webapp/changelog" {
        return Err("Update route not found".into());
    }
    let Some(query) = query else {
        return Ok(None);
    };
    if query.is_empty() || query.contains('?') {
        return Err("Changelog query is invalid".into());
    }
    let fields: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    if fields.len() != 1
        || fields[0].0 != "current_version"
        || fields[0].1.is_empty()
        || fields[0].1.len() > 64
        || !fields[0]
            .1
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'+' | b'_'))
    {
        return Err("Changelog accepts only one bounded current_version query".into());
    }
    Ok(Some(fields[0].1.clone()))
}

fn parse_release(
    client: &Client,
    api_base: &Url,
    value: &Value,
    allow_prerelease: bool,
) -> Result<ReleaseInfo, String> {
    let prerelease = value
        .get("prerelease")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if prerelease && !allow_prerelease {
        return Err("Latest GitHub release is a prerelease".into());
    }
    let version = value
        .get("tag_name")
        .and_then(Value::as_str)
        .map(|tag| tag.trim_start_matches('v').to_owned())
        .filter(|tag| Version::parse(tag).is_ok())
        .ok_or("GitHub release has no valid semantic version")?;
    let assets = value
        .get("assets")
        .and_then(Value::as_array)
        .ok_or("GitHub release assets are missing")?;
    let asset = select_platform_asset(assets)
        .ok_or("No matching installer for this platform and architecture")?;
    if asset.get("state").and_then(Value::as_str) != Some("uploaded") {
        return Err("Update installer is not fully uploaded".into());
    }
    let name = asset
        .get("name")
        .and_then(Value::as_str)
        .ok_or("Update asset name is missing")?;
    let download_url = asset
        .get("browser_download_url")
        .and_then(Value::as_str)
        .ok_or("Update asset URL is missing")?;
    validate_download_url(download_url, api_base)?;
    let size = asset
        .get("size")
        .and_then(Value::as_u64)
        .filter(|size| *size > 0 && *size <= MAX_INSTALLER_BYTES)
        .ok_or("Update asset size is missing or exceeds the limit")?;
    let sidecar_name = format!("{name}.sha256");
    let checksum_asset = assets
        .iter()
        .find(|candidate| {
            candidate
                .get("name")
                .and_then(Value::as_str)
                .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&sidecar_name))
        })
        .ok_or("Matching SHA-256 sidecar asset is missing")?;
    if checksum_asset.get("state").and_then(Value::as_str) != Some("uploaded") {
        return Err("Matching SHA-256 sidecar is not fully uploaded".into());
    }
    let checksum_url = checksum_asset
        .get("browser_download_url")
        .and_then(Value::as_str)
        .ok_or("Checksum sidecar URL is missing")?;
    validate_download_url(checksum_url, api_base)?;
    let checksum_response = client
        .get(checksum_url)
        .send()
        .and_then(Response::error_for_status)
        .map_err(|error| format!("Checksum download failed: {error}"))?;
    let checksum_bytes = read_bounded_response(checksum_response, 4096)?;
    let checksum_text =
        std::str::from_utf8(&checksum_bytes).map_err(|_| "Checksum sidecar is not UTF-8")?;
    let sha256 = parse_checksum_sidecar(checksum_text, name)?;
    Ok(ReleaseInfo {
        version,
        release_url: value
            .get("html_url")
            .and_then(Value::as_str)
            .map(str::to_owned),
        notes: value
            .get("body")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .take(64 * 1024)
            .collect(),
        published_at: value
            .get("published_at")
            .and_then(Value::as_str)
            .map(str::to_owned),
        asset_name: name.into(),
        download_url: download_url.into(),
        size,
        sha256,
        prerelease,
    })
}

fn select_platform_asset(assets: &[Value]) -> Option<&Value> {
    select_installer_asset(assets, env::consts::OS, env::consts::ARCH)
}

/// Pick the installer published for `os`/`arch` among the release assets.
///
/// The offline installer variant (`-offline` in its name) carries a Python
/// payload an installed application does not need: an update never uses it.
fn select_installer_asset<'a>(assets: &'a [Value], os: &str, arch: &str) -> Option<&'a Value> {
    let suffixes = installer_suffixes(os, arch);
    assets.iter().find(|asset| {
        let name = asset
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        !name.contains("-offline") && suffixes.iter().any(|suffix| name.ends_with(suffix))
    })
}

/// File-name endings of the installer published for `os`/`arch`.
///
/// `os` and `arch` use the `std::env::consts` spelling. macOS is published
/// for Apple Silicon only, so an Intel Mac has no installer.
fn installer_suffixes(os: &str, arch: &str) -> Vec<String> {
    let arch = if arch == "aarch64" { "arm64" } else { "x64" };
    match os {
        "windows" => vec![format!("-win-{arch}.exe")],
        "macos" if arch == "arm64" => vec!["-mac-arm64.dmg".to_owned()],
        "macos" => Vec::new(),
        _ => vec![
            format!("-linux-{}.deb", if arch == "x64" { "amd64" } else { arch }),
            format!("-linux-{arch}.deb"),
        ],
    }
}

/// How this installation receives application updates.
///
/// Every published build is a platform installer, so an update is always a
/// link to the newer installer and is never applied in place.
fn update_capability() -> Value {
    json!({
        "can_apply_in_place": false,
        "channel": "installer",
        "reason": "managed_install",
        "install_kind": if cfg!(target_os = "macos") {
            "dmg"
        } else if cfg!(target_os = "windows") {
            "windows-installer"
        } else {
            "deb"
        },
    })
}

fn update_redirect_policy(fixture: bool) -> Policy {
    Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many update redirects");
        }
        let url = attempt.url();
        let host = url.host_str().unwrap_or_default();
        let allowed = if fixture {
            url.scheme() == "http" && is_loopback_host(host)
        } else {
            url.scheme() == "https"
                && (host == "github.com"
                    || host == "api.github.com"
                    || host.ends_with(".github.com")
                    || host.ends_with(".githubusercontent.com"))
        };
        if allowed {
            attempt.follow()
        } else {
            attempt.error("unsafe update redirect target")
        }
    })
}

fn validate_network_url(raw: &str, allow_api_root: bool) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|error| format!("Invalid update URL: {error}"))?;
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err("Update URL must not contain credentials or a fragment".into());
    }
    let fixture = url.scheme() == "http" && url.host_str().is_some_and(is_loopback_host);
    if url.scheme() != "https" && !fixture {
        return Err(
            "Production update URLs must use HTTPS; HTTP is allowed only for loopback fixtures"
                .into(),
        );
    }
    if !allow_api_root && url.query().is_some() {
        return Err("Update asset URL must not contain a query string".into());
    }
    Ok(url)
}

fn validate_download_url(raw: &str, api_base: &Url) -> Result<(), String> {
    let url = validate_network_url(raw, false)?;
    let fixture = api_base.scheme() == "http" && api_base.host_str().is_some_and(is_loopback_host);
    let host = url.host_str().unwrap_or_default();
    if fixture {
        if url.scheme() != "http" || !is_loopback_host(host) {
            return Err("Fixture release assets must remain on loopback HTTP".into());
        }
    } else if url.scheme() != "https" || !is_github_asset_host(host) {
        return Err("Production update assets must remain on an approved GitHub HTTPS host".into());
    }
    Ok(())
}

fn is_github_asset_host(host: &str) -> bool {
    host == "github.com"
        || host.ends_with(".github.com")
        || host.ends_with(".githubusercontent.com")
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

fn valid_github_repo(value: &str) -> bool {
    let Some((owner, name)) = value.split_once('/') else {
        return false;
    };
    !owner.is_empty()
        && !name.is_empty()
        && !name.contains('/')
        && owner
            .bytes()
            .chain(name.bytes())
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

fn parse_checksum_sidecar(checksum_text: &str, asset_name: &str) -> Result<String, String> {
    let mut lines = checksum_text.lines();
    let line = lines
        .next()
        .filter(|line| !line.trim().is_empty())
        .ok_or("Checksum sidecar is empty")?;
    if lines.any(|line| !line.trim().is_empty()) {
        return Err("Checksum sidecar must contain exactly one checksum record".into());
    }
    let digest = line
        .get(..64)
        .filter(|value| value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("Checksum sidecar does not contain a SHA-256 digest")?;
    let separator_and_name = line
        .get(64..)
        .filter(|value| value.starts_with(char::is_whitespace))
        .ok_or("Checksum sidecar has no filename separator")?;
    let checksum_name = separator_and_name
        .trim_start()
        .strip_prefix('*')
        .unwrap_or_else(|| separator_and_name.trim_start())
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .ok_or("Checksum sidecar does not name its update asset")?;
    let published_name = |value: &str| value.replace(' ', ".");
    if published_name(checksum_name) != published_name(asset_name) {
        return Err("Checksum sidecar does not exactly name the selected update asset".into());
    }
    Ok(digest.to_ascii_lowercase())
}

fn effective_offline(preferences: &UpdatePreferences) -> bool {
    preferences.offline_mode == "on"
        || (preferences.offline_mode != "off" && env_truthy("NIRS4ALL_OFFLINE"))
}

fn read_bounded_response(response: Response, limit: u64) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err("Update response exceeds its size limit".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read update response: {error}"))?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Err("Update response exceeds its size limit".into());
    }
    Ok(bytes)
}

fn strictly_newer(candidate: &str, current: &str) -> Result<bool, String> {
    let candidate =
        Version::parse(candidate).map_err(|_| "Update version is not valid semantic versioning")?;
    let current =
        Version::parse(current).map_err(|_| "Running version is not valid semantic versioning")?;
    Ok(candidate > current)
}

fn env_truthy(name: &str) -> bool {
    env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    })
}

fn detail(status: u16, message: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": message.into()}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpListener, thread};
    use tempfile::TempDir;

    const PLATFORMS: [(&str, &str, &str); 3] = [
        ("windows", "x86_64", "nirs4all.Studio-0.16.0-win-x64.exe"),
        ("linux", "x86_64", "nirs4all.Studio-0.16.0-linux-amd64.deb"),
        ("macos", "aarch64", "nirs4all.Studio-0.16.0-mac-arm64.dmg"),
    ];

    fn named(names: &[&str]) -> Vec<Value> {
        names.iter().map(|name| json!({"name": name})).collect()
    }

    /// Everything a release publishes, with each decoy listed before the
    /// installer it could be mistaken for.
    fn published_assets() -> Vec<Value> {
        named(&[
            "nirs4all.Studio-0.16.0-win-x64-offline.exe",
            "nirs4all.Studio-0.16.0-win-x64-offline.exe.sha256",
            "nirs4all.Studio-0.16.0-win-x64.exe.sha256",
            "nirs4all.Studio-0.16.0-win-x64.exe",
            "nirs4all.Studio-0.16.0-linux-amd64-offline.deb",
            "nirs4all.Studio-0.16.0-linux-amd64-offline.deb.sha256",
            "nirs4all.Studio-0.16.0-linux-amd64.deb.sha256",
            "nirs4all.Studio-0.16.0-linux-amd64.deb",
            "nirs4all.Studio-0.16.0-mac-arm64.dmg.sha256",
            "nirs4all.Studio-0.16.0-mac-arm64.dmg",
        ])
    }

    fn host_installer_name(version: &str) -> String {
        let suffix = installer_suffixes(env::consts::OS, env::consts::ARCH)
            .into_iter()
            .next()
            .expect("the test host has a published installer");
        format!("nirs4all.Studio-{version}{suffix}")
    }

    fn installer_release(version: &str) -> ReleaseInfo {
        let asset_name = host_installer_name(version);
        ReleaseInfo {
            version: version.into(),
            release_url: Some(format!(
                "https://github.com/GBeurier/nirs4all-studio/releases/tag/{version}"
            )),
            notes: "fixed release".into(),
            published_at: Some("2026-11-16T00:00:00Z".into()),
            download_url: format!(
                "https://github.com/GBeurier/nirs4all-studio/releases/download/{version}/{asset_name}"
            ),
            asset_name,
            size: 1,
            sha256: "0".repeat(64),
            prerelease: false,
        }
    }

    fn updater(current_version: &str, api_base: &str) -> NativeUpdater {
        NativeUpdater::new(current_version.into(), api_base.into())
    }

    fn state_with(temp: &TempDir, native_updater: NativeUpdater) -> SidecarState {
        SidecarState {
            native_updater,
            update_settings: crate::UpdateSettingsStore::new(temp.path().join("settings.yaml")),
            ..SidecarState::default()
        }
    }

    #[test]
    fn versions_must_be_strictly_newer_and_valid() {
        assert_eq!(strictly_newer("1.0.1", "1.0.0"), Ok(true));
        assert_eq!(strictly_newer("1.0.0", "1.0.0"), Ok(false));
        assert_eq!(strictly_newer("0.9.9", "1.0.0"), Ok(false));
        assert_eq!(strictly_newer("0.19.1", "0.18.1"), Ok(true));
        assert_eq!(strictly_newer("0.19.1", "0.19.0"), Ok(true));
        assert_eq!(strictly_newer("0.19.0", "0.19.0"), Ok(false));
        assert!(strictly_newer("latest", "1.0.0").is_err());
    }

    #[test]
    fn each_platform_selects_only_its_own_installer() {
        let assets = published_assets();
        for (os, arch, expected) in PLATFORMS {
            assert_eq!(
                select_installer_asset(&assets, os, arch).unwrap()["name"],
                expected,
                "{os} {arch}"
            );
        }
        // macOS is published for Apple Silicon only.
        assert!(select_installer_asset(&assets, "macos", "x86_64").is_none());
        assert_eq!(
            select_platform_asset(&assets).unwrap()["name"],
            host_installer_name("0.16.0")
        );
    }

    #[test]
    fn a_partial_release_cannot_offer_an_undelivered_windows_standard_installer() {
        let mut assets = named(&[
            "nirs4all.Studio-0.19.1-linux-amd64.deb",
            "nirs4all.Studio-0.19.1-linux-amd64.deb.sha256",
            "nirs4all.Studio-0.19.1-win-x64-offline.exe",
            "nirs4all.Studio-0.19.1-win-x64-offline.exe.sha256",
        ]);
        assert!(select_installer_asset(&assets, "windows", "x86_64").is_none());
        assert!(select_installer_asset(&assets, "linux", "x86_64").is_some());
        assets.extend(named(&[
            "nirs4all.Studio-0.19.1-win-x64.exe.sha256",
            "nirs4all.Studio-0.19.1-win-x64.exe",
        ]));
        assert_eq!(
            select_installer_asset(&assets, "windows", "x86_64").unwrap()["name"],
            "nirs4all.Studio-0.19.1-win-x64.exe"
        );
    }

    #[test]
    fn an_uploaded_installer_without_its_checksum_is_refused() {
        let installer = host_installer_name("2.0.0");
        let release = json!({"tag_name": "2.0.0", "prerelease": false, "assets": [{
            "name": installer, "state": "uploaded", "size": 300,
            "browser_download_url": format!("https://github.com/GBeurier/nirs4all-studio/releases/download/2.0.0/{installer}")
        }]});
        assert_eq!(
            parse_release(
                &Client::new(),
                &Url::parse("https://api.github.com").unwrap(),
                &release,
                false
            )
            .unwrap_err(),
            "Matching SHA-256 sidecar asset is missing"
        );
    }

    #[test]
    fn offline_installers_are_never_selected() {
        for (os, arch, installer) in PLATFORMS {
            let (stem, extension) = installer.rsplit_once('.').unwrap();
            // Wherever the marker sits in the name, the offline variant alone
            // is not an update candidate.
            let offline = [
                format!("{stem}-offline.{extension}"),
                installer.replacen("-0.16.0-", "-0.16.0-offline-", 1),
            ];
            for name in &offline {
                let assets = named(&[name, &format!("{name}.sha256")]);
                assert!(
                    select_installer_asset(&assets, os, arch).is_none(),
                    "{name}"
                );
            }
        }
    }

    #[test]
    fn archives_and_portable_builds_are_never_selected() {
        let assets = named(&[
            "nirs4all.Studio-0.15.0-all-in-one-win-x64.zip",
            "nirs4all.Studio-0.15.0-win-x64-portable.exe",
            "nirs4all.Studio-0.15.0-all-in-one-linux-x64.tar.gz",
            "nirs4all.Studio-0.15.0-linux-x86_64.AppImage",
            "nirs4all.Studio-0.15.0-all-in-one-mac-arm64.zip",
        ]);
        for (os, arch, _) in PLATFORMS {
            assert!(
                select_installer_asset(&assets, os, arch).is_none(),
                "{os} {arch}"
            );
        }
    }

    #[test]
    fn release_without_an_installer_for_this_platform_yields_no_update() {
        let name = if cfg!(target_os = "linux") {
            "nirs4all.Studio-2.0.0-all-in-one-linux-x64.tar.gz"
        } else if cfg!(target_os = "macos") {
            "nirs4all.Studio-2.0.0-all-in-one-mac-arm64.zip"
        } else {
            "nirs4all.Studio-2.0.0-all-in-one-win-x64.zip"
        };
        let base = "https://github.com/GBeurier/nirs4all-studio/releases/download/2.0.0";
        let release = json!({"tag_name": "2.0.0", "prerelease": false, "assets": [
            {"name": name, "browser_download_url": format!("{base}/{name}"), "size": 1},
            {"name": format!("{name}.sha256"), "browser_download_url": format!("{base}/{name}.sha256"), "size": 80},
        ]});
        let error = parse_release(
            &Client::new(),
            &Url::parse("https://api.github.com").unwrap(),
            &release,
            false,
        )
        .unwrap_err();
        assert!(error.contains("No matching installer"), "{error}");
    }

    #[test]
    fn platform_asset_matching_does_not_confuse_windows_with_darwin() {
        // The first name is not a published asset: it merely ends in
        // `win-arm64.exe`, which a Windows match must not accept.
        let assets = named(&[
            "nirs4all.Studio-2.0.0-darwin-arm64.exe",
            "nirs4all.Studio-2.0.0-win-arm64.exe",
        ]);
        assert_eq!(
            select_installer_asset(&assets, "windows", "aarch64").unwrap()["name"],
            "nirs4all.Studio-2.0.0-win-arm64.exe"
        );
        assert!(select_installer_asset(&assets[..1], "windows", "aarch64").is_none());
    }

    #[test]
    fn checksum_sidecar_is_bound_exactly_to_the_selected_asset() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_checksum_sidecar(&format!("{digest}  studio.deb\n"), "studio.deb").unwrap(),
            digest
        );
        assert!(parse_checksum_sidecar(&format!("{digest}\n"), "studio.deb").is_err());
        assert!(
            parse_checksum_sidecar(&format!("{digest}  different.deb\n"), "studio.deb").is_err()
        );
        assert!(
            parse_checksum_sidecar(&format!("{digest}  studio.deb extra\n"), "studio.deb").is_err()
        );
        assert_eq!(
            parse_checksum_sidecar(
                &format!(
                    "{digest}  /home/runner/work/nirs4all-studio/release/nirs4all Studio-0.16.0-linux-amd64.deb\n"
                ),
                "nirs4all.Studio-0.16.0-linux-amd64.deb",
            )
            .unwrap(),
            digest
        );
        assert!(parse_checksum_sidecar(
            &format!(
                "{digest}  C:\\release\\nirs4all Studio-0.16.0-win-x64.exe\n{digest}  second.exe\n"
            ),
            "nirs4all.Studio-0.16.0-win-x64.exe",
        )
        .is_err());
    }

    #[test]
    fn changelog_query_is_closed_and_uses_only_the_cached_release() {
        assert_eq!(
            parse_changelog_query("/api/updates/webapp/changelog?current_version=0.11.1").unwrap(),
            Some("0.11.1".into())
        );
        assert!(parse_changelog_query(
            "/api/updates/webapp/changelog?current_version=0.11.1&extra=true"
        )
        .is_err());
        assert!(parse_changelog_query(
            "/api/updates/webapp/changelog?current_version=0.11.1%0Ainjected"
        )
        .is_err());

        let updater = updater("0.11.1", "http://127.0.0.1:9");
        *updater.release.lock().unwrap() = Some(installer_release("0.11.2"));
        let response = updater.changelog(Some("0.11.1"));
        assert_eq!(response["current_version"], "0.11.1");
        assert_eq!(response["entries"][0]["version"], "0.11.2");
        assert_eq!(response["entries"][0]["body"], "fixed release");
    }

    #[test]
    fn production_requires_https_but_loopback_fixture_http_is_allowed() {
        assert!(validate_network_url("https://api.github.com", true).is_ok());
        assert!(validate_network_url("http://127.0.0.1:43123", true).is_ok());
        assert!(validate_network_url("http://localhost:43123", true).is_ok());
        assert!(validate_network_url("http://example.com", true).is_err());
        assert!(validate_network_url("https://user@example.com", true).is_err());
        let production = Url::parse("https://api.github.com").unwrap();
        assert!(
            validate_download_url("https://github.com/o/r/releases/a.exe", &production).is_ok()
        );
        assert!(
            validate_download_url("https://objects.githubusercontent.com/a.exe", &production)
                .is_ok()
        );
        assert!(validate_download_url("https://example.com/a.exe", &production).is_err());
    }

    #[test]
    fn release_fixture_selects_the_platform_installer_and_its_checksum() {
        let digest = "ab".repeat(32);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let installer = host_installer_name("0.19.1");
        let (stem, extension) = installer.rsplit_once('.').unwrap();
        let offline = format!("{stem}-offline.{extension}");
        let asset = |name: &str, size: u64| json!({"name": name, "state": "uploaded", "browser_download_url": format!("{base}/{name}"), "size": size});
        let body = json!({"tag_name": "0.19.1", "prerelease": false, "assets": [
            asset(&offline, 900),
            asset(&format!("{offline}.sha256"), 80),
            asset(&installer, 300),
            asset(&format!("{installer}.sha256"), 80),
        ]})
        .to_string();
        let checksum = format!("{digest}  {installer}\n");
        let checksum_request = format!("/{installer}.sha256 ");
        thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut request = [0_u8; 4096];
                let read = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                let payload = if request.contains(&checksum_request) {
                    checksum.as_bytes()
                } else {
                    body.as_bytes()
                };
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    payload.len()
                )
                .unwrap();
                stream.write_all(payload).unwrap();
            }
        });
        let updater = updater("0.19.0", &base);
        let first = updater.status_json(true).unwrap();
        let webapp = &first["webapp"];
        assert_eq!(webapp["current_version"], "0.19.0");
        assert_eq!(webapp["latest_version"], "0.19.1");
        assert_eq!(webapp["update_available"], true);
        assert_eq!(webapp["asset_name"], installer);
        assert_eq!(webapp["installer_asset_name"], installer);
        assert_eq!(webapp["download_size_bytes"], 300);
        assert_eq!(webapp["checksum_sha256"], digest);
        assert_eq!(
            webapp["installer_download_url"],
            format!("{base}/{installer}")
        );
        assert_eq!(webapp["download_url"], webapp["installer_download_url"]);
        thread::sleep(Duration::from_millis(2));
        let second = updater.status_json(false).unwrap();
        assert!(first["last_check"].is_string());
        assert_eq!(first["last_check"], second["last_check"]);
    }

    #[test]
    fn unfinished_installer_or_checksum_is_never_an_available_update() {
        for (installer_state, checksum_state, expected) in [
            (
                "starter",
                "uploaded",
                "Update installer is not fully uploaded",
            ),
            (
                "uploaded",
                "starter",
                "Matching SHA-256 sidecar is not fully uploaded",
            ),
            ("", "uploaded", "Update installer is not fully uploaded"),
            (
                "uploaded",
                "",
                "Matching SHA-256 sidecar is not fully uploaded",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let base = format!("http://{address}");
            let installer = host_installer_name("2.0.0");
            let checksum = format!("{}  {installer}\n", "ab".repeat(32));
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 4096];
                // Wakeup after an early refusal closes without making a request.
                if stream.read(&mut request).unwrap() == 0 {
                    return;
                }
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    checksum.len()
                )
                .unwrap();
                stream.write_all(checksum.as_bytes()).unwrap();
            });
            let asset = |name: &str, state: &str| {
                let mut asset = json!({"name": name, "browser_download_url": format!("{base}/{name}"), "size": 300});
                if !state.is_empty() {
                    asset["state"] = state.into();
                }
                asset
            };
            let release = json!({"tag_name": "2.0.0", "prerelease": false, "assets": [
                asset(&installer, installer_state),
                asset(&format!("{installer}.sha256"), checksum_state),
            ]});
            let result =
                parse_release(&Client::new(), &Url::parse(&base).unwrap(), &release, false);
            // Release the listener when validation rejects before any HTTP read.
            drop(std::net::TcpStream::connect(address));
            server.join().unwrap();
            assert_eq!(
                result.unwrap_err(),
                expected,
                "installer={installer_state}, checksum={checksum_state}"
            );
        }
    }

    #[test]
    fn offline_mode_disables_the_release_check_even_with_a_cached_release() {
        let updater = updater("1.0.0", "http://127.0.0.1:9");
        *updater.release.lock().unwrap() = Some(installer_release("2.0.0"));
        updater.sync_preferences(&json!({"offline_mode": "on"}));
        assert!(updater.check().unwrap_err().contains("offline mode"));
        assert!(updater
            .status_json(true)
            .unwrap_err()
            .contains("offline mode"));
    }

    #[test]
    fn status_keeps_the_renderer_shape_and_the_constant_installer_capability() {
        const WEBAPP_KEYS: [&str; 13] = [
            "current_version",
            "latest_version",
            "update_available",
            "release_url",
            "release_notes",
            "published_at",
            "download_size_bytes",
            "download_url",
            "asset_name",
            "checksum_sha256",
            "is_prerelease",
            "installer_download_url",
            "installer_asset_name",
        ];
        let temp = TempDir::new().unwrap();
        let state = state_with(&temp, updater("1.0.0", "http://127.0.0.1:9"));
        let install_kind = if cfg!(target_os = "macos") {
            "dmg"
        } else if cfg!(target_os = "windows") {
            "windows-installer"
        } else {
            "deb"
        };
        for release in [None, Some(installer_release("2.0.0"))] {
            let update_available = release.is_some();
            *state.native_updater.release.lock().unwrap() = release;
            let response = route(&state, "GET", "/api/updates/status").unwrap();
            assert_eq!(response.status, 200, "{}", response.body);
            let status: Value = serde_json::from_str(&response.body).unwrap();
            let webapp = status["webapp"].as_object().unwrap();
            assert_eq!(webapp.len(), WEBAPP_KEYS.len());
            for key in WEBAPP_KEYS {
                assert!(webapp.contains_key(key), "{key}");
            }
            assert_eq!(webapp["update_available"], update_available);
            // The Python environment is not an application update: its
            // state is served by the environment manager, never here.
            assert_eq!(
                status
                    .as_object()
                    .unwrap()
                    .keys()
                    .map(String::as_str)
                    .collect::<std::collections::BTreeSet<_>>(),
                std::collections::BTreeSet::from([
                    "check_interval_hours",
                    "last_check",
                    "update_capability",
                    "webapp",
                ])
            );
            assert_eq!(status["check_interval_hours"], 24);
            assert_eq!(
                status["update_capability"],
                json!({
                    "can_apply_in_place": false,
                    "channel": "installer",
                    "reason": "managed_install",
                    "install_kind": install_kind,
                })
            );
        }
    }

    #[test]
    fn in_place_update_routes_answer_like_any_unknown_update_route() {
        let temp = TempDir::new().unwrap();
        let state = state_with(&temp, updater("1.0.0", "http://127.0.0.1:9"));
        for (method, path) in [
            ("GET", "/api/updates/webapp/download-info"),
            ("POST", "/api/updates/webapp/download-start"),
            ("POST", "/api/updates/webapp/apply"),
            ("GET", "/api/updates/webapp/staged-update"),
            ("DELETE", "/api/updates/webapp/staged-update"),
            ("POST", "/api/updates/webapp/cleanup"),
            ("GET", "/api/updates/webapp/last-apply-result"),
            ("DELETE", "/api/updates/webapp/last-apply-result"),
            ("GET", "/api/updates/webapp/download-status/update-1"),
            ("POST", "/api/updates/webapp/download-cancel/update-1"),
            ("GET", "/api/updates/webapp/unknown"),
        ] {
            let response = route(&state, method, path).unwrap();
            assert_eq!(response.status, 404, "{method} {path}");
            assert_eq!(
                serde_json::from_str::<Value>(&response.body).unwrap()["detail"],
                "Update route not found",
                "{method} {path}"
            );
        }
    }

    #[test]
    fn restart_is_served_and_other_update_paths_fall_through() {
        let temp = TempDir::new().unwrap();
        let state = state_with(&temp, updater("1.0.0", "http://127.0.0.1:9"));
        let restart = route(&state, "POST", "/api/updates/webapp/restart").unwrap();
        assert_eq!(restart.status, 200, "{}", restart.body);
        assert_eq!(
            serde_json::from_str::<Value>(&restart.body).unwrap()["restart_required"],
            true
        );
        assert_eq!(
            route(&state, "GET", "/api/updates/webapp/restart")
                .unwrap()
                .status,
            405
        );
        assert!(route(&state, "GET", "/api/updates/settings").is_none());
        assert!(route(&state, "GET", "/api/updates/version").is_none());
    }
}
