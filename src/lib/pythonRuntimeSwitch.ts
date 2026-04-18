import {
  alignConfig,
  detectGPU,
  getRecommendedConfig,
  getRuntimeSummary,
  resetBackendUrl,
} from "@/api/client";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import {
  getPreselectedOptionalPackageNames,
  getVisibleOptionalPackages,
} from "@/lib/setup-config";
import type { AlignConfigResponse } from "@/api/client";
import type { PostSwitchValidation } from "@/types/pythonRuntime";

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
  const selectedExtras = getPreselectedOptionalPackageNames(config, installedVisibleOptionalNames);

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
