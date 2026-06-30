/**
 * Pure view-state derivations for the Python Environment Picker.
 *
 * These functions translate backend runtime/env/validation payloads into the
 * flat, render-ready values the picker UI consumes. They hold no React state
 * and trigger no side effects, so they can be unit-tested in isolation.
 */

import type { OptionalPackageInfo, ProfileInfo } from "@/api/config";
import {
  filterOptionalPackagesForProfile,
  getCompatibleProfiles,
} from "@/lib/setup-config";
import {
  getPythonRuntimeDisplayState,
  type PythonRuntimeDisplayState,
} from "@/lib/pythonRuntimeDisplay";
import type { PostSwitchValidation } from "@/types/pythonRuntime";
import type { RuntimeSummaryResponse } from "@/types/settings";

/** Minimal shape of the Electron env-info payload the runtime view needs. */
export interface PythonEnvInfoView {
  status: string;
  pythonPath: string | null;
  pythonVersion: string | null;
}

export interface PythonEnvReviewSelection {
  compatibleProfiles: ProfileInfo[];
  selectedReviewProfile: string;
}

/**
 * Resolve the platform-compatible profiles and the effective selected review
 * profile, falling back to the first compatible profile when the validation's
 * selection is unavailable on this platform.
 */
export function resolveReviewProfileSelection(
  postSwitchValidation: PostSwitchValidation | null,
  platform: string | null | undefined,
): PythonEnvReviewSelection {
  const compatibleProfiles = getCompatibleProfiles(postSwitchValidation?.config, platform);
  const selectedReviewProfile = compatibleProfiles.some(
    (profile) => profile.id === postSwitchValidation?.selectedProfile,
  )
    ? postSwitchValidation?.selectedProfile ?? ""
    : compatibleProfiles[0]?.id ?? postSwitchValidation?.selectedProfile ?? "";

  return { compatibleProfiles, selectedReviewProfile };
}

export interface PythonEnvRuntimeView {
  isReady: boolean;
  runningPythonPath: string | null;
  runtimeVersion: string | null;
  runtimeDisplay: PythonRuntimeDisplayState;
  missingCoreCount: number;
  missingOptionalCount: number;
  hasAlignmentPreview: boolean;
  alignmentChangesCount: number;
  reviewOptionalPackages: OptionalPackageInfo[];
}

/**
 * Derive the flat status/runtime values rendered by the picker, preferring the
 * live runtime summary and falling back to the Electron env-info snapshot.
 */
export function derivePythonEnvRuntimeView(params: {
  runtimeSummary: RuntimeSummaryResponse | null;
  envInfo: PythonEnvInfoView | null;
  postSwitchValidation: PostSwitchValidation | null;
  selectedReviewProfile: string;
}): PythonEnvRuntimeView {
  const { runtimeSummary, envInfo, postSwitchValidation, selectedReviewProfile } = params;

  const isReady = runtimeSummary
    ? runtimeSummary.core_ready && !!runtimeSummary.running_python
    : Boolean(envInfo?.status === "ready" && envInfo.pythonPath);

  return {
    isReady,
    runningPythonPath: runtimeSummary?.running_python ?? envInfo?.pythonPath ?? null,
    runtimeVersion: runtimeSummary?.runtime.version ?? envInfo?.pythonVersion ?? null,
    runtimeDisplay: getPythonRuntimeDisplayState(runtimeSummary),
    missingCoreCount: runtimeSummary?.missing_core_packages.length ?? 0,
    missingOptionalCount: runtimeSummary?.missing_optional_packages.length ?? 0,
    hasAlignmentPreview: postSwitchValidation?.alignmentPreview !== null,
    alignmentChangesCount: postSwitchValidation?.alignmentPreview?.installed.length ?? 0,
    // Hide optionals the selected review profile excludes (cpu-lite never offers torch/umap-learn).
    reviewOptionalPackages: filterOptionalPackagesForProfile(
      postSwitchValidation?.visibleOptionalPackages ?? [],
      postSwitchValidation?.config,
      selectedReviewProfile,
    ),
  };
}
