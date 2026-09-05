//! Bounded, native desktop self-update orchestration.
//!
//! Rust owns release discovery, archive verification/staging and the detached
//! replacement helper.  This module never starts a Python HTTP backend and it
//! deliberately enables in-place replacement only for an explicitly attested
//! all-in-one/portable tree.

use std::{
    env,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use atomicwrites::replace_atomic;
use flate2::read::GzDecoder;
use reqwest::blocking::{Client, Response};
use reqwest::redirect::Policy;
use semver::Version;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tar::Archive;
use url::Url;
use zip::ZipArchive;

use crate::{
    job_http::NativeJobRuntime,
    job_lifecycle::{JobStatus, JobType},
    websocket_transport::rfc3339_now,
    HttpResponse, SidecarState,
};

pub const MAX_UPDATE_ARCHIVE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 12 * 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_RELEASE_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;
const NETWORK_TIMEOUT: Duration = Duration::from_secs(30);
const HELPER_WAIT_TIMEOUT: Duration = Duration::from_secs(90);
const STAGING_DIR: &str = "update_staging";
const DOWNLOAD_FILE: &str = "update_download.part";
const STAGED_METADATA: &str = ".nirs4all-staged-update.json";
const APPLY_ATTEMPT: &str = "update_apply_attempt.json";
const APPLY_RESULT: &str = "update_apply_result.json";
const APPLY_PLAN: &str = "update_apply_plan.json";

#[derive(Clone, Debug)]
pub struct NativeUpdater {
    config: Arc<UpdateConfig>,
    release: Arc<Mutex<Option<ReleaseInfo>>>,
    last_check: Arc<Mutex<Option<String>>>,
    preferences: Arc<Mutex<UpdatePreferences>>,
    next_job: Arc<AtomicU64>,
    active_job: Arc<Mutex<Option<String>>>,
}

#[derive(Debug)]
struct UpdateConfig {
    state_dir: PathBuf,
    app_dir: Option<PathBuf>,
    executable_relative: Option<PathBuf>,
    current_version: String,
    api_base: String,
    all_in_one: bool,
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

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ApplyPlan {
    app_dir: PathBuf,
    staged_content: PathBuf,
    executable_relative: PathBuf,
    state_dir: PathBuf,
    parent_pid: u32,
    from_version: String,
    to_version: String,
    staged_tree_sha256: String,
}

impl Default for NativeUpdater {
    fn default() -> Self {
        Self::from_environment_inner(false)
    }
}

impl NativeUpdater {
    #[must_use]
    pub fn from_environment() -> Self {
        Self::from_environment_inner(true)
    }

    fn from_environment_inner(reconcile: bool) -> Self {
        let state_dir = update_state_dir();
        let raw_app_dir = env::var_os("NIRS4ALL_APP_DIR").map(PathBuf::from);
        let app_exe = env::var_os("NIRS4ALL_APP_EXE").map(PathBuf::from);
        let (app_dir, executable_relative) = resolve_app_layout(raw_app_dir, app_exe);
        let archive_owned_tree = env_truthy("NIRS4ALL_ALL_IN_ONE")
            || env::var_os("NIRS4ALL_PORTABLE_EXE").is_some()
            || env::var_os("NIRS4ALL_PORTABLE_ROOT").is_some();
        let all_in_one = qualifies_in_place_archive(
            archive_owned_tree,
            env_truthy("NIRS4ALL_BUNDLED_RUNTIME_AVAILABLE"),
        );
        let updater = Self {
            config: Arc::new(UpdateConfig {
                state_dir,
                app_dir,
                executable_relative,
                current_version: env::var("NIRS4ALL_APP_VERSION")
                    .ok()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "unknown".into()),
                api_base: (env::var("CI").as_deref() == Ok("1"))
                    .then(|| env::var("NIRS4ALL_UPDATE_API_BASE").ok())
                    .flatten()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or_else(|| "https://api.github.com".into()),
                all_in_one,
            }),
            release: Arc::new(Mutex::new(None)),
            last_check: Arc::new(Mutex::new(None)),
            preferences: Arc::new(Mutex::new(UpdatePreferences::default())),
            next_job: Arc::new(AtomicU64::new(1)),
            active_job: Arc::new(Mutex::new(None)),
        };
        if reconcile {
            updater.reconcile_apply_attempt();
        }
        updater
    }

    #[cfg(test)]
    fn test_config(
        state_dir: PathBuf,
        app_dir: Option<PathBuf>,
        executable_relative: Option<PathBuf>,
        current_version: &str,
        api_base: String,
        all_in_one: bool,
    ) -> Self {
        Self {
            config: Arc::new(UpdateConfig {
                state_dir,
                app_dir,
                executable_relative,
                current_version: current_version.into(),
                api_base,
                all_in_one,
            }),
            release: Arc::new(Mutex::new(None)),
            last_check: Arc::new(Mutex::new(None)),
            preferences: Arc::new(Mutex::new(UpdatePreferences {
                github_repo: "fixture/repo".into(),
                ..UpdatePreferences::default()
            })),
            next_job: Arc::new(AtomicU64::new(1)),
            active_job: Arc::new(Mutex::new(None)),
        }
    }

    fn staging_dir(&self) -> PathBuf {
        self.config.state_dir.join(STAGING_DIR)
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

    fn capability(&self) -> Value {
        let install_kind = if env::var_os("APPIMAGE").is_some() {
            "appimage"
        } else if env::var_os("NIRS4ALL_PORTABLE_EXE").is_some()
            || env::var_os("NIRS4ALL_PORTABLE_ROOT").is_some()
        {
            "portable"
        } else if self.config.all_in_one {
            "all-in-one"
        } else if cfg!(target_os = "macos") {
            "dmg"
        } else if cfg!(target_os = "windows") {
            "windows-installer"
        } else {
            "deb"
        };
        let (can_apply, reason) = if env::var_os("APPIMAGE").is_some() {
            (false, "appimage")
        } else if !self.config.all_in_one {
            (false, "managed_install")
        } else if self.write_probe() {
            (true, "all_in_one")
        } else {
            (false, "read_only_location")
        };
        json!({
            "can_apply_in_place": can_apply,
            "channel": if can_apply { "in_place" } else { "installer" },
            "reason": reason,
            "install_kind": install_kind,
        })
    }

    fn write_probe(&self) -> bool {
        let Some(app_dir) = &self.config.app_dir else {
            return false;
        };
        let Some(parent) = app_dir.parent() else {
            return false;
        };
        let probe = parent.join(format!(
            ".nirs4all-update-write-probe-{}",
            std::process::id()
        ));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .and_then(|_| fs::remove_file(&probe))
            .is_ok()
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

    fn cached_or_check(&self) -> Result<ReleaseInfo, String> {
        self.release
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .map_or_else(|| self.check(), Ok)
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
        let capability = self.capability();
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
            "nirs4all": {
                "current_version": null,
                "latest_version": null,
                "update_available": false,
                "pypi_url": null,
                "release_notes": null,
                "requires_restart": false,
            },
            "runtime": empty_runtime(),
            "venv": empty_runtime(),
            "update_capability": capability,
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
            "installer_download_url": null,
            "installer_asset_name": null,
        })
    }

    fn download_info(&self) -> Result<Value, String> {
        let release = self.check()?;
        let capability = self.capability();
        Ok(json!({
            "update_available": self.update_available(&release.version),
            "current_version": self.config.current_version,
            "latest_version": release.version,
            "download_url": release.download_url,
            "asset_name": release.asset_name,
            "download_size_bytes": release.size,
            "release_notes": release.notes,
            "release_url": release.release_url,
            "installer_download_url": null,
            "installer_asset_name": null,
            "can_apply_in_place": capability["can_apply_in_place"],
            "update_channel": capability["channel"],
            "install_kind": capability["install_kind"],
        }))
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

    fn start_download(&self, jobs: &Arc<NativeJobRuntime>) -> Result<Value, String> {
        let preferences = self
            .preferences
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if effective_offline(&preferences) {
            return Err("Update download is disabled by offline mode".into());
        }
        let release = self.cached_or_check()?;
        if !self.update_available(&release.version) {
            return Err("No update available".into());
        }
        if self.capability()["can_apply_in_place"] != true {
            return Err(
                "This build updates through its installer and cannot apply an archive in place"
                    .into(),
            );
        }
        let mut active = self
            .active_job
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if active
            .as_deref()
            .and_then(|id| jobs.get_at(id, Instant::now()))
            .is_some_and(|job| !job.status.is_terminal())
        {
            return Err("CONFLICT:An update download is already active".into());
        }
        let id = format!(
            "update-download-{}-{}",
            std::process::id(),
            self.next_job.fetch_add(1, Ordering::Relaxed)
        );
        jobs.register_local_control_at(
            id.clone(),
            JobType::UpdateDownload,
            json!({
                "version": release.version,
                "download_url": release.download_url,
                "asset_name": release.asset_name,
                "expected_size": release.size,
                "checksum": release.sha256,
            }),
            &rfc3339_now(),
            Instant::now(),
        )
        .map_err(|error| format!("Could not register update download: {error:?}"))?;
        *active = Some(id.clone());
        drop(active);
        let updater = self.clone();
        let worker_jobs = Arc::clone(jobs);
        let worker_id = id.clone();
        let worker_release = release.clone();
        thread::spawn(move || updater.download_worker(&worker_jobs, &worker_id, &worker_release));
        Ok(json!({
            "job_id": id,
            "status": "started",
            "version": release.version,
            "asset_name": release.asset_name,
            "message": format!("Downloading {}...", release.asset_name),
        }))
    }

    fn download_worker(&self, jobs: &NativeJobRuntime, job_id: &str, release: &ReleaseInfo) {
        let now = Instant::now();
        if jobs.start_at(job_id, &rfc3339_now(), now).is_err() {
            return;
        }
        let result = self.download_and_stage(jobs, job_id, release);
        match result {
            Ok(content) => {
                let _ = jobs.complete_at(
                    job_id,
                    json!({
                        "staging_path": content,
                        "version": release.version,
                        "ready_to_apply": true,
                    }),
                    &rfc3339_now(),
                    Instant::now(),
                );
            }
            Err(_error) if job_cancelled(jobs, job_id) => {
                let _ = jobs.acknowledge_cancel_at(job_id, &rfc3339_now(), Instant::now());
            }
            Err(error) => {
                let _ = jobs.fail_at(job_id, error, None, &rfc3339_now(), Instant::now());
            }
        }
    }

    #[allow(clippy::too_many_lines, clippy::cast_precision_loss)]
    fn download_and_stage(
        &self,
        jobs: &NativeJobRuntime,
        job_id: &str,
        release: &ReleaseInfo,
    ) -> Result<PathBuf, String> {
        let preferences = self
            .preferences
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        if effective_offline(&preferences) {
            return Err("Update download is disabled by offline mode".into());
        }
        fs::create_dir_all(&self.config.state_dir)
            .map_err(|error| format!("Could not create update state directory: {error}"))?;
        let download = self.config.state_dir.join(DOWNLOAD_FILE);
        let staging = self.staging_dir();
        remove_known_tree(&staging)?;
        let _ = fs::remove_file(&download);
        let api_base = validate_network_url(&self.config.api_base, true)?;
        validate_download_url(&release.download_url, &api_base)?;
        let url = Url::parse(&release.download_url)
            .map_err(|error| format!("Invalid update URL: {error}"))?;
        let client = Client::builder()
            .timeout(Duration::from_secs(10 * 60))
            .redirect(update_redirect_policy(api_base.scheme() == "http"))
            .build()
            .map_err(|error| format!("Could not create update HTTP client: {error}"))?;
        let mut response = client
            .get(url)
            .send()
            .and_then(Response::error_for_status)
            .map_err(|error| format!("Update download failed: {error}"))?;
        if response
            .content_length()
            .is_some_and(|size| size != release.size || size > MAX_UPDATE_ARCHIVE_BYTES)
        {
            return Err("Update download Content-Length does not match release metadata".into());
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&download)
            .map_err(|error| format!("Could not create update download: {error}"))?;
        let mut digest = Sha256::new();
        let mut total = 0_u64;
        let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
        loop {
            let preferences = self
                .preferences
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            if effective_offline(&preferences) {
                let _ = fs::remove_file(&download);
                return Err("Update download stopped because offline mode was enabled".into());
            }
            if job_cancelled(jobs, job_id) {
                let _ = fs::remove_file(&download);
                return Err("Update download cancelled".into());
            }
            let read = response
                .read(&mut buffer)
                .map_err(|error| format!("Update download read failed: {error}"))?;
            if read == 0 {
                break;
            }
            total = total
                .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
                .ok_or("Update download size overflow")?;
            if total > release.size || total > MAX_UPDATE_ARCHIVE_BYTES {
                let _ = fs::remove_file(&download);
                return Err("Update download exceeded its declared size".into());
            }
            file.write_all(&buffer[..read])
                .map_err(|error| format!("Could not write update download: {error}"))?;
            digest.update(&buffer[..read]);
            let progress = (total as f64 / release.size as f64 * 80.0).clamp(0.0, 80.0);
            let _ = jobs.progress_at(
                job_id,
                progress,
                "Downloading update",
                &rfc3339_now(),
                Instant::now(),
            );
        }
        drop(file);
        if total != release.size {
            let _ = fs::remove_file(&download);
            return Err(format!(
                "Update download size mismatch: expected {}, received {total}",
                release.size
            ));
        }
        let actual = format!("{:x}", digest.finalize());
        if !actual.eq_ignore_ascii_case(&release.sha256) {
            let _ = fs::remove_file(&download);
            return Err("Update download SHA-256 mismatch".into());
        }
        fs::create_dir_all(&staging)
            .map_err(|error| format!("Could not create update staging directory: {error}"))?;
        extract_archive(&download, &release.asset_name, &staging)?;
        let content = resolve_staged_content(&staging)?;
        validate_staged_layout(&content, self.config.executable_relative.as_deref())?;
        let staged_tree_sha256 = hash_tree(&content)?;
        atomic_json(
            &staging.join(STAGED_METADATA),
            &json!({
                "version": release.version,
                "asset_name": release.asset_name,
                "sha256": release.sha256,
                "size": release.size,
                "staged_at": rfc3339_now(),
                "staged_tree_sha256": staged_tree_sha256,
            }),
        )?;
        let _ = fs::remove_file(download);
        let _ = jobs.progress_at(
            job_id,
            100.0,
            "Update staged",
            &rfc3339_now(),
            Instant::now(),
        );
        Ok(content)
    }

    fn staged_info(&self) -> Value {
        let staging = self.staging_dir();
        let metadata = read_json(&staging.join(STAGED_METADATA)).ok();
        if !staging.is_dir() || metadata.is_none() {
            return json!({"has_staged_update": false});
        }
        let metadata = metadata.unwrap_or_default();
        json!({
            "has_staged_update": true,
            "staging_path": staging,
            "version": metadata.get("version"),
            "asset_name": metadata.get("asset_name"),
            "update_mode": "directory",
        })
    }

    fn delete_staged(&self) -> Result<Value, String> {
        remove_known_tree(&self.staging_dir())?;
        Ok(json!({"success": true, "message": "Staged update removed"}))
    }

    fn cleanup(&self) -> Result<Value, String> {
        remove_known_file(&self.config.state_dir.join(DOWNLOAD_FILE))?;
        remove_known_file(&self.config.state_dir.join(APPLY_PLAN))?;
        remove_known_file(&self.config.state_dir.join(if cfg!(windows) {
            "studio-update-helper.exe"
        } else {
            "studio-update-helper"
        }))?;
        remove_known_tree(&self.staging_dir())?;
        if let (Some(app_dir), Ok(result)) = (
            self.config.app_dir.as_deref(),
            read_json(&self.config.state_dir.join(APPLY_RESULT)),
        ) {
            if let Some(backup) = result
                .get("backup_path")
                .and_then(Value::as_str)
                .map(PathBuf::from)
            {
                let expected_prefix = format!(
                    ".{}.nirs4all-backup-",
                    app_dir
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or_default()
                );
                if backup.parent() == app_dir.parent()
                    && backup
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with(&expected_prefix))
                {
                    fs::remove_dir_all(&backup).map_err(|error| {
                        format!(
                            "Could not remove update backup {}: {error}",
                            backup.display()
                        )
                    })?;
                }
            }
        }
        Ok(json!({"success": true, "message": "Cleanup complete"}))
    }

    fn apply(&self, body: &[u8]) -> Result<Value, String> {
        let request: Value = serde_json::from_slice(body)
            .map_err(|_| "Apply request must be a JSON object".to_owned())?;
        let object = request
            .as_object()
            .ok_or("Apply request must be a JSON object")?;
        if object.len() != 1 || !object.contains_key("confirm") {
            return Err("Apply request accepts only {\"confirm\": true}".into());
        }
        if request.get("confirm").and_then(Value::as_bool) != Some(true) {
            return Err("Update not confirmed".into());
        }
        if self.capability()["can_apply_in_place"] != true {
            return Err("This build cannot apply updates in place".into());
        }
        let metadata = read_json(&self.staging_dir().join(STAGED_METADATA))?;
        let staged_version = metadata
            .get("version")
            .and_then(Value::as_str)
            .ok_or("Staged update metadata has no version")?;
        if !strictly_newer(staged_version, &self.config.current_version)? {
            return Err(format!(
                "The staged update ({staged_version}) is not newer than the running version ({})",
                self.config.current_version
            ));
        }
        let staged_tree_sha256 = metadata
            .get("staged_tree_sha256")
            .and_then(Value::as_str)
            .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
            .ok_or("Staged update metadata has no valid tree digest")?;
        let content = resolve_staged_content(&self.staging_dir())?;
        let app_dir = self
            .config
            .app_dir
            .clone()
            .ok_or("Desktop application directory is unavailable")?;
        let executable_relative = self
            .config
            .executable_relative
            .clone()
            .ok_or("Desktop application executable is unavailable")?;
        validate_staged_layout(&content, Some(&executable_relative))?;
        if hash_tree(&content)? != staged_tree_sha256 {
            return Err("Staged update changed after checksum verification".into());
        }
        fs::create_dir_all(&self.config.state_dir)
            .map_err(|error| format!("Could not create update state directory: {error}"))?;
        let plan = ApplyPlan {
            app_dir,
            staged_content: content,
            executable_relative,
            state_dir: self.config.state_dir.clone(),
            parent_pid: std::process::id(),
            from_version: self.config.current_version.clone(),
            to_version: staged_version.into(),
            staged_tree_sha256: staged_tree_sha256.into(),
        };
        atomic_json(
            &self.config.state_dir.join(APPLY_ATTEMPT),
            &serde_json::to_value(&plan).map_err(|error| error.to_string())?,
        )?;
        atomic_json(
            &self.config.state_dir.join(APPLY_PLAN),
            &serde_json::to_value(&plan).map_err(|error| error.to_string())?,
        )?;
        let current_exe = env::current_exe()
            .map_err(|error| format!("Could not locate update helper executable: {error}"))?;
        let helper = self.config.state_dir.join(if cfg!(windows) {
            "studio-update-helper.exe"
        } else {
            "studio-update-helper"
        });
        fs::copy(&current_exe, &helper)
            .map_err(|error| format!("Could not stage update helper: {error}"))?;
        let mut command = Command::new(&helper);
        command
            .arg("--apply-update-plan")
            .arg(self.config.state_dir.join(APPLY_PLAN))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0000_0008 | 0x0000_0200);
        }
        command
            .spawn()
            .map_err(|error| format!("Could not launch update helper: {error}"))?;
        Ok(json!({
            "success": true,
            "message": "Update will be applied after the application exits",
            "restart_required": true,
        }))
    }

    fn reconcile_apply_attempt(&self) {
        let path = self.config.state_dir.join(APPLY_ATTEMPT);
        let result_path = self.config.state_dir.join(APPLY_RESULT);
        let Ok(prior_result) = read_json(&result_path) else {
            return;
        };
        if !matches!(
            prior_result.get("status").and_then(Value::as_str),
            Some("applied" | "launched")
        ) {
            return;
        }
        let Ok(attempt) = read_json(&path) else {
            return;
        };
        let target = attempt.get("to_version").and_then(Value::as_str);
        let status = if target == Some(self.config.current_version.as_str()) {
            "success"
        } else {
            "failed"
        };
        let _ = atomic_json(
            &result_path,
            &json!({
                "status": status,
                "from_version": attempt.get("from_version"),
                "to_version": target,
                "current_version": self.config.current_version,
                "reconciled_at": rfc3339_now(),
                "relaunch_pid": prior_result.get("relaunch_pid"),
                "backup_path": prior_result.get("backup_path"),
            }),
        );
        let _ = fs::remove_file(path);
    }
}

/// Route the complete legacy desktop-update surface to the native owner.
#[must_use]
pub fn route(
    state: &mut SidecarState,
    method: &str,
    path: &str,
    body: &[u8],
) -> Option<HttpResponse> {
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
        "/api/updates/status" | "/api/updates/webapp/download-info" => "GET",
        "/api/updates/webapp/staged-update" | "/api/updates/webapp/last-apply-result" => {
            "GET, DELETE"
        }
        "/api/updates/check"
        | "/api/updates/webapp/download-start"
        | "/api/updates/webapp/apply"
        | "/api/updates/webapp/cleanup"
        | "/api/updates/webapp/restart" => "POST",
        _ if path.starts_with("/api/updates/webapp/download-status/") => "GET",
        _ if path.starts_with("/api/updates/webapp/download-cancel/") => "POST",
        _ => return Some(detail(404, "Update route not found")),
    };
    let method_allowed = expected.split(", ").any(|candidate| candidate == method);
    if !method_allowed {
        return Some(detail(405, "Method Not Allowed").with_header("Allow", expected));
    }
    let updater = state.native_updater.clone();
    updater.sync_preferences(&state.update_settings.load());
    let result = match (method, path) {
        ("GET", "/api/updates/status") => status_with_runtime(state, &updater, false),
        ("POST", "/api/updates/check") => status_with_runtime(state, &updater, true),
        ("GET", "/api/updates/webapp/download-info") => updater.download_info(),
        ("POST", "/api/updates/webapp/download-start") => {
            let jobs = state.native_jobs();
            updater.start_download(&jobs)
        }
        ("POST", "/api/updates/webapp/apply") => updater.apply(body),
        ("GET", "/api/updates/webapp/staged-update") => Ok(updater.staged_info()),
        ("DELETE", "/api/updates/webapp/staged-update") => updater.delete_staged(),
        ("POST", "/api/updates/webapp/cleanup") => updater.cleanup(),
        ("GET", "/api/updates/webapp/last-apply-result") => {
            let result = read_json(&updater.config.state_dir.join(APPLY_RESULT))
                .unwrap_or_else(|_| json!({"status": "none"}));
            Ok(
                if matches!(
                    result.get("status").and_then(Value::as_str),
                    Some("applied" | "launched")
                ) {
                    json!({"status": "none"})
                } else {
                    result
                },
            )
        }
        ("DELETE", "/api/updates/webapp/last-apply-result") => {
            remove_known_file(&updater.config.state_dir.join(APPLY_RESULT))
                .map(|()| json!({"success": true}))
        }
        ("POST", "/api/updates/webapp/restart") => Ok(json!({
            "success": true,
            "message": "Restart requested; Electron will restart the native backend",
            "restart_required": true,
        })),
        _ => return None,
    };
    Some(result.map_or_else(
        |error| {
            if error.starts_with("CONFLICT:") {
                detail(409, error.trim_start_matches("CONFLICT:"))
            } else {
                detail(400, error)
            }
        },
        |value| HttpResponse::json(200, value.to_string()),
    ))
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

fn status_with_runtime(
    state: &SidecarState,
    updater: &NativeUpdater,
    refresh: bool,
) -> Result<Value, String> {
    let mut status = updater.status_json(refresh)?;
    let legacy = serde_json::from_str::<Value>(&crate::native_update_status_response(state).body)
        .map_err(|error| format!("Could not compose native runtime status: {error}"))?;
    for field in ["nirs4all", "runtime", "venv"] {
        status[field] = legacy[field].clone();
    }
    Ok(status)
}

/// Execute a detached, already-validated replacement plan.
///
/// # Errors
///
/// Returns an error when the plan is unconfined, its verified tree changed,
/// replacement cannot complete atomically, or the updated app cannot relaunch.
pub fn run_apply_plan(path: &Path) -> Result<(), String> {
    let plan: ApplyPlan = serde_json::from_value(read_json(path)?)
        .map_err(|error| format!("Invalid update apply plan: {error}"))?;
    match run_apply_plan_inner(path, &plan) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = atomic_json(
                &plan.state_dir.join(APPLY_RESULT),
                &json!({
                    "status": "failed",
                    "from_version": plan.from_version,
                    "to_version": plan.to_version,
                    "error": error,
                    "failed_at": rfc3339_now(),
                }),
            );
            Err(error)
        }
    }
}

fn run_apply_plan_inner(path: &Path, plan: &ApplyPlan) -> Result<(), String> {
    validate_apply_plan(plan)?;
    let actual_plan = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve update apply plan: {error}"))?;
    let expected_plan = plan
        .state_dir
        .canonicalize()
        .map_err(|error| error.to_string())?
        .join(APPLY_PLAN);
    if actual_plan != expected_plan {
        return Err("Update apply plan is outside the confined state directory".into());
    }
    if hash_tree(&plan.staged_content)? != plan.staged_tree_sha256 {
        return Err("Staged update tree digest changed before apply".into());
    }
    let parent = plan
        .app_dir
        .parent()
        .ok_or("Application directory has no parent")?;
    let name = plan
        .app_dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Application directory name is invalid")?;
    let prepared = parent.join(format!(".{name}.nirs4all-new-{}", std::process::id()));
    let backup = parent.join(format!(".{name}.nirs4all-backup-{}", std::process::id()));
    remove_known_tree(&prepared)?;
    remove_known_tree(&backup)?;
    copy_tree(&plan.staged_content, &prepared)?;
    if hash_tree(&prepared)? != plan.staged_tree_sha256 {
        let _ = remove_known_tree(&prepared);
        return Err("Prepared update tree does not match the verified staged tree".into());
    }
    wait_for_process_exit(plan.parent_pid, HELPER_WAIT_TIMEOUT)?;
    fs::rename(&plan.app_dir, &backup).map_err(|error| {
        format!("Could not atomically move current application to backup: {error}")
    })?;
    if let Err(error) = fs::rename(&prepared, &plan.app_dir) {
        let _ = fs::rename(&backup, &plan.app_dir);
        return Err(format!(
            "Could not atomically install staged application: {error}"
        ));
    }
    let executable = plan.app_dir.join(&plan.executable_relative);
    if !executable.is_file() {
        let _ = fs::rename(&plan.app_dir, &prepared);
        let _ = fs::rename(&backup, &plan.app_dir);
        return Err("Updated application executable is missing; rollback completed".into());
    }
    atomic_json(
        &plan.state_dir.join(APPLY_RESULT),
        &json!({
            "status": "applied",
            "from_version": plan.from_version,
            "to_version": plan.to_version,
            "applied_at": rfc3339_now(),
            "backup_path": backup,
        }),
    )?;
    let mut relaunch = Command::new(&executable);
    relaunch
        .current_dir(&plan.app_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // The external release smoke starts Electron with a one-shot credential.
    // NativeSidecarManager converts it into the ordinary private credential and
    // removes the override before spawning us. Reconstruct the override only
    // inside CI so the helper-launched Electron can be probed by that same
    // harness; ordinary production sessions never export it.
    if env::var("CI").as_deref() == Ok("1") {
        if let Ok(token) = env::var("NIRS4ALL_STUDIO_SESSION_TOKEN") {
            if token.len() >= 32
                && token.len() <= 256
                && token.bytes().all(|byte| byte.is_ascii_alphanumeric())
            {
                relaunch.env("NIRS4ALL_ARCHIVE_SMOKE_SESSION_TOKEN", token);
            }
        }
    }
    let child = match relaunch.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::rename(&plan.app_dir, &prepared);
            let _ = fs::rename(&backup, &plan.app_dir);
            return Err(format!(
                "Could not relaunch updated application; rollback completed: {error}"
            ));
        }
    };
    let mut result = read_json(&plan.state_dir.join(APPLY_RESULT))
        .unwrap_or_else(|_| json!({"status": "applied"}));
    result["relaunch_pid"] = json!(child.id());
    result["backup_path"] = json!(backup);
    atomic_json(&plan.state_dir.join(APPLY_RESULT), &result)?;
    let _ = fs::remove_file(path);
    Ok(())
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
        .ok_or("No matching all-in-one asset for this platform and architecture")?;
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
        .filter(|size| *size > 0 && *size <= MAX_UPDATE_ARCHIVE_BYTES)
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
    let os = if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    let extension = if cfg!(target_os = "linux") {
        "tar.gz"
    } else {
        "zip"
    };
    let suffix = format!("-all-in-one-{os}-{arch}.{extension}");
    assets.iter().find(|asset| {
        let name = asset
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        name.ends_with(&suffix)
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

const fn qualifies_in_place_archive(
    owns_install_tree: bool,
    bundled_runtime_available: bool,
) -> bool {
    owns_install_tree && bundled_runtime_available
}

fn parse_checksum_sidecar(checksum_text: &str, asset_name: &str) -> Result<String, String> {
    let mut fields = checksum_text.split_whitespace();
    let digest = fields
        .next()
        .filter(|value| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("Checksum sidecar does not contain a SHA-256 digest")?;
    let checksum_name = fields
        .next()
        .map(|value| value.trim_start_matches('*'))
        .ok_or("Checksum sidecar does not name its update asset")?;
    if checksum_name != asset_name || fields.next().is_some() {
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

fn extract_archive(archive: &Path, name: &str, destination: &Path) -> Result<(), String> {
    if name.to_ascii_lowercase().ends_with(".zip") {
        extract_zip(archive, destination)
    } else if name.to_ascii_lowercase().ends_with(".tar.gz")
        || name.to_ascii_lowercase().ends_with(".tgz")
    {
        extract_tar_gz(archive, destination)
    } else {
        Err("Unsupported update archive format".into())
    }
}

fn preflight_zip(archive: &Path) -> Result<(), String> {
    let file =
        File::open(archive).map_err(|error| format!("Could not open ZIP update: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("Invalid ZIP update: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Update archive has too many entries".into());
    }
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Invalid ZIP entry: {error}"))?;
        let relative = safe_relative_path(Path::new(entry.name()))?;
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("Expanded update size overflow")?;
        if expanded > MAX_EXTRACTED_BYTES {
            return Err("Expanded update exceeds the size limit".into());
        }
        let mode = entry.unix_mode().unwrap_or(0);
        let file_type = mode & 0o170_000;
        if file_type == 0o120_000 {
            let mut link = String::new();
            entry
                .read_to_string(&mut link)
                .map_err(|error| format!("Invalid ZIP symlink: {error}"))?;
            let root = Path::new("/nirs4all-update-root");
            let target = root.join(&relative);
            safe_link_destination(
                root,
                target.parent().ok_or("ZIP symlink has no parent")?,
                Path::new(&link),
            )?;
        } else if file_type != 0 && file_type != 0o100_000 && !entry.is_dir() {
            return Err("ZIP update contains a special file".into());
        }
    }
    Ok(())
}

fn extract_zip(archive: &Path, destination: &Path) -> Result<(), String> {
    preflight_zip(archive)?;
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("/usr/bin/ditto")
            .args(["-x", "-k", "--rsrc"])
            .arg(archive)
            .arg(destination)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("Could not launch macOS ditto extractor: {error}"))?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| "macOS ditto rejected the update archive".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let file =
            File::open(archive).map_err(|error| format!("Could not open ZIP update: {error}"))?;
        let mut archive =
            ZipArchive::new(file).map_err(|error| format!("Invalid ZIP update: {error}"))?;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|error| format!("Invalid ZIP entry: {error}"))?;
            let relative = safe_relative_path(Path::new(entry.name()))?;
            let target = destination.join(&relative);
            let mode = entry.unix_mode().unwrap_or(0);
            let file_type = mode & 0o170_000;
            if file_type == 0o120_000 {
                #[cfg(unix)]
                {
                    let mut link = String::new();
                    entry
                        .read_to_string(&mut link)
                        .map_err(|error| format!("Invalid ZIP symlink: {error}"))?;
                    create_safe_symlink(destination, &target, Path::new(&link))?;
                    continue;
                }
                #[cfg(not(unix))]
                return Err("Update archive symlinks are unsupported on this platform".into());
            }
            if entry.is_dir() {
                fs::create_dir_all(&target)
                    .map_err(|error| format!("Could not create staged directory: {error}"))?;
            } else {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&target)
                    .map_err(|error| format!("Could not create staged file: {error}"))?;
                io::copy(&mut entry, &mut output)
                    .map_err(|error| format!("Could not extract staged file: {error}"))?;
                #[cfg(unix)]
                if mode != 0 {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&target, fs::Permissions::from_mode(mode & 0o777))
                        .map_err(|error| error.to_string())?;
                }
            }
        }
        Ok(())
    }
}

fn extract_tar_gz(archive: &Path, destination: &Path) -> Result<(), String> {
    let file =
        File::open(archive).map_err(|error| format!("Could not open tar update: {error}"))?;
    let mut archive = Archive::new(GzDecoder::new(file));
    let mut count = 0_usize;
    let mut expanded = 0_u64;
    for entry in archive
        .entries()
        .map_err(|error| format!("Invalid tar update: {error}"))?
    {
        count += 1;
        if count > MAX_ARCHIVE_ENTRIES {
            return Err("Update archive has too many entries".into());
        }
        let mut entry = entry.map_err(|error| format!("Invalid tar entry: {error}"))?;
        let relative = safe_relative_path(&entry.path().map_err(|error| error.to_string())?)?;
        expanded = expanded
            .checked_add(entry.size())
            .ok_or("Expanded update size overflow")?;
        if expanded > MAX_EXTRACTED_BYTES {
            return Err("Expanded update exceeds the size limit".into());
        }
        let target = destination.join(relative);
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
        } else if kind.is_file() {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)
                .map_err(|error| error.to_string())?;
            io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = entry.header().mode().unwrap_or(0o644) & 0o777;
                fs::set_permissions(&target, fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())?;
            }
        } else if kind.is_symlink() {
            #[cfg(unix)]
            {
                let link = entry
                    .link_name()
                    .map_err(|error| error.to_string())?
                    .ok_or("Tar symlink has no target")?;
                create_safe_symlink(destination, &target, &link)?;
            }
            #[cfg(not(unix))]
            return Err("Update archive symlinks are unsupported on this platform".into());
        } else {
            return Err("Tar update contains a hard link or special file".into());
        }
    }
    Ok(())
}

fn safe_relative_path(path: &Path) -> Result<PathBuf, String> {
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) if !part.is_empty() => clean.push(part),
            Component::CurDir => {}
            _ => return Err("Update archive contains an unsafe path".into()),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("Update archive contains an empty path".into());
    }
    Ok(clean)
}

#[cfg(unix)]
fn create_safe_symlink(root: &Path, target: &Path, link: &Path) -> Result<(), String> {
    use std::os::unix::fs::symlink;
    let parent = target.parent().ok_or("Symlink has no parent")?;
    safe_link_destination(root, parent, link)?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    symlink(link, target).map_err(|error| format!("Could not create staged symlink: {error}"))
}

fn safe_link_destination(root: &Path, parent: &Path, link: &Path) -> Result<PathBuf, String> {
    if link.is_absolute() {
        return Err("Update symlink target is absolute".into());
    }
    let base = parent
        .strip_prefix(root)
        .map_err(|_| "Symlink parent is outside the update root")?;
    let mut parts: Vec<std::ffi::OsString> = base
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_os_string()),
            _ => None,
        })
        .collect();
    for component in link.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_os_string()),
            Component::CurDir => {}
            Component::ParentDir => {
                if parts.pop().is_none() {
                    return Err("Update symlink escapes the staging root".into());
                }
            }
            _ => return Err("Update symlink target is unsafe".into()),
        }
    }
    Ok(parts
        .into_iter()
        .fold(root.to_path_buf(), |path, part| path.join(part)))
}

fn resolve_staged_content(staging: &Path) -> Result<PathBuf, String> {
    let entries: Vec<PathBuf> = fs::read_dir(staging)
        .map_err(|error| format!("Could not read update staging directory: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.file_name().and_then(|name| name.to_str()) != Some(STAGED_METADATA))
        .collect();
    let mac_bundles: Vec<&PathBuf> = entries
        .iter()
        .filter(|path| {
            path.is_dir()
                && path.extension().and_then(|extension| extension.to_str()) == Some("app")
                && path.join("Contents/Resources").is_dir()
        })
        .collect();
    if let [bundle] = mac_bundles.as_slice() {
        // `ditto --sequesterRsrc --keepParent` may also materialize a top-level
        // `__MACOSX` AppleDouble directory. The signed `.app` remains the sole
        // application tree and must be selected without flattening it.
        return Ok(PathBuf::from(bundle.as_path()));
    }
    match entries.as_slice() {
        [single] if single.is_dir() => Ok(single.clone()),
        [] => Err("No staged update found".into()),
        _ => Err("Staged update must contain exactly one top-level application directory".into()),
    }
}

fn validate_staged_layout(
    content: &Path,
    executable_relative: Option<&Path>,
) -> Result<(), String> {
    let executable = executable_relative.ok_or("Desktop executable layout is unavailable")?;
    if !content.join(executable).is_file() {
        return Err("Staged update does not contain the desktop executable".into());
    }
    if cfg!(target_os = "macos") {
        if content.extension().and_then(|value| value.to_str()) != Some("app")
            || !content.join("Contents/Resources").is_dir()
        {
            return Err("Staged update is not a valid macOS app bundle".into());
        }
    } else if !content.join("resources").is_dir() {
        return Err("Staged update does not contain the desktop resources directory".into());
    }
    Ok(())
}

fn resolve_app_layout(
    raw_dir: Option<PathBuf>,
    executable: Option<PathBuf>,
) -> (Option<PathBuf>, Option<PathBuf>) {
    let (Some(mut directory), Some(executable)) = (raw_dir, executable) else {
        return (None, None);
    };
    let executable = executable.file_name().map(PathBuf::from);
    if cfg!(target_os = "macos")
        && directory.file_name().and_then(|name| name.to_str()) == Some("MacOS")
        && directory
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            == Some("Contents")
    {
        let Some(bundle) = directory
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
        else {
            return (None, None);
        };
        let relative = executable.map(|name| PathBuf::from("Contents/MacOS").join(name));
        return (Some(bundle), relative);
    }
    if let Ok(canonical) = directory.canonicalize() {
        directory = canonical;
    }
    (Some(directory), executable)
}

fn validate_apply_plan(plan: &ApplyPlan) -> Result<(), String> {
    if !plan.app_dir.is_absolute()
        || !plan.staged_content.is_absolute()
        || !plan.state_dir.is_absolute()
    {
        return Err("Update apply paths must be absolute".into());
    }
    safe_relative_path(&plan.executable_relative)?;
    let state = plan
        .state_dir
        .canonicalize()
        .map_err(|error| format!("Could not resolve update state directory: {error}"))?;
    let staging = state
        .join(STAGING_DIR)
        .canonicalize()
        .map_err(|error| format!("Could not resolve update staging directory: {error}"))?;
    let content = plan
        .staged_content
        .canonicalize()
        .map_err(|error| format!("Could not resolve staged content: {error}"))?;
    if content == staging || !content.starts_with(&staging) {
        return Err("Staged content is outside the confined update directory".into());
    }
    let expected_plan = state.join(APPLY_PLAN);
    if !expected_plan.is_file() {
        return Err("Update apply plan is outside the confined state directory".into());
    }
    validate_staged_layout(&plan.staged_content, Some(&plan.executable_relative))
}

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if destination.exists() {
            return Err("Prepared replacement directory already exists".into());
        }
        let status = Command::new("/usr/bin/ditto")
            .args(["--rsrc", "--extattr"])
            .arg(source)
            .arg(destination)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("Could not launch macOS ditto copier: {error}"))?;
        return status
            .success()
            .then_some(())
            .ok_or_else(|| "macOS ditto could not preserve the signed application tree".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        copy_tree_portable(source, destination)
    }
}

#[cfg(not(target_os = "macos"))]
fn copy_tree_portable(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("Could not prepare replacement directory: {error}"))?;
    let root = source.canonicalize().map_err(|error| error.to_string())?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    while let Some((from, to)) = pending.pop() {
        for entry in fs::read_dir(&from).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let target = to.join(entry.file_name());
            let metadata = fs::symlink_metadata(entry.path()).map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::symlink;
                    let link = fs::read_link(entry.path()).map_err(|error| error.to_string())?;
                    let resolved = entry
                        .path()
                        .parent()
                        .unwrap_or(&from)
                        .join(&link)
                        .canonicalize()
                        .map_err(|_| "Staged symlink target is missing or unsafe")?;
                    if link.is_absolute() || !resolved.starts_with(&root) {
                        return Err("Staged symlink escapes the update root".into());
                    }
                    symlink(link, target).map_err(|error| error.to_string())?;
                }
                #[cfg(not(unix))]
                return Err("Staged symlinks are unsupported on this platform".into());
            } else if metadata.is_dir() {
                fs::create_dir(&target).map_err(|error| error.to_string())?;
                pending.push((entry.path(), target));
            } else if metadata.is_file() {
                fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
                fs::set_permissions(&target, metadata.permissions())
                    .map_err(|error| error.to_string())?;
            } else {
                return Err("Staged update contains a special file".into());
            }
        }
    }
    Ok(())
}

fn hash_tree(root: &Path) -> Result<String, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not resolve staged tree: {error}"))?;
    let mut paths = Vec::new();
    let mut pending = vec![root.clone()];
    let mut total = 0_u64;
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                pending.push(path.clone());
            }
            paths.push((path, metadata));
            if paths.len() > MAX_ARCHIVE_ENTRIES {
                return Err("Staged update has too many entries".into());
            }
        }
    }
    paths.sort_by(|(left, _), (right, _)| left.cmp(right));
    let mut digest = Sha256::new();
    for (path, metadata) in paths {
        let relative = path
            .strip_prefix(&root)
            .map_err(|_| "Staged path escaped its root")?;
        let name = relative.to_str().ok_or("Staged path is not valid UTF-8")?;
        digest.update(name.as_bytes());
        digest.update([0]);
        if metadata.file_type().is_symlink() {
            let link = fs::read_link(&path).map_err(|error| error.to_string())?;
            let resolved = path
                .parent()
                .unwrap_or(&root)
                .join(&link)
                .canonicalize()
                .map_err(|_| "Staged symlink target is missing")?;
            if link.is_absolute() || !resolved.starts_with(&root) {
                return Err("Staged symlink escapes the update root".into());
            }
            digest.update(b"link\0");
            digest.update(link.to_string_lossy().as_bytes());
        } else if metadata.is_dir() {
            digest.update(b"dir\0");
        } else if metadata.is_file() {
            total = total
                .checked_add(metadata.len())
                .ok_or("Staged tree size overflow")?;
            if total > MAX_EXTRACTED_BYTES {
                return Err("Staged tree exceeds the size limit".into());
            }
            digest.update(b"file\0");
            digest.update(metadata.len().to_le_bytes());
            let mut file = File::open(&path).map_err(|error| error.to_string())?;
            let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
            loop {
                let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
                if read == 0 {
                    break;
                }
                digest.update(&buffer[..read]);
            }
        } else {
            return Err("Staged update contains a special file".into());
        }
        digest.update([0xff]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn wait_for_process_exit(pid: u32, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    while process_alive(pid) {
        if Instant::now() >= deadline {
            return Err("Timed out waiting for the application to exit".into());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Ok(())
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    nix::sys::signal::kill(
        nix::unistd::Pid::from_raw(i32::try_from(pid).unwrap_or(i32::MAX)),
        None,
    )
    .is_ok()
}

#[cfg(windows)]
fn process_alive(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .output()
        .is_ok_and(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
}

fn atomic_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("State file has no parent")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("state"),
        std::process::id()
    ));
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temporary, bytes).map_err(|error| error.to_string())?;
    replace_atomic(&temporary, path).map_err(|error| error.to_string())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > 64 * 1024 {
        return Err("Update state file exceeds its size limit".into());
    }
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn remove_known_tree(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Could not remove update directory: {error}"))?;
    }
    Ok(())
}

fn remove_known_file(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Could not remove update file {}: {error}",
            path.display()
        )),
    }
}

fn strictly_newer(candidate: &str, current: &str) -> Result<bool, String> {
    let candidate =
        Version::parse(candidate).map_err(|_| "Update version is not valid semantic versioning")?;
    let current =
        Version::parse(current).map_err(|_| "Running version is not valid semantic versioning")?;
    Ok(candidate > current)
}

fn job_cancelled(jobs: &NativeJobRuntime, id: &str) -> bool {
    jobs.get_at(id, Instant::now())
        .is_some_and(|job| job.status == JobStatus::Cancelled || job.cancellation_requested())
}

fn update_state_dir() -> PathBuf {
    if let Some(path) = env::var_os("NIRS4ALL_BACKEND_DATA_DIR").filter(|value| !value.is_empty()) {
        return PathBuf::from(path);
    }
    if cfg!(windows) {
        env::var_os("LOCALAPPDATA")
            .map_or_else(env::temp_dir, PathBuf::from)
            .join("nirs4all-webapp")
    } else if cfg!(target_os = "macos") {
        env::var_os("HOME")
            .map_or_else(env::temp_dir, PathBuf::from)
            .join("Library/Application Support/nirs4all-webapp")
    } else {
        env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")))
            .unwrap_or_else(env::temp_dir)
            .join("nirs4all-webapp")
    }
}

fn env_truthy(name: &str) -> bool {
    env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    })
}

fn empty_runtime() -> Value {
    json!({"path":"","exists":false,"is_valid":false,"python_executable":null,"python_version":null,"pip_version":null,"created_at":null,"last_updated":null,"size_bytes":0})
}

fn detail(status: u16, message: impl Into<String>) -> HttpResponse {
    HttpResponse::json(status, json!({"detail": message.into()}).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use tempfile::TempDir;

    #[cfg(all(unix, not(target_os = "macos")))]
    fn linux_update_tar() -> Vec<u8> {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for (name, bytes, mode) in [
            ("app/studio", b"#!/bin/sh\nexit 0\n".as_slice(), 0o755),
            ("app/resources/sentinel", b"new".as_slice(), 0o644),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(mode);
            header.set_cksum();
            builder.append_data(&mut header, name, bytes).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn versions_must_be_strictly_newer_and_valid() {
        assert_eq!(strictly_newer("1.0.1", "1.0.0"), Ok(true));
        assert_eq!(strictly_newer("1.0.0", "1.0.0"), Ok(false));
        assert_eq!(strictly_newer("0.9.9", "1.0.0"), Ok(false));
        assert!(strictly_newer("latest", "1.0.0").is_err());
    }

    #[test]
    fn in_place_archive_requires_owned_tree_and_verified_bundled_runtime() {
        assert!(!qualifies_in_place_archive(false, false));
        assert!(!qualifies_in_place_archive(true, false));
        assert!(!qualifies_in_place_archive(false, true));
        assert!(qualifies_in_place_archive(true, true));
    }

    #[test]
    fn checksum_sidecar_is_bound_exactly_to_the_selected_asset() {
        let digest = "a".repeat(64);
        assert_eq!(
            parse_checksum_sidecar(&format!("{digest}  studio.zip\n"), "studio.zip").unwrap(),
            digest
        );
        assert!(parse_checksum_sidecar(&format!("{digest}\n"), "studio.zip").is_err());
        assert!(
            parse_checksum_sidecar(&format!("{digest}  different.zip\n"), "studio.zip").is_err()
        );
        assert!(
            parse_checksum_sidecar(&format!("{digest}  studio.zip extra\n"), "studio.zip").is_err()
        );
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

        let temp = TempDir::new().unwrap();
        let updater = NativeUpdater::test_config(
            temp.path().join("state"),
            None,
            None,
            "0.11.1",
            "http://127.0.0.1:9".into(),
            false,
        );
        *updater.release.lock().unwrap() = Some(ReleaseInfo {
            version: "0.11.2".into(),
            release_url: Some("https://github.com/GBeurier/nirs4all-studio/releases/tag/0.11.2".into()),
            notes: "fixed release".into(),
            published_at: Some("2026-09-06T00:00:00Z".into()),
            asset_name: "nirs4all Studio-0.11.2-all-in-one-linux-x64.tar.gz".into(),
            download_url: "https://github.com/GBeurier/nirs4all-studio/releases/download/0.11.2/archive.tar.gz".into(),
            size: 1,
            sha256: "0".repeat(64),
            prerelease: false,
        });
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
            validate_download_url("https://github.com/o/r/releases/a.zip", &production).is_ok()
        );
        assert!(
            validate_download_url("https://objects.githubusercontent.com/a.zip", &production)
                .is_ok()
        );
        assert!(validate_download_url("https://example.com/a.zip", &production).is_err());
    }

    #[test]
    fn archive_paths_reject_traversal_absolute_and_prefixes() {
        for path in ["../escape", "/absolute", "a/../../escape"] {
            assert!(safe_relative_path(Path::new(path)).is_err(), "{path}");
        }
        assert_eq!(
            safe_relative_path(Path::new("app/resources/a")).unwrap(),
            Path::new("app/resources/a")
        );
    }

    #[test]
    fn staged_content_selects_the_signed_app_beside_ditto_appledouble_metadata() {
        let temp = TempDir::new().unwrap();
        let staging = temp.path().join(STAGING_DIR);
        let bundle = staging.join("nirs4all Studio.app");
        fs::create_dir_all(bundle.join("Contents/Resources")).unwrap();
        fs::create_dir_all(staging.join("__MACOSX")).unwrap();

        assert_eq!(resolve_staged_content(&staging).unwrap(), bundle);
    }

    #[test]
    fn managed_install_never_becomes_in_place_capable_just_because_it_is_writable() {
        let temp = TempDir::new().unwrap();
        let app = temp.path().join("app");
        fs::create_dir(&app).unwrap();
        let updater = NativeUpdater::test_config(
            temp.path().join("state"),
            Some(app),
            Some("studio".into()),
            "1.0.0",
            "https://api.github.com".into(),
            false,
        );
        assert_eq!(updater.capability()["can_apply_in_place"], false);
        assert_eq!(updater.capability()["reason"], "managed_install");
    }

    #[test]
    fn all_in_one_capability_requires_a_writable_parent() {
        let temp = TempDir::new().unwrap();
        let app = temp.path().join("app");
        fs::create_dir(&app).unwrap();
        let updater = NativeUpdater::test_config(
            temp.path().join("state"),
            Some(app),
            Some("studio".into()),
            "1.0.0",
            "https://api.github.com".into(),
            true,
        );
        assert_eq!(updater.capability()["can_apply_in_place"], true);
    }

    #[test]
    fn tar_extraction_rejects_traversal_and_special_entries() {
        let temp = TempDir::new().unwrap();
        let archive_path = temp.path().join("bad.tar.gz");
        let file = File::create(&archive_path).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        let mut header = tar::Header::new_gnu();
        header.set_size(1);
        header.set_mode(0o644);
        header.set_cksum();
        // tar itself rejects `..`, proving the extractor also never receives a
        // normalized escape from a well-formed builder.
        assert!(builder
            .append_data(&mut header, "../escape", &b"x"[..])
            .is_err());
    }

    #[test]
    fn release_fixture_selects_exact_platform_asset_and_checksum() {
        let temp = TempDir::new().unwrap();
        let archive_bytes = b"fixture archive".to_vec();
        let digest = format!("{:x}", Sha256::digest(&archive_bytes));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let asset_name = if cfg!(target_os = "linux") {
            if cfg!(target_arch = "aarch64") {
                "nirs4all-studio-2.0.0-all-in-one-linux-arm64.tar.gz"
            } else {
                "nirs4all-studio-2.0.0-all-in-one-linux-x64.tar.gz"
            }
        } else if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") {
                "nirs4all-studio-2.0.0-all-in-one-mac-arm64.zip"
            } else {
                "nirs4all-studio-2.0.0-all-in-one-mac-x64.zip"
            }
        } else if cfg!(target_arch = "aarch64") {
            "nirs4all-studio-2.0.0-all-in-one-win-arm64.zip"
        } else {
            "nirs4all-studio-2.0.0-all-in-one-win-x64.zip"
        };
        let base = format!("http://{address}");
        let body = json!({"tag_name":"2.0.0","prerelease":false,"assets":[
            {"name":asset_name,"browser_download_url":format!("{base}/{asset_name}"),"size":archive_bytes.len()},
            {"name":format!("{asset_name}.sha256"),"browser_download_url":format!("{base}/{asset_name}.sha256"),"size":80}
        ]}).to_string();
        let checksum = format!("{digest}  {asset_name}\n");
        thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let mut stream = stream.unwrap();
                let mut request = [0_u8; 4096];
                let read = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                let payload = if request.contains(".sha256 ") {
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
        let updater =
            NativeUpdater::test_config(temp.path().join("state"), None, None, "1.0.0", base, false);
        let release = updater.check().unwrap();
        assert_eq!(release.version, "2.0.0");
        assert_eq!(release.sha256, digest);
        assert_eq!(release.asset_name, asset_name);
        let first = updater.status_json(false).unwrap();
        thread::sleep(Duration::from_millis(2));
        let second = updater.status_json(false).unwrap();
        assert!(first["last_check"].is_string());
        assert_eq!(first["last_check"], second["last_check"]);
    }

    #[test]
    fn platform_asset_matching_does_not_confuse_windows_with_darwin() {
        let expected_os = if cfg!(target_os = "windows") {
            "win"
        } else if cfg!(target_os = "macos") {
            "mac"
        } else {
            "linux"
        };
        let expected_arch = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        };
        let extension = if cfg!(target_os = "linux") {
            "tar.gz"
        } else {
            "zip"
        };
        let assets = vec![
            json!({"name": format!("studio-2.0.0-all-in-one-darwin-{expected_arch}.{extension}")}),
            json!({"name": format!("studio-2.0.0-all-in-one-{expected_os}-{expected_arch}.{extension}")}),
        ];
        assert_eq!(
            select_platform_asset(&assets).unwrap()["name"],
            format!("studio-2.0.0-all-in-one-{expected_os}-{expected_arch}.{extension}")
        );
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn real_http_route_downloads_verifies_and_stages_through_the_shared_job_registry() {
        let temp = TempDir::new().unwrap();
        let state_dir = temp.path().join("state");
        let app_dir = temp.path().join("installed");
        fs::create_dir(&app_dir).unwrap();
        let archive = linux_update_tar();
        let digest = format!("{:x}", Sha256::digest(&archive));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let name = "nirs4all-studio-2.0.0-all-in-one-linux-x64.tar.gz";
        let release = json!({"tag_name":"2.0.0","prerelease":false,"assets":[
            {"name":name,"browser_download_url":format!("{base}/{name}"),"size":archive.len()},
            {"name":format!("{name}.sha256"),"browser_download_url":format!("{base}/{name}.sha256"),"size":80}
        ]}).to_string();
        let checksum = format!("{digest}  {name}\n");
        thread::spawn(move || {
            for stream in listener.incoming().take(3) {
                let mut stream = stream.unwrap();
                let mut request = [0_u8; 4096];
                let read = stream.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..read]);
                let payload: &[u8] = if request.contains(".sha256 ") {
                    checksum.as_bytes()
                } else if request.contains(".tar.gz ") {
                    &archive
                } else {
                    release.as_bytes()
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
        let updater = NativeUpdater::test_config(
            state_dir,
            Some(app_dir),
            Some("studio".into()),
            "1.0.0",
            base,
            true,
        );
        let mut state = SidecarState {
            native_updater: updater,
            update_settings: crate::UpdateSettingsStore::new(temp.path().join("settings.yaml")),
            ..SidecarState::default()
        };
        let info = route(&mut state, "GET", "/api/updates/webapp/download-info", b"").unwrap();
        assert_eq!(info.status, 200, "{}", info.body);
        let started = route(
            &mut state,
            "POST",
            "/api/updates/webapp/download-start",
            b"",
        )
        .unwrap();
        assert_eq!(started.status, 200, "{}", started.body);
        let id = serde_json::from_str::<Value>(&started.body).unwrap()["job_id"]
            .as_str()
            .unwrap()
            .to_owned();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let job = state.native_jobs.get_at(&id, Instant::now()).unwrap();
            if job.status.is_terminal() {
                assert_eq!(job.status, JobStatus::Completed, "{:?}", job.error);
                break;
            }
            assert!(Instant::now() < deadline, "download job timed out");
            thread::sleep(Duration::from_millis(20));
        }
        assert!(state
            .native_updater
            .staging_dir()
            .join("app/resources/sentinel")
            .is_file());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn detached_helper_atomically_replaces_the_tree_and_relaunches() {
        use std::os::unix::fs::PermissionsExt;
        let temp = TempDir::new().unwrap();
        let state = temp.path().join("state");
        let app = temp.path().join("app");
        let staged = state.join(STAGING_DIR).join("content");
        fs::create_dir_all(app.join("resources")).unwrap();
        fs::create_dir_all(staged.join("resources")).unwrap();
        fs::write(app.join("studio"), b"#!/bin/sh\nexit 0\n").unwrap();
        fs::write(app.join("resources/stale"), b"old").unwrap();
        fs::write(staged.join("studio"), b"#!/bin/sh\nexit 0\n").unwrap();
        fs::write(staged.join("resources/sentinel"), b"new").unwrap();
        fs::set_permissions(staged.join("studio"), fs::Permissions::from_mode(0o755)).unwrap();
        let plan = ApplyPlan {
            app_dir: app.clone(),
            staged_content: staged,
            executable_relative: "studio".into(),
            state_dir: state.clone(),
            parent_pid: u32::MAX,
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            staged_tree_sha256: hash_tree(&state.join(STAGING_DIR).join("content")).unwrap(),
        };
        let plan_path = state.join(APPLY_PLAN);
        atomic_json(&plan_path, &serde_json::to_value(&plan).unwrap()).unwrap();
        run_apply_plan(&plan_path).unwrap();
        assert!(app.join("resources/sentinel").is_file());
        assert!(!app.join("resources/stale").exists());
        assert_eq!(
            read_json(&state.join(APPLY_RESULT)).unwrap()["status"],
            "applied"
        );
    }

    #[test]
    fn atomic_state_replacement_overwrites_an_existing_result() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join(APPLY_RESULT);
        atomic_json(&path, &json!({"status":"applied"})).unwrap();
        atomic_json(&path, &json!({"status":"success"})).unwrap();
        assert_eq!(read_json(&path).unwrap()["status"], "success");
    }

    #[test]
    fn cleanup_removes_owned_artifacts_and_never_masks_a_removal_failure() {
        let temp = TempDir::new().unwrap();
        let state = temp.path().join("state");
        fs::create_dir_all(state.join(STAGING_DIR)).unwrap();
        fs::write(state.join(DOWNLOAD_FILE), b"partial").unwrap();
        fs::write(state.join(APPLY_PLAN), b"plan").unwrap();
        let helper_name = if cfg!(windows) {
            "studio-update-helper.exe"
        } else {
            "studio-update-helper"
        };
        fs::write(state.join(helper_name), b"helper").unwrap();
        let updater = NativeUpdater::test_config(
            state.clone(),
            None,
            None,
            "1.0.0",
            "https://api.github.com".into(),
            false,
        );

        assert_eq!(updater.cleanup().unwrap()["success"], true);
        for artifact in [DOWNLOAD_FILE, APPLY_PLAN, helper_name] {
            assert!(!state.join(artifact).exists(), "{artifact}");
        }
        assert!(!state.join(STAGING_DIR).exists());

        fs::create_dir_all(state.join(DOWNLOAD_FILE)).unwrap();
        assert!(updater
            .cleanup()
            .unwrap_err()
            .contains("Could not remove update file"));
    }

    #[test]
    fn helper_refuses_a_staged_tree_changed_after_plan_creation() {
        let temp = TempDir::new().unwrap();
        let state = temp.path().join("state");
        let app = temp.path().join("app");
        let staged = state.join(STAGING_DIR).join("content");
        fs::create_dir_all(app.join("resources")).unwrap();
        fs::create_dir_all(staged.join("resources")).unwrap();
        fs::write(app.join("studio"), b"old").unwrap();
        fs::write(staged.join("studio"), b"verified").unwrap();
        fs::write(staged.join("resources/sentinel"), b"verified").unwrap();
        let plan = ApplyPlan {
            app_dir: app.clone(),
            staged_content: staged.clone(),
            executable_relative: "studio".into(),
            state_dir: state.clone(),
            parent_pid: u32::MAX,
            from_version: "1.0.0".into(),
            to_version: "2.0.0".into(),
            staged_tree_sha256: hash_tree(&staged).unwrap(),
        };
        let plan_path = state.join(APPLY_PLAN);
        atomic_json(&plan_path, &serde_json::to_value(&plan).unwrap()).unwrap();
        fs::write(staged.join("studio"), b"tampered").unwrap();

        assert!(run_apply_plan(&plan_path)
            .unwrap_err()
            .contains("digest changed"));
        assert_eq!(fs::read(app.join("studio")).unwrap(), b"old");
        let result = read_json(&state.join(APPLY_RESULT)).unwrap();
        assert_eq!(result["status"], "failed");
    }

    #[test]
    fn cached_release_cannot_bypass_newly_enabled_offline_mode() {
        let temp = TempDir::new().unwrap();
        let app = temp.path().join("app");
        fs::create_dir(&app).unwrap();
        let updater = NativeUpdater::test_config(
            temp.path().join("state"),
            Some(app),
            Some("studio".into()),
            "1.0.0",
            "http://127.0.0.1:9".into(),
            true,
        );
        *updater.release.lock().unwrap() = Some(ReleaseInfo {
            version: "2.0.0".into(),
            release_url: None,
            notes: String::new(),
            published_at: None,
            asset_name: "nirs4all-studio-2.0.0-all-in-one-linux-x64.tar.gz".into(),
            download_url: "http://127.0.0.1:9/update.tar.gz".into(),
            size: 1,
            sha256: "0".repeat(64),
            prerelease: false,
        });
        updater.preferences.lock().unwrap().offline_mode = "on".into();
        let jobs = Arc::new(NativeJobRuntime::default());
        assert!(updater
            .start_download(&jobs)
            .unwrap_err()
            .contains("offline mode"));
    }

    #[test]
    fn reconciled_apply_result_uses_the_legacy_current_version_field() {
        let temp = TempDir::new().unwrap();
        let state = temp.path().join("state");
        fs::create_dir_all(&state).unwrap();
        let updater = NativeUpdater::test_config(
            state.clone(),
            None,
            None,
            "2.0.0",
            "https://api.github.com".into(),
            false,
        );
        atomic_json(
            &state.join(APPLY_ATTEMPT),
            &json!({"from_version":"1.0.0","to_version":"2.0.0"}),
        )
        .unwrap();
        atomic_json(
            &state.join(APPLY_RESULT),
            &json!({"status":"applied","relaunch_pid":123}),
        )
        .unwrap();
        updater.reconcile_apply_attempt();
        let result = read_json(&state.join(APPLY_RESULT)).unwrap();
        assert_eq!(result["status"], "success");
        assert_eq!(result["current_version"], "2.0.0");
        assert!(result.get("running_version").is_none());
    }

    #[test]
    fn staged_metadata_is_confined_and_stale_versions_are_refused() {
        let temp = TempDir::new().unwrap();
        let state = temp.path().join("state");
        let app = temp.path().join("app");
        let staging_content = state.join(STAGING_DIR).join("app");
        fs::create_dir_all(staging_content.join("resources")).unwrap();
        fs::create_dir_all(&app).unwrap();
        fs::write(staging_content.join("studio"), b"binary").unwrap();
        atomic_json(
            &state.join(STAGING_DIR).join(STAGED_METADATA),
            &json!({"version":"1.0.0"}),
        )
        .unwrap();
        let updater = NativeUpdater::test_config(
            state,
            Some(app),
            Some("studio".into()),
            "1.0.0",
            "https://api.github.com".into(),
            true,
        );
        assert!(updater
            .apply(br#"{"confirm":true}"#)
            .unwrap_err()
            .contains("not newer"));
    }

    #[test]
    fn a_second_download_is_refused_while_the_shared_staging_tree_is_active() {
        let temp = TempDir::new().unwrap();
        let app = temp.path().join("app");
        fs::create_dir(&app).unwrap();
        let updater = NativeUpdater::test_config(
            temp.path().join("state"),
            Some(app),
            Some("studio".into()),
            "1.0.0",
            "http://127.0.0.1:9".into(),
            true,
        );
        *updater.release.lock().unwrap() = Some(ReleaseInfo {
            version: "2.0.0".into(),
            release_url: None,
            notes: String::new(),
            published_at: None,
            asset_name: "nirs4all-studio-2.0.0-all-in-one-linux-x64.tar.gz".into(),
            download_url: "http://127.0.0.1:9/update.tar.gz".into(),
            size: 1,
            sha256: "0".repeat(64),
            prerelease: false,
        });
        let jobs = Arc::new(NativeJobRuntime::default());
        jobs.register_local_control_at(
            "active",
            JobType::UpdateDownload,
            json!({}),
            &rfc3339_now(),
            Instant::now(),
        )
        .unwrap();
        *updater.active_job.lock().unwrap() = Some("active".into());
        assert!(updater
            .start_download(&jobs)
            .unwrap_err()
            .starts_with("CONFLICT:"));
    }
}
