/**
 * Updates Section Component
 *
 * Displays application update status and controls (GitHub Releases, with the
 * download/apply flow) and the update settings. Python packages are managed
 * on the Python tab.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useUpdateStatus,
  useCheckForUpdates,
  useUpdateSettings,
  useUpdateUpdateSettings,
  useUpdateDownload,
  useStagedUpdate,
} from "@/hooks/useUpdates";
import {
  getWebappChangelog,
  getLastApplyResult,
  dismissLastApplyResult,
} from "@/api/updates";
import {
  getWebappDialogCopy,
  getWebappUpdateRowState,
} from "./UpdatesSectionLogic";
import {
  UpdatesErrorCard,
  UpdatesLoadingCard,
  UpdatesSectionShell,
} from "./UpdatesSectionShell";
import { UpdatesApplyConfirmDialog } from "./UpdatesApplyConfirmDialog";
import { UpdatesWebappDialog } from "./UpdatesWebappDialog";

export function UpdatesSection() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading, error: statusError } = useUpdateStatus();
  const { data: settings, isLoading: settingsLoading } = useUpdateSettings();

  const checkMutation = useCheckForUpdates();
  const settingsMutation = useUpdateUpdateSettings();

  // Auto-update download/apply state
  const updateDownload = useUpdateDownload();
  const { data: stagedUpdate } = useStagedUpdate();

  // Surface a banner when the previous update apply silently failed (the app
  // closed for the updater but came back on the old version).
  const { data: lastApplyResult } = useQuery({
    queryKey: ["updates", "last-apply-result"],
    queryFn: getLastApplyResult,
    staleTime: 60 * 1000,
  });
  const dismissApplyResultMutation = useMutation({
    mutationFn: dismissLastApplyResult,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["updates", "last-apply-result"] }),
  });

  // Changelog
  const changelogQuery = useQuery({
    queryKey: ["changelog", status?.webapp?.current_version],
    queryFn: () => getWebappChangelog(status?.webapp?.current_version),
    enabled: false, // only fetch on demand
    staleTime: 5 * 60 * 1000,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [webappDialogOpen, setWebappDialogOpen] = useState(false);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);

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

  const webappRow = getWebappUpdateRowState({
    status,
    stagedUpdate,
    download: updateDownload,
    t,
  });
  // Prefer the resolved native installer (.exe/.dmg/.deb/.AppImage); fall back
  // to the release page when it couldn't be resolved.
  const installerUrl = webappRow.installerUrl;
  const canApplyInPlace = webappRow.canApplyInPlace;
  const openInstaller = () => {
    if (!installerUrl) return;
    const electronApi = (window as unknown as Record<string, unknown>).electronApi as
      | { openExternal?: (u: string) => Promise<void> }
      | undefined;
    if (electronApi?.openExternal) void electronApi.openExternal(installerUrl);
    else window.open(installerUrl, "_blank", "noopener,noreferrer");
  };
  const webappDialogCopy = getWebappDialogCopy({
    download: updateDownload,
    latestVersion: status?.webapp?.latest_version,
    t,
  });

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
      lastApplyResult={lastApplyResult}
      installerUrl={installerUrl}
      onOpenInstaller={openInstaller}
      onDismissApplyResult={() => dismissApplyResultMutation.mutate()}
      isDismissApplyResultPending={dismissApplyResultMutation.isPending}
      webappRow={webappRow}
      onOpenWebappDialog={() => setWebappDialogOpen(true)}
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
        onOpenChange={(open) => {
          if (!open && (updateDownload.isDownloading || updateDownload.readyToApply)) {
            return;
          }
          if (open && webappRow.hasUpdate) {
            void changelogQuery.refetch();
          }
          setWebappDialogOpen(open);
        }}
        onClose={() => setWebappDialogOpen(false)}
        onApplyClick={() => setApplyConfirmOpen(true)}
        copy={webappDialogCopy}
        status={status}
        installerUrl={installerUrl}
        updateDownload={updateDownload}
        canApplyInPlace={canApplyInPlace}
        isChangelogLoading={changelogQuery.isLoading}
        changelogEntries={changelogQuery.data?.entries}
      />

      <UpdatesApplyConfirmDialog
        open={applyConfirmOpen}
        onOpenChange={setApplyConfirmOpen}
        latestVersion={status?.webapp?.latest_version}
        updateDownload={updateDownload}
      />
    </UpdatesSectionShell>
  );
}
