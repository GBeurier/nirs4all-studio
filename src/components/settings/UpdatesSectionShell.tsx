/**
 * Updates Section — presentation shell
 *
 * Pure presentation/composition for the Updates settings card:
 * loading/error cards, the header, the alert banners, the update rows,
 * the runtime status panel, and the snapshots/settings collapsibles.
 *
 * All hooks, mutations, dialog state, restart, and API side effects stay in
 * `UpdatesSection.tsx` — this file only renders props and forwards callbacks.
 */

import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import type {
  ConfigSnapshot,
  LastApplyResult,
  RuntimeInfo,
  UpdateSettings,
} from "@/api/updates";
import type { PythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";

import { RuntimeStatusPanel } from "./UpdatesSectionRuntimePanel";
import { Nirs4allUpdateRow, WebappUpdateRow } from "./UpdatesSectionRows";
import type {
  Nirs4allUpdateRowState,
  TextDisplay,
  WebappUpdateRowState,
} from "./UpdatesSectionLogic";
import { getActiveLocale } from "@/lib/activeLocale";

export function UpdatesLoadingCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          {t("settings.updates.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-8 w-32" />
      </CardContent>
    </Card>
  );
}

interface UpdatesErrorCardProps {
  onRetry: () => void;
  isRetrying: boolean;
}

export function UpdatesErrorCard({ onRetry, isRetrying }: UpdatesErrorCardProps) {
  const { t } = useTranslation();
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Download className="h-5 w-5" />
          {t("settings.updates.title")}
        </CardTitle>
        <CardDescription className="text-destructive">
          {t("settings.updates.checkFailed")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          disabled={isRetrying}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
          {t("common.retry")}
        </Button>
      </CardContent>
    </Card>
  );
}

interface UpdatesSectionShellProps {
  // Header
  hasAnyUpdate: boolean;
  updateCount: number;
  isChecking: boolean;
  onCheckNow: () => void;

  // Alert banners
  needsRestart: boolean;
  onRestartBackend: () => void | Promise<void>;
  runtimeDisplay: PythonRuntimeDisplayState;
  isReadOnlyRuntime: boolean;
  lastApplyResult: LastApplyResult | undefined;
  installerUrl: string | null;
  onOpenInstaller: () => void;
  onDismissApplyResult: () => void;
  isDismissApplyResultPending: boolean;

  // Update rows
  webappRow: WebappUpdateRowState;
  nirs4allRow: Nirs4allUpdateRowState;
  onOpenWebappDialog: () => void;
  onOpenNirs4allDialog: () => void;

  // Last check
  lastCheck: string | null | undefined;

  // Runtime status panel
  currentRuntime: RuntimeInfo | null;
  gpuDisplay: TextDisplay;
  isRuntimeLoading: boolean;
  venvOpen: boolean;
  onVenvOpenChange: (open: boolean) => void;
  packageCount: number;
  runtimeExecutablePath: string;
  runtimeSizeLabel: string;
  torchDisplay: TextDisplay | null;

  // Snapshots
  snapshotsOpen: boolean;
  onSnapshotsOpenChange: (open: boolean) => void;
  snapshots: ConfigSnapshot[];
  canCreateSnapshot: boolean;
  onCreateSnapshot: () => void;
  isCreatingSnapshot: boolean;
  onRestoreSnapshot: (name: string) => void;
  isRestoringSnapshot: boolean;
  onDeleteSnapshot: (name: string) => void;
  isDeletingSnapshot: boolean;

  // Settings
  settingsOpen: boolean;
  onSettingsOpenChange: (open: boolean) => void;
  settings: UpdateSettings | undefined;
  onAutoCheckToggle: (checked: boolean) => void;
  onPrereleaseToggle: (checked: boolean) => void;
  onOfflineModeChange: (value: "auto" | "on" | "off") => void;
  isSettingsPending: boolean;

  // Dialogs (rendered inside the card; own their state in UpdatesSection)
  children: ReactNode;
}

export function UpdatesSectionShell({
  hasAnyUpdate,
  updateCount,
  isChecking,
  onCheckNow,
  needsRestart,
  onRestartBackend,
  runtimeDisplay,
  isReadOnlyRuntime,
  lastApplyResult,
  installerUrl,
  onOpenInstaller,
  onDismissApplyResult,
  isDismissApplyResultPending,
  webappRow,
  nirs4allRow,
  onOpenWebappDialog,
  onOpenNirs4allDialog,
  lastCheck,
  currentRuntime,
  gpuDisplay,
  isRuntimeLoading,
  venvOpen,
  onVenvOpenChange,
  packageCount,
  runtimeExecutablePath,
  runtimeSizeLabel,
  torchDisplay,
  snapshotsOpen,
  onSnapshotsOpenChange,
  snapshots,
  canCreateSnapshot,
  onCreateSnapshot,
  isCreatingSnapshot,
  onRestoreSnapshot,
  isRestoringSnapshot,
  onDeleteSnapshot,
  isDeletingSnapshot,
  settingsOpen,
  onSettingsOpenChange,
  settings,
  onAutoCheckToggle,
  onPrereleaseToggle,
  onOfflineModeChange,
  isSettingsPending,
  children,
}: UpdatesSectionShellProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              {t("settings.updates.title")}
              {hasAnyUpdate && (
                <Badge variant="default" className="ml-2">
                  {t("settings.updates.availableCount", { count: updateCount })}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {t("settings.updates.description")}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckNow}
            disabled={isChecking}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
            {t("settings.updates.checkNow")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Restart Banner */}
        {needsRestart && (
          <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="flex items-center justify-between">
              <span>{t("settings.updates.restartNeeded")}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onRestartBackend}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                {t("settings.updates.restartBackend")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isReadOnlyRuntime && (
          <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription>
              {runtimeDisplay.isBundledEmbedded
                ? t("settings.updates.readOnlyEmbedded")
                : t("settings.updates.readOnlyChoose")}
            </AlertDescription>
          </Alert>
        )}

        {runtimeDisplay.isBundledExternal && (
          <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription>
              {t("settings.updates.externalRuntime")}
            </AlertDescription>
          </Alert>
        )}

        {/* Previous update silently failed — surface it and offer the installer */}
        {lastApplyResult?.status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div>
                {lastApplyResult.to_version
                  ? t("settings.updates.lastApplyFailedExpected", { from: lastApplyResult.from_version, to: lastApplyResult.to_version })
                  : t("settings.updates.lastApplyFailed", { from: lastApplyResult.from_version })}
              </div>
              <div className="flex gap-2">
                {installerUrl && (
                  <Button size="sm" variant="outline" onClick={onOpenInstaller}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {t("settings.updates.getInstaller")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDismissApplyResult}
                  disabled={isDismissApplyResultPending}
                >
                  {t("settings.updates.dismiss")}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Webapp Update */}
        <WebappUpdateRow
          row={webappRow}
          onOpenDialog={onOpenWebappDialog}
          onOpenInstaller={onOpenInstaller}
        />

        {/* nirs4all Library Update */}
        <Nirs4allUpdateRow
          row={nirs4allRow}
          onOpenDialog={onOpenNirs4allDialog}
        />

        {/* Last Check Info */}
        {lastCheck && (
          <p className="text-xs text-muted-foreground">
            {t("settings.updates.lastChecked", { date: new Date(lastCheck).toLocaleString(getActiveLocale()) })}
          </p>
        )}

        <RuntimeStatusPanel
          currentRuntime={currentRuntime}
          gpuDisplay={gpuDisplay}
          isLoading={isRuntimeLoading}
          onOpenChange={onVenvOpenChange}
          open={venvOpen}
          packageCount={packageCount}
          runtimeDisplay={runtimeDisplay}
          runtimeExecutablePath={runtimeExecutablePath}
          runtimeSizeLabel={runtimeSizeLabel}
          torchDisplay={torchDisplay}
        />

        <SnapshotsSection
          open={snapshotsOpen}
          onOpenChange={onSnapshotsOpenChange}
          snapshots={snapshots}
          canCreateSnapshot={canCreateSnapshot}
          onCreateSnapshot={onCreateSnapshot}
          isCreatingSnapshot={isCreatingSnapshot}
          isReadOnlyRuntime={isReadOnlyRuntime}
          onRestoreSnapshot={onRestoreSnapshot}
          isRestoringSnapshot={isRestoringSnapshot}
          onDeleteSnapshot={onDeleteSnapshot}
          isDeletingSnapshot={isDeletingSnapshot}
        />

        <UpdateSettingsSection
          open={settingsOpen}
          onOpenChange={onSettingsOpenChange}
          settings={settings}
          onAutoCheckToggle={onAutoCheckToggle}
          onPrereleaseToggle={onPrereleaseToggle}
          onOfflineModeChange={onOfflineModeChange}
          isSettingsPending={isSettingsPending}
        />
      </CardContent>

      {children}
    </Card>
  );
}

interface SnapshotsSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshots: ConfigSnapshot[];
  canCreateSnapshot: boolean;
  onCreateSnapshot: () => void;
  isCreatingSnapshot: boolean;
  isReadOnlyRuntime: boolean;
  onRestoreSnapshot: (name: string) => void;
  isRestoringSnapshot: boolean;
  onDeleteSnapshot: (name: string) => void;
  isDeletingSnapshot: boolean;
}

function SnapshotsSection({
  open,
  onOpenChange,
  snapshots,
  canCreateSnapshot,
  onCreateSnapshot,
  isCreatingSnapshot,
  isReadOnlyRuntime,
  onRestoreSnapshot,
  isRestoringSnapshot,
  onDeleteSnapshot,
  isDeletingSnapshot,
}: SnapshotsSectionProps) {
  const { t } = useTranslation();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("settings.updates.workingConfig")}
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground">
              {t("settings.updates.savedCount", { count: snapshots.length ?? 0 })}
            </Badge>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t("settings.updates.snapshotHint")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onCreateSnapshot}
            disabled={isCreatingSnapshot || !canCreateSnapshot}
          >
            {isCreatingSnapshot ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Save className="mr-2 h-3 w-3" />
            )}
            {t("settings.updates.saveCurrent")}
          </Button>
        </div>

        {snapshots && snapshots.length > 0 ? (
          <div className="space-y-2">
            {snapshots.map((snap) => (
              <div key={snap.name} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                <div>
                  <span className="font-medium">{snap.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {new Date(snap.created_at).toLocaleDateString(getActiveLocale())}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => onRestoreSnapshot(snap.name)}
                    disabled={isRestoringSnapshot || isReadOnlyRuntime}
                  >
                    {isRestoringSnapshot ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    <span className="ml-1">{t("settings.updates.restore")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => onDeleteSnapshot(snap.name)}
                    disabled={isDeletingSnapshot}
                    aria-label={t("settings.updates.deleteSnapshot")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic p-2">
            {t("settings.updates.noSnapshots")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

interface UpdateSettingsSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: UpdateSettings | undefined;
  onAutoCheckToggle: (checked: boolean) => void;
  onPrereleaseToggle: (checked: boolean) => void;
  onOfflineModeChange: (value: "auto" | "on" | "off") => void;
  isSettingsPending: boolean;
}

function UpdateSettingsSection({
  open,
  onOpenChange,
  settings,
  onAutoCheckToggle,
  onPrereleaseToggle,
  onOfflineModeChange,
  isSettingsPending,
}: UpdateSettingsSectionProps) {
  const { t } = useTranslation();
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            {t("settings.updates.updateSettings")}
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-check">{t("settings.updates.autoCheck")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.autoCheckHint")}
            </p>
          </div>
          <Switch
            id="auto-check"
            checked={settings?.auto_check ?? true}
            onCheckedChange={onAutoCheckToggle}
            disabled={isSettingsPending}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="prerelease">{t("settings.updates.prerelease")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.prereleaseHint")}
            </p>
          </div>
          <Switch
            id="prerelease"
            checked={settings?.prerelease_channel ?? false}
            onCheckedChange={onPrereleaseToggle}
            disabled={isSettingsPending}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="offline-mode">{t("settings.updates.networkMode")}</Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.networkModeHint")}
            </p>
          </div>
          <select
            id="offline-mode"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={settings?.offline_mode ?? "auto"}
            onChange={(e) => onOfflineModeChange(e.target.value as "auto" | "on" | "off")}
            disabled={isSettingsPending}
          >
            <option value="auto">{t("settings.updates.networkAuto")}</option>
            <option value="off">{t("settings.updates.networkOnline")}</option>
            <option value="on">{t("settings.updates.networkOffline")}</option>
          </select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
