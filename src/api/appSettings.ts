/**
 * App settings API client — webapp-specific settings, favorite pipelines, and
 * the app config-folder path.
 */

import { api } from "./transport";
import type {
  AppSettingsResponse,
  AppSettingsUpdateRequest,
  FavoriteAddRequest,
} from "@/types/linked-workspaces";

/**
 * Get app settings
 */
export async function getAppSettings(): Promise<AppSettingsResponse> {
  return api.get("/app/settings");
}

/**
 * Update app settings
 */
export async function updateAppSettings(
  settings: AppSettingsUpdateRequest
): Promise<{ success: boolean; settings: AppSettingsResponse; message: string }> {
  return api.put("/app/settings", settings);
}

/**
 * Get favorite pipelines
 */
export async function getFavorites(): Promise<{ favorites: string[] }> {
  return api.get("/app/favorites");
}

/**
 * Add a favorite pipeline
 */
export async function addFavorite(
  request: FavoriteAddRequest
): Promise<{ success: boolean; favorites: string[]; message: string }> {
  return api.post("/app/favorites", request);
}

/**
 * Remove a favorite pipeline
 */
export async function removeFavorite(
  pipelineId: string
): Promise<{ success: boolean; favorites: string[]; message: string }> {
  return api.delete(`/app/favorites/${pipelineId}`);
}

export interface ConfigPathResponse {
  current_path: string;
  default_path: string;
  is_custom: boolean;
}

export interface SetConfigPathResponse {
  success: boolean;
  message: string;
  current_path: string;
  requires_restart: boolean;
}

/**
 * Get the current and default app config folder paths
 */
export async function getConfigPath(): Promise<ConfigPathResponse> {
  return api.get("/app/config-path");
}

/**
 * Set a custom app config folder path
 */
export async function setConfigPath(
  path: string
): Promise<SetConfigPathResponse> {
  return api.post("/app/config-path", { path });
}

/**
 * Reset the app config folder to the default location
 */
export async function resetConfigPath(): Promise<SetConfigPathResponse> {
  return api.delete("/app/config-path");
}
