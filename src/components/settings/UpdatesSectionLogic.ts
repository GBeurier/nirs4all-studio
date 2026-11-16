import type { TFunction } from "i18next";

import type { StagedUpdateInfo, UpdateStatus } from "@/api/updates";

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
  const hasWebappUpdate = status?.webapp?.update_available ?? false;
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
