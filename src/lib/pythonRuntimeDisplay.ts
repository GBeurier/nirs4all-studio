import i18next from "i18next";
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

  let label = i18next.t("common.pythonEnv.runtime.current");
  if (isPyInstaller) {
    label = i18next.t("common.pythonEnv.runtime.packagedBackend");
  } else if (isBundledEmbedded) {
    label = i18next.t("common.pythonEnv.runtime.bundledEmbedded");
  } else if (isBundledExternal) {
    label = i18next.t("common.pythonEnv.runtime.externalUserSelected");
  } else if (runtimeKind === "custom") {
    label = i18next.t("common.pythonEnv.runtime.userSelected");
  } else if (runtimeKind === "managed") {
    label = i18next.t("common.pythonEnv.runtime.current");
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
      return i18next.t("common.pythonEnv.kind.managed");
    case "conda":
      return i18next.t("common.pythonEnv.kind.conda");
    case "venv":
      return i18next.t("common.pythonEnv.kind.venv");
    case "bundled":
      return i18next.t("common.pythonEnv.kind.bundled");
    case "system":
    default:
      return i18next.t("common.pythonEnv.kind.system");
  }
}

export function getDesktopEnvWriteAccessLabel(writable: boolean): string {
  return writable ? i18next.t("common.pythonEnv.writable") : i18next.t("common.pythonEnv.readOnly");
}
