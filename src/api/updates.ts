/**
 * Updates API client — webapp/nirs4all update status, update settings, Python
 * runtime status, changelog, the staged auto-update flow, and config snapshots.
 */

import { api } from "./transport";

export interface UpdateSettings {
  auto_check: boolean;
  check_interval_hours: number;
  prerelease_channel: boolean;
  github_repo: string;
  pypi_package: string;
  dismissed_versions: string[];
  /** "auto" = probe network, "on" = force offline, "off" = force online */
  offline_mode?: "auto" | "on" | "off";
}

export interface WebappUpdateInfo {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_url: string | null;
  release_notes: string | null;
  published_at: string | null;
  download_size_bytes: number | null;
  download_url: string | null;
  asset_name: string | null;
  checksum_sha256: string | null;
  is_prerelease: boolean;
  /** Native installer asset for builds that can't update in place. */
  installer_download_url?: string | null;
  installer_asset_name?: string | null;
}

export interface Nirs4allUpdateInfo {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  pypi_url: string | null;
  release_notes: string | null;
  requires_restart: boolean;
}

export interface RuntimeInfo {
  path: string;
  exists: boolean;
  is_valid: boolean;
  python_executable: string | null;
  python_version: string | null;
  pip_version: string | null;
  created_at: string | null;
  last_updated: string | null;
  size_bytes: number;
}

export interface PackageInfo {
  name: string;
  version: string;
  location: string | null;
}

/** Whether this build can apply a webapp update in place, or must use its installer. */
export interface UpdateCapability {
  can_apply_in_place: boolean;
  channel: "in_place" | "installer";
  reason: string;
  install_kind: string;
}

export interface UpdateStatus {
  webapp: WebappUpdateInfo;
  nirs4all: Nirs4allUpdateInfo;
  runtime: RuntimeInfo;
  venv?: RuntimeInfo;
  update_capability?: UpdateCapability | null;
  last_check: string | null;
  check_interval_hours: number;
}

export interface RuntimeStatus {
  runtime: RuntimeInfo;
  venv?: RuntimeInfo;
  packages: PackageInfo[];
  nirs4all_version: string | null;
}

export interface VersionInfo {
  webapp_version: string;
  nirs4all_version: string | null;
  python_version: string;
  platform: string;
  machine: string;
}

/**
 * Get current update status for webapp and nirs4all
 */
export async function getUpdateStatus(): Promise<UpdateStatus> {
  return api.get("/updates/status");
}

/**
 * Force a fresh check for updates
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  return api.post("/updates/check");
}

/**
 * Get update settings
 */
export async function getUpdateSettings(): Promise<UpdateSettings> {
  return api.get("/updates/settings");
}

/**
 * Update settings
 */
export async function updateUpdateSettings(
  settings: Partial<UpdateSettings>
): Promise<UpdateSettings> {
  return api.put("/updates/settings", settings);
}

/**
 * Get current runtime status and installed packages
 */
export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  return api.get("/updates/runtime/status");
}

/**
 * Install or upgrade nirs4all in the current Python runtime
 */
export async function installNirs4all(options?: {
  version?: string;
  extras?: string[];
}): Promise<{
  success: boolean;
  message: string;
  version: string | null;
  output: string[];
}> {
  return api.post("/updates/nirs4all/install", options || {});
}

export interface ChangelogEntry {
  version: string;
  date: string | null;
  body: string;
  prerelease: boolean;
}

/**
 * Get changelog entries between current and latest webapp version
 */
export async function getWebappChangelog(currentVersion?: string): Promise<{
  entries: ChangelogEntry[];
  current_version?: string;
  error?: string;
}> {
  const params = currentVersion ? `?current_version=${currentVersion}` : "";
  return api.get(`/updates/webapp/changelog${params}`);
}

export interface DownloadJobResponse {
  job_id: string;
  status: string;
  version: string;
  asset_name: string;
  message: string;
}

export interface DownloadStatusResponse {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  result?: {
    staging_path: string;
    version: string;
    ready_to_apply: boolean;
  };
  error?: string;
}

export interface StagedUpdateInfo {
  has_staged_update: boolean;
  staging_path?: string;
  version?: string;
}

export interface ApplyUpdateResponse {
  success: boolean;
  message: string;
  restart_required?: boolean;
}

/**
 * Start downloading the webapp update in the background
 */
export async function startWebappDownload(): Promise<DownloadJobResponse> {
  return api.post("/updates/webapp/download-start");
}

/**
 * Get download job status
 */
export async function getDownloadStatus(
  jobId: string
): Promise<DownloadStatusResponse> {
  return api.get(`/updates/webapp/download-status/${jobId}`);
}

/**
 * Cancel an in-progress download
 */
export async function cancelDownload(
  jobId: string
): Promise<{ success: boolean; message: string }> {
  return api.post(`/updates/webapp/download-cancel/${jobId}`);
}

/**
 * Get information about any staged update
 */
export async function getStagedUpdateInfo(): Promise<StagedUpdateInfo> {
  return api.get("/updates/webapp/staged-update");
}

/**
 * Apply the staged update
 */
export async function applyWebappUpdate(
  confirm: boolean = true
): Promise<ApplyUpdateResponse> {
  return api.post("/updates/webapp/apply", { confirm });
}

/**
 * Cancel/remove a staged update
 */
export async function cancelStagedUpdate(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.delete("/updates/webapp/staged-update");
}

/**
 * Clean up old update artifacts
 */
export async function cleanupUpdates(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post("/updates/webapp/cleanup");
}

/**
 * Request webapp restart
 */
export async function requestRestart(): Promise<{
  success: boolean;
  message: string;
  restart_required: boolean;
}> {
  return api.post("/updates/webapp/restart");
}

/**
 * Get current version information
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  return api.get("/updates/version");
}

/** Reconciled result of the last update apply (detects silent failures). */
export interface LastApplyResult {
  status: "none" | "success" | "failed";
  from_version?: string | null;
  to_version?: string | null;
  current_version?: string | null;
  update_mode?: string | null;
  attempted_at?: string | null;
  reconciled_at?: string | null;
  log_tail?: string;
}

/**
 * Get the reconciled result of the last update apply, if any
 */
export async function getLastApplyResult(): Promise<LastApplyResult> {
  return api.get("/updates/webapp/last-apply-result");
}

/**
 * Dismiss the stored apply-result banner
 */
export async function dismissLastApplyResult(): Promise<{ success: boolean }> {
  return api.delete("/updates/webapp/last-apply-result");
}

export interface ConfigSnapshot {
  name: string;
  label: string;
  created_at: string;
  size_bytes: number;
}

/**
 * List all saved config snapshots
 */
export async function listSnapshots(): Promise<{ snapshots: ConfigSnapshot[] }> {
  return api.get("/updates/runtime/snapshots");
}

/**
 * Create a config snapshot (pip freeze)
 */
export async function createSnapshot(label?: string): Promise<{
  success: boolean;
  name: string;
  label: string;
  created_at: string;
}> {
  return api.post("/updates/runtime/snapshots", { label: label || null });
}

/**
 * Restore a config snapshot
 */
export async function restoreSnapshot(name: string): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post(`/updates/runtime/snapshots/${name}/restore`);
}

/**
 * Delete a config snapshot
 */
export async function deleteSnapshot(name: string): Promise<{
  success: boolean;
  message: string;
}> {
  return api.delete(`/updates/runtime/snapshots/${name}`);
}
