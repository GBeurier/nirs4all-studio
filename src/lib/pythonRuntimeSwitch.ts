import {
  alignConfig,
  detectGPU,
  getRecommendedConfig,
} from "@/api/config";
import { getRuntimeSummary } from "@/api/system";
import { api, resetBackendUrl } from "@/api/transport";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import {
  filterPackageNamesForProfile,
  getPreselectedOptionalPackageNames,
  getVisibleOptionalPackages,
} from "@/lib/setup-config";
import type { AlignConfigResponse } from "@/api/config";
import type { PostSwitchValidation } from "@/types/pythonRuntime";
import { requestRestart } from "@/api/updates";

async function retryAsync<T>(fn: () => Promise<T>, attempts: number = 5): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

function pickSuggestedProfile(
  gpuRecommendedProfiles: string[] | undefined,
  availableProfiles: string[],
): string {
  for (const candidate of gpuRecommendedProfiles ?? []) {
    if (availableProfiles.includes(candidate)) {
      return candidate;
    }
  }

  if (availableProfiles.includes("cpu")) {
    return "cpu";
  }

  return availableProfiles[0] ?? "cpu";
}

function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, "_").toLowerCase();
}

export async function previewRuntimeAlignment(
  profile: string,
  optionalPackages: string[] = [],
): Promise<AlignConfigResponse | null> {
  try {
    return await alignConfig({
      profile,
      optional_packages: optionalPackages,
      dry_run: true,
    });
  } catch {
    return null;
  }
}

export async function loadPostSwitchValidation(): Promise<PostSwitchValidation> {
  const [runtimeSummary, gpuInfo, config] = await Promise.all([
    retryAsync(() => getRuntimeSummary(), 6).catch(() => null),
    retryAsync(() => detectGPU(), 4).catch(() => null),
    retryAsync(() => getRecommendedConfig(), 4).catch(() => null),
  ]);

  const visibleOptionalPackages = getVisibleOptionalPackages(config);
  const availableProfiles = config?.profiles.map((profile) => profile.id) ?? [];
  const selectedProfile = pickSuggestedProfile(gpuInfo?.recommended_profiles, availableProfiles);
  const missingOptionalNames = new Set(
    (runtimeSummary?.missing_optional_packages ?? []).map((name) => normalizePackageName(name)),
  );
  const installedVisibleOptionalNames = runtimeSummary
    ? visibleOptionalPackages
      .map((pkg) => pkg.name)
      .filter((name) => !missingOptionalNames.has(normalizePackageName(name)))
    : [];
  // The selected profile may exclude optionals (cpu-lite never installs torch
  // or umap-learn) — keep them out of the preselection and alignment preview.
  const selectedExtras = filterPackageNamesForProfile(
    getPreselectedOptionalPackageNames(config, installedVisibleOptionalNames),
    config,
    selectedProfile,
  );

  const alignmentPreview = runtimeSummary?.core_ready && selectedProfile
    ? await previewRuntimeAlignment(selectedProfile, selectedExtras)
    : null;

  return {
    runtimeSummary,
    gpuInfo,
    config,
    visibleOptionalPackages,
    selectedProfile,
    selectedExtras,
    alignmentPreview,
  };
}

export function announceBackendRestarted(): void {
  resetBackendUrl();
  dispatchOperatorAvailabilityInvalidated();
  window.dispatchEvent(new CustomEvent("backend-restarted"));
}

/** Restart after pip changed the active environment; never reuse loaded modules. */
export async function restartChangedPythonRuntime(): Promise<void> {
  if (window.electronApi?.restartBackend) {
    const result = await window.electronApi.restartBackend({ skipEnsure: true });
    if (!result.success) throw new Error(result.error || "Failed to restart the Python backend");
  } else {
    await requestRestart();
  }
  announceBackendRestarted();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const status = await api.get<{
      ml_ready: boolean; workspace_ready: boolean; ml_error?: string | null; requires_restart?: boolean;
    }>("/system/readiness").catch(() => null);
    if (status?.ml_error && !status.requires_restart) throw new Error(status.ml_error);
    if (status?.ml_ready && status.workspace_ready && !status.requires_restart) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("The Python backend did not become ready after restarting. Check the installation log.");
}

export async function restartBackendForRuntimeSwitch(
  restartBackend: (options?: { skipEnsure?: boolean }) => Promise<{ success: boolean; error?: string }>,
): Promise<PostSwitchValidation> {
  const result = await restartBackend({ skipEnsure: true });
  if (!result.success) {
    throw new Error(result.error || "Failed to restart backend");
  }

  announceBackendRestarted();
  return loadPostSwitchValidation();
}
