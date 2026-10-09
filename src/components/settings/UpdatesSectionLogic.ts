import type { TFunction } from "i18next";

import type { GPUDetectionResponse } from "@/api/config";
import type { RuntimeInfo, StagedUpdateInfo, UpdateStatus } from "@/api/updates";
import type { RuntimeSummaryResponse } from "@/types/settings";

type RuntimeStatusLike = {
  runtime?: RuntimeInfo | null;
  venv?: RuntimeInfo | null;
};

export type TextDisplay = {
  label: string;
  muted: boolean;
};

export type UpdateAvailability = {
  hasWebappUpdate: boolean;
  hasNirs4allUpdate: boolean;
  hasAnyUpdate: boolean;
  updateCount: number;
};

export type WebappUpdateRowAction =
  | "downloading"
  | "apply"
  | "update"
  | "installer"
  | "up-to-date"
  | null;

export type WebappDownloadPresentationState = {
  isDownloading: boolean;
  downloadProgress: number;
  readyToApply: boolean;
};

export type WebappUpdateRowState = {
  action: WebappUpdateRowAction;
  canApplyInPlace: boolean;
  currentVersion: string;
  downloadProgressPercent: number;
  hasStagedUpdate: boolean;
  hasUpdate: boolean;
  installerUrl: string | null;
  isPrerelease: boolean;
  showTargetVersion: boolean;
  targetVersion: string | null | undefined;
};

export type Nirs4allUpdateRowAction = "update" | "install" | "up-to-date";

export type Nirs4allUpdateRowState = {
  managedByStudio?: boolean;
  requiredVersion?: string;
  action: Nirs4allUpdateRowAction;
  currentVersion: string | null | undefined;
  isActionDisabled: boolean;
  latestVersion: string | null | undefined;
  showTargetVersion: boolean;
};

export type WebappDialogDownloadState = {
  downloadMessage: string;
  isDownloading: boolean;
  readyToApply: boolean;
  stagedVersion?: string;
};

export type WebappDialogCopy = {
  description: string;
  title: string;
};

export function getUpdateAvailability(status: UpdateStatus | null | undefined): UpdateAvailability {
  const hasWebappUpdate = status?.webapp?.update_available ?? false;
  const hasNirs4allUpdate = status?.nirs4all?.update_available ?? false;

  return {
    hasWebappUpdate,
    hasNirs4allUpdate,
    hasAnyUpdate: hasWebappUpdate || hasNirs4allUpdate,
    updateCount: (hasWebappUpdate ? 1 : 0) + (hasNirs4allUpdate ? 1 : 0),
  };
}

export function getInstallerUrl(status: UpdateStatus | null | undefined): string | null {
  return status?.webapp?.installer_download_url ?? status?.webapp?.release_url ?? null;
}

export function canApplyWebappUpdateInPlace(status: UpdateStatus | null | undefined): boolean {
  return status?.update_capability?.can_apply_in_place ?? true;
}

export function getWebappUpdateRowState({
  status,
  stagedUpdate,
  download,
  t,
}: {
  status: UpdateStatus | null | undefined;
  stagedUpdate: StagedUpdateInfo | null | undefined;
  download: WebappDownloadPresentationState;
  t: TFunction;
}): WebappUpdateRowState {
  const { hasWebappUpdate } = getUpdateAvailability(status);
  const canApplyInPlace = canApplyWebappUpdateInPlace(status);
  const hasStagedUpdate = stagedUpdate?.has_staged_update ?? false;
  const installerUrl = getInstallerUrl(status);
  const readyToApply = download.readyToApply || hasStagedUpdate;

  let action: WebappUpdateRowAction = null;
  if (download.isDownloading) {
    action = "downloading";
  } else if (canApplyInPlace && readyToApply) {
    action = "apply";
  } else if (hasWebappUpdate && canApplyInPlace) {
    action = "update";
  } else if (hasWebappUpdate && !canApplyInPlace) {
    action = "installer";
  } else if (!hasWebappUpdate && !readyToApply) {
    action = "up-to-date";
  }

  return {
    action,
    canApplyInPlace,
    currentVersion: status?.webapp?.current_version || t("settings.updates.unknownVersion"),
    downloadProgressPercent: Math.round(download.downloadProgress),
    hasStagedUpdate,
    hasUpdate: hasWebappUpdate,
    installerUrl,
    isPrerelease: status?.webapp?.is_prerelease ?? false,
    showTargetVersion: hasWebappUpdate || hasStagedUpdate,
    targetVersion: stagedUpdate?.version || status?.webapp?.latest_version,
  };
}

export function getNirs4allUpdateRowState(
  status: UpdateStatus | null | undefined,
  isReadOnlyRuntime: boolean,
): Nirs4allUpdateRowState {
  const currentVersion = status?.nirs4all?.current_version;
  const latestVersion = status?.nirs4all?.latest_version;
  const hasUpdate = status?.nirs4all?.update_available ?? false;

  return {
    action: hasUpdate ? "update" : currentVersion ? "up-to-date" : "install",
    currentVersion,
    isActionDisabled: isReadOnlyRuntime,
    latestVersion,
    showTargetVersion: hasUpdate,
  };
}

export function getCurrentRuntime(
  venvStatus: RuntimeStatusLike | null | undefined,
): RuntimeInfo | null {
  return venvStatus?.runtime ?? venvStatus?.venv ?? null;
}

export function getRuntimeExecutablePath(
  runtimeSummary: RuntimeSummaryResponse | null | undefined,
  currentRuntime: Pick<RuntimeInfo, "python_executable"> | null | undefined,
  t: TFunction,
): string {
  return runtimeSummary?.running_python ?? currentRuntime?.python_executable ?? t("settings.updates.runtime.unavailable");
}

export function getGpuDisplay(
  gpuInfo: GPUDetectionResponse | null | undefined,
  isLoading: boolean,
  t: TFunction,
): TextDisplay {
  if (isLoading) {
    return { label: t("settings.updates.runtime.detecting"), muted: true };
  }

  if (gpuInfo?.has_cuda) {
    const label = gpuInfo.gpu_name || "NVIDIA GPU";
    if (gpuInfo.cuda_version) {
      return { label: `${label} (CUDA ${gpuInfo.cuda_version})`, muted: false };
    }
    if (gpuInfo.driver_version) {
      return { label: t("settings.updates.runtime.gpuDriver", { name: label, version: gpuInfo.driver_version }), muted: false };
    }
    return { label, muted: false };
  }

  if (gpuInfo?.has_metal) {
    return { label: "Apple Metal", muted: false };
  }

  return { label: t("settings.updates.runtime.cpuOnly"), muted: true };
}

export function getTorchRuntimeDisplay(
  gpuInfo: GPUDetectionResponse | null | undefined,
  t: TFunction,
): TextDisplay | null {
  if (!gpuInfo) {
    return null;
  }

  if (!gpuInfo.torch_version) {
    return { label: t("settings.updates.runtime.torchNotInstalled"), muted: true };
  }

  return {
    label: t(gpuInfo.torch_cuda_available ? "settings.updates.runtime.torchCudaReady" : "settings.updates.runtime.torchCudaUnavailable", { version: gpuInfo.torch_version }),
    muted: false,
  };
}

export function getWebappDialogCopy({
  download,
  latestVersion,
  t,
}: {
  download: WebappDialogDownloadState;
  latestVersion: string | null | undefined;
  t: TFunction;
}): WebappDialogCopy {
  if (download.readyToApply) {
    return {
      title: t("settings.updates.webappDialog.readyTitle"),
      description: t("settings.updates.webappDialog.readyDescription", { version: download.stagedVersion || latestVersion }),
    };
  }

  if (download.isDownloading) {
    return {
      title: t("settings.updates.webappDialog.downloadingTitle"),
      description: download.downloadMessage || t("settings.updates.webappDialog.downloadingDefault"),
    };
  }

  return {
    title: t("settings.updates.webappDialog.availableTitle"),
    description: t("settings.updates.webappDialog.availableDescription", { version: latestVersion }),
  };
}
