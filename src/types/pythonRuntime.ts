import type {
  AlignConfigResponse,
  GPUDetectionResponse,
  OptionalPackageInfo,
  RecommendedConfigResponse,
  RuntimeSummaryResponse,
} from "@/api/client";

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
  missingOptionalPackages: string[];
  profileAlignmentGuess: DesktopProfileAlignmentGuess | null;
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
