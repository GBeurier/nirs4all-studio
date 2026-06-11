/**
 * Recommended config API client — recommended profiles/packages, config diff,
 * alignment, first-launch setup status, and GPU detection.
 */

import { api } from "./transport";

export interface ProfilePackageSpec {
  min: string;
  recommended: string | null;
}

export interface ProfileInfo {
  id: string;
  label: string;
  description: string;
  packages: Record<string, ProfilePackageSpec>;
  platforms: string[];
  /** Optional packages this profile must never install (e.g. cpu-lite excludes torch). */
  exclude_optionals?: string[];
  /** Pip-name renames applied on install (e.g. xgboost -> xgboost-cpu on cpu-lite). */
  package_renames?: Record<string, string>;
}

export interface OptionalPackageInfo {
  name: string;
  min: string;
  recommended: string | null;
  description: string;
  category: string;
  note?: string | null;
  show_when_profile_managed?: boolean;
  default_install?: boolean;
}

export interface RecommendedConfigResponse {
  schema_version: string;
  app_version: string;
  nirs4all: string;
  profiles: ProfileInfo[];
  optional: OptionalPackageInfo[];
  fetched_from: string;
  fetched_at: string;
}

export interface PackageDiff {
  name: string;
  installed_version: string | null;
  recommended_version: string;
  latest_version?: string | null;
  status: "aligned" | "outdated" | "missing" | "extra";
  action: string | null;
}

export interface ConfigComparisonResponse {
  profile: string | null;
  profile_label: string | null;
  packages: PackageDiff[];
  aligned_count: number;
  misaligned_count: number;
  missing_count: number;
  is_aligned: boolean;
  checked_at: string;
}

export interface AlignConfigRequest {
  profile: string;
  optional_packages?: string[];
  dry_run?: boolean;
}

export interface PackageFailure {
  package: string;
  error: string;
}

export interface AlignConfigResponse {
  success: boolean;
  message: string;
  installed: string[];
  upgraded: string[];
  failed: string[];
  failures?: PackageFailure[];
  dry_run: boolean;
  requires_restart: boolean;
}

export interface SetupStatusResponse {
  setup_completed: boolean;
  selected_profile: string | null;
  completed_at: string | null;
}

export interface GPUDetectionResponse {
  has_cuda: boolean;
  has_metal: boolean;
  cuda_version: string | null;
  gpu_name: string | null;
  driver_version: string | null;
  torch_cuda_available: boolean;
  torch_version: string | null;
  detection_source: string | null;
  recommended_profiles: string[];
}

/**
 * Get recommended configuration (profiles + optional packages)
 */
export async function getRecommendedConfig(forceRefresh: boolean = false): Promise<RecommendedConfigResponse> {
  const params = forceRefresh ? "?force_refresh=true" : "";
  return api.get(`/config/recommended${params}`);
}

/**
 * Compare installed packages against recommended config
 */
export async function getConfigDiff(
  profile?: string,
  includeOptional?: boolean,
  includeLatest: boolean = true,
): Promise<ConfigComparisonResponse> {
  const searchParams = new URLSearchParams();
  if (profile) searchParams.set("profile", profile);
  if (includeOptional) searchParams.set("include_optional", "true");
  if (!includeLatest) searchParams.set("include_latest", "false");
  const qs = searchParams.toString();
  return api.get(`/config/diff${qs ? `?${qs}` : ""}`);
}

/**
 * Align packages with recommended config
 */
export async function alignConfig(request: AlignConfigRequest): Promise<AlignConfigResponse> {
  return api.post("/config/align", request);
}

/**
 * Get first-launch setup status
 */
export async function getSetupStatus(): Promise<SetupStatusResponse> {
  return api.get("/config/setup-status");
}

/**
 * Complete first-launch setup
 */
export async function completeSetup(profile: string, optionalPackages: string[] = []): Promise<SetupStatusResponse> {
  return api.post("/config/complete-setup", { profile, optional_packages: optionalPackages });
}

/**
 * Detect GPU hardware
 */
export async function detectGPU(): Promise<GPUDetectionResponse> {
  return api.get("/config/detect-gpu");
}

/**
 * Skip first-launch setup (defaults to CPU)
 */
export async function skipSetup(): Promise<SetupStatusResponse> {
  return api.post("/config/skip-setup");
}
