/**
 * Updates, auto-update, and dependency management API client functions.
 */

import { api } from "./http";

// ============= Updates API =============

export interface UpdateSettings {
  auto_check: boolean;
  check_interval_hours: number;
  prerelease_channel: boolean;
  github_repo: string;
  pypi_package: string;
  dismissed_versions: string[];
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
}

export interface Nirs4allUpdateInfo {
  current_version: string | null;
  latest_version: string | null;
  update_available: boolean;
  pypi_url: string | null;
  release_notes: string | null;
  requires_restart: boolean;
}

export interface VenvInfo {
  path: string;
  exists: boolean;
  is_valid: boolean;
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

export interface UpdateStatus {
  webapp: WebappUpdateInfo;
  nirs4all: Nirs4allUpdateInfo;
  venv: VenvInfo;
  last_check: string | null;
  check_interval_hours: number;
}

export interface VenvStatus {
  venv: VenvInfo;
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
 * Get managed venv status and installed packages
 */
export async function getVenvStatus(): Promise<VenvStatus> {
  return api.get("/updates/venv/status");
}

/**
 * Create the managed virtual environment
 */
export async function createVenv(options?: {
  force?: boolean;
  install_nirs4all?: boolean;
  extras?: string[];
}): Promise<{
  success: boolean;
  message: string;
  already_existed?: boolean;
  nirs4all_installed?: boolean;
  install_message?: string;
}> {
  return api.post("/updates/venv/create", options || {});
}

/**
 * Install or upgrade nirs4all in the managed venv
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

/**
 * Get webapp download information
 */
export async function getWebappDownloadInfo(): Promise<{
  update_available: boolean;
  current_version: string;
  latest_version: string | null;
  download_url?: string;
  asset_name?: string;
  download_size_bytes?: number;
  release_notes?: string;
  release_url?: string;
}> {
  return api.get("/updates/webapp/download-info");
}

/**
 * Download the latest webapp update (legacy)
 */
export async function downloadWebappUpdate(): Promise<{
  status: string;
  download_url: string;
  asset_name: string;
  version: string;
  message: string;
}> {
  return api.post("/updates/webapp/download");
}

// ============= Auto-Update API =============

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


// ============= Dependencies Management API =============

export interface DependencyInfo {
  name: string;
  category: string;
  category_name: string;
  description: string;
  min_version: string;
  installed_version: string | null;
  latest_version: string | null;
  is_installed: boolean;
  is_outdated: boolean;
  can_update: boolean;
}

export interface DependencyCategory {
  id: string;
  name: string;
  description: string;
  packages: DependencyInfo[];
  installed_count: number;
  total_count: number;
}

export interface DependenciesResponse {
  categories: DependencyCategory[];
  venv_valid: boolean;
  venv_path: string;
  venv_is_custom: boolean;
  nirs4all_installed: boolean;
  nirs4all_version: string | null;
  total_installed: number;
  total_packages: number;
  cached_at: string | null;
}

export interface PackageActionResponse {
  success: boolean;
  message: string;
  package: string;
  version?: string | null;
  output?: string[];
}

export interface VenvPathInfo {
  current_path: string;
  default_path: string;
  is_custom: boolean;
  is_valid: boolean;
  exists: boolean;
}

/**
 * Get all nirs4all optional dependencies with installation status
 */
export async function getDependencies(forceRefresh: boolean = false): Promise<DependenciesResponse> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  return api.get(`/updates/dependencies${params}`);
}

/**
 * Install a dependency package
 */
export async function installDependency(
  packageName: string,
  version?: string,
  upgrade: boolean = false
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/install", {
    package: packageName,
    version,
    upgrade,
  });
}

/**
 * Uninstall a dependency package
 */
export async function uninstallDependency(
  packageName: string
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/uninstall", {
    package: packageName,
  });
}

/**
 * Update a dependency package to latest version
 */
export async function updateDependency(
  packageName: string
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/update", {
    package: packageName,
  });
}

/**
 * Refresh outdated packages cache
 */
export async function refreshDependencies(): Promise<{
  success: boolean;
  message: string;
}> {
  return api.post("/updates/dependencies/refresh");
}

/**
 * Get current venv path configuration
 */
export async function getVenvPath(): Promise<VenvPathInfo> {
  return api.get("/updates/venv/path");
}

/**
 * Set custom venv path (pass null to reset to default)
 */
export async function setVenvPath(path: string | null): Promise<{
  success: boolean;
  message: string;
  current_path: string;
  is_custom: boolean;
  is_valid: boolean;
}> {
  return api.post("/updates/venv/path", { path });
}
