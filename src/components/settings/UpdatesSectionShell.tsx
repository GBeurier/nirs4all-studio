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

export function UpdatesLoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Updates
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
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <Download className="h-5 w-5" />
          Updates
        </CardTitle>
        <CardDescription className="text-destructive">
          Failed to check for updates
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
          Retry
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
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Updates
              {hasAnyUpdate && (
                <Badge variant="default" className="ml-2">
                  {updateCount} available
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Check for webapp and library updates
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onCheckNow}
            disabled={isChecking}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isChecking ? "animate-spin" : ""}`} />
            Check Now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Restart Banner */}
        {needsRestart && (
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="flex items-center justify-between">
              <span>Package changes require a backend restart to take effect.</span>
              <Button
                variant="outline"
                size="sm"
                onClick={onRestartBackend}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                Restart Backend
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isReadOnlyRuntime && (
          <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription>
              {runtimeDisplay.isBundledEmbedded
                ? "This bundled build is still using its embedded Python runtime. nirs4all installs and snapshot restores are disabled because the embedded runtime is read-only."
                : "This packaged backend runtime is read-only. Package mutations are disabled in this mode."}
            </AlertDescription>
          </Alert>
        )}

        {runtimeDisplay.isBundledExternal && (
          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription>
              This bundled build is running on an external Python runtime. Package installs, updates, and snapshot restores now apply to that external environment.
            </AlertDescription>
          </Alert>
        )}

        {/* Previous update silently failed — surface it and offer the installer */}
        {lastApplyResult?.status === "failed" && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div>
                The last update didn&apos;t complete — the app is still on{" "}
                <span className="font-mono">{lastApplyResult.from_version}</span>
                {lastApplyResult.to_version ? (
                  <>
                    {" "}
                    (expected <span className="font-mono">{lastApplyResult.to_version}</span>)
                  </>
                ) : null}
                . You can install it manually from the release page.
              </div>
              <div className="flex gap-2">
                {installerUrl && (
                  <Button size="sm" variant="outline" onClick={onOpenInstaller}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Get installer
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onDismissApplyResult}
                  disabled={isDismissApplyResultPending}
                >
                  Dismiss
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
            Last checked: {new Date(lastCheck).toLocaleString()}
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
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            Working Config
          </span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-muted-foreground">
              {snapshots.length ?? 0} saved
            </Badge>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Save the current package state to restore later if an upgrade causes issues.
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
            Save Current
          </Button>
        </div>

        {snapshots && snapshots.length > 0 ? (
          <div className="space-y-2">
            {snapshots.map((snap) => (
              <div key={snap.name} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                <div>
                  <span className="font-medium">{snap.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {new Date(snap.created_at).toLocaleDateString()}
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
                    <span className="ml-1">Restore</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => onDeleteSnapshot(snap.name)}
                    disabled={isDeletingSnapshot}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic p-2">
            No snapshots saved yet. Save one before upgrading.
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
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between p-2 h-auto">
          <span className="text-sm font-medium flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Update Settings
          </span>
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="auto-check">Automatic update checks</Label>
            <p className="text-xs text-muted-foreground">
              Check for updates on startup and periodically
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
            <Label htmlFor="prerelease">Include pre-releases</Label>
            <p className="text-xs text-muted-foreground">
              Get notified about beta and preview versions
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
            <Label htmlFor="offline-mode">Network mode</Label>
            <p className="text-xs text-muted-foreground">
              Auto probes on startup, Offline disables all network calls
            </p>
          </div>
          <select
            id="offline-mode"
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={settings?.offline_mode ?? "auto"}
            onChange={(e) => onOfflineModeChange(e.target.value as "auto" | "on" | "off")}
            disabled={isSettingsPending}
          >
            <option value="auto">Auto (detect)</option>
            <option value="off">Always online</option>
            <option value="on">Offline</option>
          </select>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
