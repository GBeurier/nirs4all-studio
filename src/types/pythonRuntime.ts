import type {
  AlignConfigResponse,
  GPUDetectionResponse,
  OptionalPackageInfo,
  RecommendedConfigResponse,
} from "@/api/config";
import type { RuntimeSummaryResponse } from "@/types/settings";

export type DesktopEnvKind = "system" | "venv" | "conda" | "managed" | "bundled";

export interface DesktopProfileAlignmentGuess {
  id: string;
  label: string;
  missingCount: number;
}

export interface DesktopDetectedEnv {
  path: string;
  pythonPath: string;
  pythonVersion: string;
  hasNirs4all: boolean;
  hasCorePackages: boolean;
  envKind: DesktopEnvKind;
  writable: boolean;
}

export interface DesktopInspectedEnv extends DesktopDetectedEnv {
  missingCorePackages: string[];
  corePackageIssues?: Array<{ name: string; installedVersion: string | null; requiredVersion: string | null }>;
  missingOptionalPackages: string[];
  profileAlignmentGuess: DesktopProfileAlignmentGuess | null;
}

/** Why this session runs Studio's included runtime instead of the selected environment. */
export interface DesktopRuntimeFallback {
  reason: "missing" | "incompatible";
  selectedPythonPath: string;
  issues: string[];
}

/** Electron's view of the configured Python runtime (`env:getInfo`). */
export interface DesktopEnvInfo {
  status: string;
  envDir: string;
  pythonPath: string | null;
  sitePackages: string | null;
  pythonVersion: string | null;
  isCustom: boolean;
  canInstallRequiredVersions?: boolean;
  setupDeferred?: boolean;
  runtimeFallback?: DesktopRuntimeFallback;
  /** Why the packaged Python host was disabled, when it was. */
  pythonHostError?: string;
  error?: string;
}

export interface DesktopEnvActionResult {
  success: boolean;
  message: string;
  info?: DesktopInspectedEnv;
}

export interface PostSwitchValidation {
  runtimeSummary: RuntimeSummaryResponse | null;
  gpuInfo: GPUDetectionResponse | null;
  config: RecommendedConfigResponse | null;
  visibleOptionalPackages: OptionalPackageInfo[];
  selectedProfile: string;
  selectedExtras: string[];
  alignmentPreview: AlignConfigResponse | null;
}
