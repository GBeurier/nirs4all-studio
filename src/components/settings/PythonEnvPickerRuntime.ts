import {
  getConfigDiff,
  type ConfigComparisonResponse,
} from "@/api/config";
import {
  getDependencies,
  type DependenciesResponse,
} from "@/api/dependencies";
import { getRuntimeSummary } from "@/api/system";
import { formatApiErrorDetail } from "@/api/transport";
import {
  announceBackendRestarted,
  loadPostSwitchValidation,
  previewRuntimeAlignment,
  restartBackendForRuntimeSwitch,
} from "@/lib/pythonRuntimeSwitch";
import type {
  DesktopDetectedEnv,
  DesktopEnvActionResult,
} from "@/types/pythonRuntime";
import type { RuntimeSummaryResponse } from "@/types/settings";

export type {
  ConfigComparisonResponse,
  DependenciesResponse,
  RuntimeSummaryResponse,
};

export {
  announceBackendRestarted,
  loadPostSwitchValidation,
  previewRuntimeAlignment,
  restartBackendForRuntimeSwitch,
};

export interface EnvInfo {
  status: string;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  error?: string;
}

export interface SetupProgress {
  percent: number;
  step: string;
  detail: string;
}

export interface ElectronEnvApi {
  getEnvInfo: () => Promise<EnvInfo>;
  detectExistingEnvs: () => Promise<DesktopDetectedEnv[]>;
  inspectExistingEnv: (envPath: string) => Promise<DesktopEnvActionResult>;
  inspectExistingPython: (pythonPath: string) => Promise<DesktopEnvActionResult>;
  applyExistingEnv: (envPath: string, options?: { installCorePackages?: boolean }) => Promise<DesktopEnvActionResult>;
  applyExistingPython: (pythonPath: string, options?: { installCorePackages?: boolean }) => Promise<DesktopEnvActionResult>;
  selectPythonExe: () => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  startEnvSetup: (targetDir?: string) => Promise<{ success: boolean; error?: string }>;
  onEnvSetupProgress: (cb: (p: SetupProgress) => void) => () => void;
  restartBackend: (options?: { skipEnsure?: boolean }) => Promise<{ success: boolean; port?: number; error?: string }>;
  platform: string;
}

export function getElectronApi(): ElectronEnvApi | null {
  const api = (window as unknown as { electronApi?: ElectronEnvApi }).electronApi;
  return api?.getEnvInfo ? api : null;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const detail = "detail" in error ? (error as { detail?: unknown }).detail : error;
    const status = "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    return formatApiErrorDetail(detail, status);
  }

  return fallback;
}

export interface RuntimeSnapshot {
  envInfo: EnvInfo;
  runtimeSummary: RuntimeSummaryResponse | null;
}

export async function loadRuntimeSnapshot(electronApi: ElectronEnvApi): Promise<RuntimeSnapshot> {
  const [envInfo, runtimeSummary] = await Promise.all([
    electronApi.getEnvInfo(),
    getRuntimeSummary().catch(() => null),
  ]);

  return { envInfo, runtimeSummary };
}

export interface RuntimeReviewDetails {
  profileDiff: ConfigComparisonResponse | null;
  dependencies: DependenciesResponse | null;
}

export async function loadRuntimeReviewDetails(profileId: string): Promise<RuntimeReviewDetails> {
  const [profileDiff, dependencies] = await Promise.all([
    getConfigDiff(profileId, false, false).catch(() => null),
    getDependencies().catch(() => null),
  ]);

  return { profileDiff, dependencies };
}
