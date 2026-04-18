import type { DesktopEnvKind } from "@/types/pythonRuntime";
import type { RuntimeSummaryResponse } from "@/types/settings";

export interface PythonRuntimeDisplayState {
  runtimeKind: string;
  label: string;
  isReadOnly: boolean;
  isBundledEmbedded: boolean;
  isBundledExternal: boolean;
  isPyInstaller: boolean;
}

export function getPythonRuntimeDisplayState(
  summary: RuntimeSummaryResponse | null,
): PythonRuntimeDisplayState {
  const runtimeKind = summary?.runtime_kind ?? "current";
  const isPyInstaller = runtimeKind === "pyinstaller";
  const isBundledEmbedded = summary?.is_bundled_default === true;
  const isBundledExternal = summary?.bundled_runtime_available === true
    && !isBundledEmbedded
    && !isPyInstaller;

  let label = "Current runtime";
  if (isPyInstaller) {
    label = "Packaged backend runtime";
  } else if (isBundledEmbedded) {
    label = "Bundled embedded runtime";
  } else if (isBundledExternal) {
    label = "External user-selected runtime";
  } else if (runtimeKind === "custom") {
    label = "User-selected runtime";
  } else if (runtimeKind === "managed") {
    label = "Current runtime";
  }

  return {
    runtimeKind,
    label,
    isReadOnly: isPyInstaller || isBundledEmbedded,
    isBundledEmbedded,
    isBundledExternal,
    isPyInstaller,
  };
}

export function getDesktopEnvKindLabel(kind: DesktopEnvKind): string {
  switch (kind) {
    case "managed":
      return "Managed";
    case "conda":
      return "Conda";
    case "venv":
      return "Virtualenv";
    case "bundled":
      return "Bundled";
    case "system":
    default:
      return "Global";
  }
}

export function getDesktopEnvWriteAccessLabel(writable: boolean): string {
  return writable ? "Likely writable" : "Likely read-only";
}
