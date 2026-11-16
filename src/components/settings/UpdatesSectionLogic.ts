import type { TFunction } from "i18next";

import type { UpdateStatus } from "@/api/updates";

export type WebappUpdateRowState = {
  currentVersion: string;
  hasUpdate: boolean;
  isPrerelease: boolean;
  targetVersion: string | null | undefined;
};

/** Installer of the newer release for this platform, or its release page. */
export function getInstallerUrl(status: UpdateStatus | null | undefined): string | null {
  return status?.webapp?.installer_download_url ?? status?.webapp?.release_url ?? null;
}

export function getWebappUpdateRowState({
  status,
  t,
}: {
  status: UpdateStatus | null | undefined;
  t: TFunction;
}): WebappUpdateRowState {
  return {
    currentVersion: status?.webapp?.current_version || t("settings.updates.unknownVersion"),
    hasUpdate: status?.webapp?.update_available ?? false,
    isPrerelease: status?.webapp?.is_prerelease ?? false,
    targetVersion: status?.webapp?.latest_version,
  };
}
