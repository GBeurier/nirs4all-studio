/**
 * Pure logic + presentation-data helpers for the first-launch setup wizard
 * ({@link ./EnvSetup.tsx}).
 *
 * Everything here is free of React, i18next, and Electron so it can be unit
 * tested in isolation. The component keeps the JSX, state, and side effects;
 * step bookkeeping, label-key mapping, and profile classification live here.
 */

import type {
  GPUDetectionResponse,
  OptionalPackageInfo,
  ProfileInfo,
  RecommendedConfigResponse,
} from "@/api/config";
import {
  filterOptionalPackagesForProfile,
  filterPackageNamesForProfile,
  getCompatibleProfiles,
  getVisibleOptionalPackages,
} from "@/lib/setup-config";

// --- Step model ---

/** Internal wizard steps, in order. */
export const WIZARD_STEPS = ["env", "env-progress", "detect", "profile", "extras", "install", "done"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Steps shown as dots in the progress indicator (some internal steps collapse). */
export const VISUAL_STEPS = ["env", "detect", "profile", "extras", "done"] as const;

/** Progress payload pushed from the Electron env-setup process. */
export interface SetupProgress {
  percent: number;
  step: string;
  detail: string;
}

/** Summary of the currently configured Python environment. */
export interface EnvSummary {
  pythonPath: string;
  envPath: string;
  version: string;
}

export type EnvSetupCheckedState = boolean | "indeterminate";

/**
 * Map an internal wizard step to its index in {@link VISUAL_STEPS}. Several
 * internal steps collapse onto the same dot (e.g. `env`/`env-progress` → 0).
 */
export function getVisualIndex(step: WizardStep): number {
  switch (step) {
    case "env":
    case "env-progress":
      return 0;
    case "detect":
      return 1;
    case "profile":
      return 2;
    case "extras":
    case "install":
      return 3;
    case "done":
      return 4;
  }
}

// --- Env-setup progress labels ---

const STEP_LABEL_KEYS: Record<string, string> = {
  downloading: "setupWizard.envProgress.downloading",
  extracting: "setupWizard.envProgress.extracting",
  creating_venv: "setupWizard.envProgress.creatingVenv",
  installing: "setupWizard.envProgress.installing",
  validating: "setupWizard.envProgress.validating",
  starting: "setupWizard.envProgress.startingBackend",
  ready: "setupWizard.envProgress.ready",
};

const FALLBACK_STEP_LABEL_KEY = "setupWizard.envProgress.settingUp";

/**
 * Translation key for an env-setup progress step. Unknown steps fall back to a
 * generic "setting up" label.
 */
export function getStepLabelKey(step: string): string {
  return STEP_LABEL_KEYS[step] ?? FALLBACK_STEP_LABEL_KEY;
}

// --- Profile classification ---

/** Whether a profile id denotes a GPU/accelerated build (vs. plain CPU). */
export function isGpuProfile(profileId: string): boolean {
  return profileId.includes("gpu") || profileId.includes("cuda") || profileId.includes("mps");
}

/**
 * Whether `profileId` is the top GPU-detection recommendation. Returns false
 * when detection has not run or produced no recommendation.
 */
export function isRecommendedProfile(
  gpuInfo: GPUDetectionResponse | null | undefined,
  profileId: string,
): boolean {
  return gpuInfo?.recommended_profiles[0] === profileId;
}

// --- Profile/options view state ---

export interface EnvSetupViewState {
  profiles: ProfileInfo[];
  profileOptionalPackages: OptionalPackageInfo[];
  effectiveExtras: string[];
}

interface BuildEnvSetupViewStateParams {
  config: RecommendedConfigResponse | null | undefined;
  platform: string | null | undefined;
  selectedExtras: string[];
  selectedProfile: string;
}

export function getEffectiveProfileExtras(
  selectedExtras: string[],
  config: RecommendedConfigResponse | null | undefined,
  selectedProfile: string | null | undefined,
): string[] {
  return filterPackageNamesForProfile(selectedExtras, config, selectedProfile);
}

export function buildEnvSetupViewState({
  config,
  platform,
  selectedExtras,
  selectedProfile,
}: BuildEnvSetupViewStateParams): EnvSetupViewState {
  const visibleOptionalPackages = getVisibleOptionalPackages(config);

  return {
    profiles: getCompatibleProfiles(config, platform),
    profileOptionalPackages: filterOptionalPackagesForProfile(visibleOptionalPackages, config, selectedProfile),
    effectiveExtras: getEffectiveProfileExtras(selectedExtras, config, selectedProfile),
  };
}

export function pruneSelectedExtrasForVisiblePackages(
  selectedExtras: string[],
  config: RecommendedConfigResponse | null | undefined,
): string[] {
  const visiblePackages = getVisibleOptionalPackages(config);
  if (visiblePackages.length === 0) {
    return [];
  }

  const visibleNames = new Set(visiblePackages.map((pkg) => pkg.name));
  return selectedExtras.filter((name) => visibleNames.has(name));
}

export function updateExtraSelection(
  selectedExtras: string[],
  packageName: string,
  checked: EnvSetupCheckedState,
): string[] {
  return checked
    ? [...selectedExtras, packageName]
    : selectedExtras.filter((name) => name !== packageName);
}

export function checkedStateToBoolean(checked: EnvSetupCheckedState): boolean {
  return checked === true;
}
