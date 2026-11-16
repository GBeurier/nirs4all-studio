/**
 * Updates Section Component
 *
 * Displays the installed version, checks GitHub Releases for a newer one,
 * shows its changelog and opens the installer download for this platform.
 * Studio is updated by running that installer; nothing is downloaded or
 * applied from inside the application. Python packages are managed on the
 * Python tab.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useUpdateStatus,
  useCheckForUpdates,
  useUpdateSettings,
  useUpdateUpdateSettings,
} from "@/hooks/useUpdates";
import { getWebappChangelog } from "@/api/updates";
import {
  getInstallerUrl,
  getWebappUpdateRowState,
} from "./UpdatesSectionLogic";
import {
  UpdatesErrorCard,
  UpdatesLoadingCard,
  UpdatesSectionShell,
} from "./UpdatesSectionShell";
import { UpdatesWebappDialog } from "./UpdatesWebappDialog";

export function UpdatesSection() {
  const { t } = useTranslation();
  const { data: status, isLoading: statusLoading, error: statusError } = useUpdateStatus();
  const { data: settings, isLoading: settingsLoading } = useUpdateSettings();

  const checkMutation = useCheckForUpdates();
  const settingsMutation = useUpdateUpdateSettings();

  // Changelog
  const changelogQuery = useQuery({
    queryKey: ["changelog", status?.webapp?.current_version],
    queryFn: () => getWebappChangelog(status?.webapp?.current_version),
    enabled: false, // only fetch on demand
    staleTime: 5 * 60 * 1000,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webappDialogOpen, setWebappDialogOpen] = useState(false);

  const isLoading = statusLoading || settingsLoading;

  if (isLoading) {
    return <UpdatesLoadingCard />;
  }

  if (statusError) {
    return (
      <UpdatesErrorCard
        onRetry={() => checkMutation.mutate()}
        isRetrying={checkMutation.isPending}
      />
    );
  }

  const webappRow = getWebappUpdateRowState({ status, t });
  // Prefer the installer resolved for this platform (.exe/.dmg/.deb); fall back to the
  // release page when it couldn't be resolved.
  const installerUrl = getInstallerUrl(status);
  const openInstaller = () => {
    if (!installerUrl) return;
    const electronApi = (window as unknown as Record<string, unknown>).electronApi as
      | { openExternal?: (u: string) => Promise<void> }
      | undefined;
    if (electronApi?.openExternal) void electronApi.openExternal(installerUrl);
    else window.open(installerUrl, "_blank", "noopener,noreferrer");
  };

  const handleAutoCheckToggle = (checked: boolean) => {
    settingsMutation.mutate({ auto_check: checked });
  };

  const handlePrereleaseToggle = (checked: boolean) => {
    settingsMutation.mutate({ prerelease_channel: checked }, {
      onSuccess: () => {
        // Re-check for updates with the new channel setting
        checkMutation.mutate();
      },
    });
  };

  const handleOfflineModeChange = (value: "auto" | "on" | "off") => {
    settingsMutation.mutate({ offline_mode: value });
  };

  return (
    <UpdatesSectionShell
      isChecking={checkMutation.isPending}
      onCheckNow={() => checkMutation.mutate()}
      webappRow={webappRow}
      onOpenWebappDialog={() => {
        void changelogQuery.refetch();
        setWebappDialogOpen(true);
      }}
      lastCheck={status?.last_check}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      settings={settings}
      onAutoCheckToggle={handleAutoCheckToggle}
      onPrereleaseToggle={handlePrereleaseToggle}
      onOfflineModeChange={handleOfflineModeChange}
      isSettingsPending={settingsMutation.isPending}
    >
      <UpdatesWebappDialog
        open={webappDialogOpen}
        onOpenChange={setWebappDialogOpen}
        onOpenInstaller={openInstaller}
        status={status}
        installerUrl={installerUrl}
        isChangelogLoading={changelogQuery.isLoading}
        changelogEntries={changelogQuery.data?.entries}
      />
    </UpdatesSectionShell>
  );
}
