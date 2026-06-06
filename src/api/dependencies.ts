/**
 * Dependencies API client — nirs4all optional dependency inventory and
 * install/uninstall/update/revert actions.
 */

import { api } from "./transport";

export interface DependencyInfo {
  name: string;
  category: string;
  category_name: string;
  description: string;
  min_version: string;
  recommended_version: string | null;
  installed_version: string | null;
  latest_version: string | null;
  is_installed: boolean;
  is_outdated: boolean;
  is_below_recommended: boolean;
  is_above_recommended: boolean;
  can_update: boolean;
  default_install?: boolean;
  managed_by_profile?: boolean;
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
  runtime_valid: boolean;
  runtime_path: string;
  venv_valid: boolean;
  venv_path: string;
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
  requires_restart?: boolean;
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
  upgrade: boolean = false,
  target?: string  // "recommended" | "latest"
): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/install", {
    package: packageName,
    version,
    upgrade,
    target,
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
 * Revert a dependency to its recommended version
 */
export async function revertDependency(packageName: string): Promise<PackageActionResponse> {
  return api.post("/updates/dependencies/revert", { package: packageName });
}
