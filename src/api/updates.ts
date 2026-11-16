/**
 * Updates API client — application update status, update settings and
 * changelog. Studio is updated by running a newer installer; nothing is
 * downloaded or applied from inside the application.
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
  /** Installer of the newer release for this platform. */
  installer_download_url?: string | null;
  installer_asset_name?: string | null;
}

export interface UpdateStatus {
  webapp: WebappUpdateInfo;
  last_check: string | null;
  check_interval_hours: number;
}

/**
 * Get the current application update status
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
