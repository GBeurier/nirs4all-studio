/**
 * Updates Section Component
 *
 * Displays update status and controls for:
 * - Webapp updates (from GitHub Releases) with download/apply flow
 * - nirs4all library updates (from PyPI)
 * - Managed virtual environment status
 * - Update settings
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  RefreshCw,
  Package,
  Settings2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  Loader2,
  FolderOpen,
  HardDrive,
  XCircle,
  RotateCcw,
  Save,
  History,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useUpdateStatus,
  useCheckForUpdates,
  useUpdateSettings,
  useUpdateUpdateSettings,
  useVenvStatus,
  useInstallNirs4all,
  useCreateVenv,
  useUpdateDownload,
  useStagedUpdate,
  formatBytes,
} from "@/hooks/useUpdates";
import {
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  getWebappChangelog,
  requestRestart,
  type ConfigSnapshot,
  type ChangelogEntry,
} from "@/api/client";

export function UpdatesSection() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading, error: statusError } = useUpdateStatus();
  const { data: settings, isLoading: settingsLoading } = useUpdateSettings();
  const { data: venvStatus, isLoading: venvLoading } = useVenvStatus();

  const checkMutation = useCheckForUpdates();
  const settingsMutation = useUpdateUpdateSettings();
  const installMutation = useInstallNirs4all();
  const createVenvMutation = useCreateVenv();

  // Auto-update download/apply state
  const updateDownload = useUpdateDownload();
  const { data: stagedUpdate } = useStagedUpdate();

  // Snapshots
  const snapshotsQuery = useQuery({
    queryKey: ["snapshots"],
    queryFn: listSnapshots,
    staleTime: 60 * 1000,
  });
  const createSnapshotMutation = useMutation({
    mutationFn: (label?: string) => createSnapshot(label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });
  const restoreSnapshotMutation = useMutation({
    mutationFn: (name: string) => restoreSnapshot(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["updates", "venv"] });
      queryClient.invalidateQueries({ queryKey: ["updates", "status"] });
    },
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: (name: string) => deleteSnapshot(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  // Changelog
  const changelogQuery = useQuery({
    queryKey: ["changelog", status?.webapp?.current_version],
    queryFn: () => getWebappChangelog(status?.webapp?.current_version),
    enabled: false, // only fetch on demand
    staleTime: 5 * 60 * 1000,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [venvOpen, setVenvOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [nirs4allDialogOpen, setNirs4allDialogOpen] = useState(false);
  const [webappDialogOpen, setWebappDialogOpen] = useState(false);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);

  const isLoading = statusLoading || settingsLoading;

  if (isLoading) {
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

  if (statusError) {
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
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${checkMutation.isPending ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasWebappUpdate = status?.webapp?.update_available ?? false;
  const hasNirs4allUpdate = status?.nirs4all?.update_available ?? false;
  const hasAnyUpdate = hasWebappUpdate || hasNirs4allUpdate;

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
                  {(hasWebappUpdate ? 1 : 0) + (hasNirs4allUpdate ? 1 : 0)} available
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
            onClick={() => checkMutation.mutate()}
            disabled={checkMutation.isPending}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${checkMutation.isPending ? "animate-spin" : ""}`} />
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
                onClick={async () => {
                  const electronApi = (window as Record<string, unknown>).electronApi as { restartBackend?: () => Promise<{ success: boolean }> } | undefined;
                  if (electronApi?.restartBackend) {
                    const result = await electronApi.restartBackend();
                    if (result.success) setNeedsRestart(false);
                  } else {
                    await requestRestart();
                    setNeedsRestart(false);
                  }
                }}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                Restart Backend
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Webapp Update */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="font-medium">nirs4all Webapp</span>
            </div>
            <div className="text-sm text-muted-foreground">
              Current: <span className="font-mono">{status?.webapp?.current_version || "unknown"}</span>
              {(hasWebappUpdate || stagedUpdate?.has_staged_update) && (
                <>
                  {" → "}
                  <span className="font-mono text-primary">
                    {stagedUpdate?.version || status?.webapp?.latest_version}
                  </span>
                  {status?.webapp?.is_prerelease && (
                    <Badge variant="outline" className="text-xs py-0 ml-1">pre-release</Badge>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Show downloading state */}
            {updateDownload.isDownloading && (
              <Badge variant="secondary" className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Downloading {Math.round(updateDownload.downloadProgress)}%
              </Badge>
            )}

            {/* Show ready to apply state */}
            {(updateDownload.readyToApply || stagedUpdate?.has_staged_update) && !updateDownload.isDownloading && (
              <Button size="sm" onClick={() => setWebappDialogOpen(true)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Apply Update
              </Button>
            )}

            {/* Show update available */}
            {hasWebappUpdate && !updateDownload.readyToApply && !stagedUpdate?.has_staged_update && !updateDownload.isDownloading && (
              <Button size="sm" onClick={() => setWebappDialogOpen(true)}>
                <Download className="mr-2 h-4 w-4" />
                Update
              </Button>
            )}

            {/* Show up to date */}
            {!hasWebappUpdate && !updateDownload.readyToApply && !stagedUpdate?.has_staged_update && !updateDownload.isDownloading && (
              <Badge variant="outline" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Up to date
              </Badge>
            )}
          </div>
        </div>

        {/* nirs4all Library Update */}
        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-primary" />
              <span className="font-medium">nirs4all Library</span>
            </div>
            <div className="text-sm text-muted-foreground">
              {status?.nirs4all?.current_version ? (
                <>
                  Current: <span className="font-mono">{status?.nirs4all?.current_version}</span>
                  {hasNirs4allUpdate && (
                    <>
                      {" → "}
                      <span className="font-mono text-primary">{status?.nirs4all?.latest_version}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-amber-600">Not installed in managed venv</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasNirs4allUpdate ? (
              <Button size="sm" onClick={() => setNirs4allDialogOpen(true)}>
                <Download className="mr-2 h-4 w-4" />
                Update
              </Button>
            ) : status?.nirs4all?.current_version ? (
              <Badge variant="outline" className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                Up to date
              </Badge>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setNirs4allDialogOpen(true)}>
                Install
              </Button>
            )}
          </div>
        </div>

        {/* Last Check Info */}
        {status?.last_check && (
          <p className="text-xs text-muted-foreground">
            Last checked: {new Date(status.last_check).toLocaleString()}
          </p>
        )}

        {/* Managed Venv Section */}
        <Collapsible open={venvOpen} onOpenChange={setVenvOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <span className="text-sm font-medium flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Managed Environment
              </span>
              <div className="flex items-center gap-2">
                {venvStatus?.venv?.is_valid ? (
                  <Badge variant="outline" className="text-green-600">Active</Badge>
                ) : (
                  <Badge variant="outline" className="text-amber-600">Not configured</Badge>
                )}
                <ChevronDown className={`h-4 w-4 transition-transform ${venvOpen ? "rotate-180" : ""}`} />
              </div>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-3">
            {venvLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : venvStatus?.venv?.is_valid ? (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Python:</span>
                  <span className="font-mono">{venvStatus.venv.python_version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Size:</span>
                  <span>{formatBytes(venvStatus.venv.size_bytes)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Packages:</span>
                  <span>{venvStatus.packages?.length || 0} installed</span>
                </div>
                <div className="flex justify-between items-start">
                  <span className="text-muted-foreground">Path:</span>
                  <span className="font-mono text-xs break-all text-right max-w-[60%]">
                    {venvStatus.venv.path}
                  </span>
                </div>
              </div>
            ) : (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  The managed virtual environment is not configured. Create one to enable independent nirs4all updates.
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-4"
                    onClick={() => createVenvMutation.mutate({ install_nirs4all: true })}
                    disabled={createVenvMutation.isPending}
                  >
                    {createVenvMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <FolderOpen className="mr-2 h-4 w-4" />
                    )}
                    Create Environment
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Working Config Snapshots */}
        <Collapsible open={snapshotsOpen} onOpenChange={setSnapshotsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <span className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4" />
                Working Config
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-muted-foreground">
                  {snapshotsQuery.data?.snapshots?.length ?? 0} saved
                </Badge>
                <ChevronDown className={`h-4 w-4 transition-transform ${snapshotsOpen ? "rotate-180" : ""}`} />
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
                onClick={() => createSnapshotMutation.mutate(undefined)}
                disabled={createSnapshotMutation.isPending || !venvStatus?.venv?.is_valid}
              >
                {createSnapshotMutation.isPending ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <Save className="mr-2 h-3 w-3" />
                )}
                Save Current
              </Button>
            </div>

            {snapshotsQuery.data?.snapshots && snapshotsQuery.data.snapshots.length > 0 ? (
              <div className="space-y-2">
                {snapshotsQuery.data.snapshots.map((snap) => (
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
                        onClick={() => restoreSnapshotMutation.mutate(snap.name)}
                        disabled={restoreSnapshotMutation.isPending}
                      >
                        {restoreSnapshotMutation.isPending ? (
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
                        onClick={() => deleteSnapshotMutation.mutate(snap.name)}
                        disabled={deleteSnapshotMutation.isPending}
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

        {/* Settings Section */}
        <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between p-2 h-auto">
              <span className="text-sm font-medium flex items-center gap-2">
                <Settings2 className="h-4 w-4" />
                Update Settings
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
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
                onCheckedChange={handleAutoCheckToggle}
                disabled={settingsMutation.isPending}
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
                onCheckedChange={handlePrereleaseToggle}
                disabled={settingsMutation.isPending}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>

      {/* Webapp Update Dialog */}
      <Dialog
        open={webappDialogOpen}
        onOpenChange={(open) => {
          // Don't allow closing during download or if ready to apply
          if (!open && (updateDownload.isDownloading || updateDownload.readyToApply)) {
            return;
          }
          if (open && hasWebappUpdate) {
            changelogQuery.refetch();
          }
          setWebappDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {updateDownload.readyToApply
                ? "Update Ready to Apply"
                : updateDownload.isDownloading
                  ? "Downloading Update..."
                  : "Webapp Update Available"}
              {status?.webapp?.is_prerelease && (
                <Badge variant="outline" className="text-xs">Pre-release</Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {updateDownload.readyToApply
                ? `Version ${updateDownload.stagedVersion || status?.webapp?.latest_version} is ready to install`
                : updateDownload.isDownloading
                  ? updateDownload.downloadMessage || "Downloading..."
                  : `Version ${status?.webapp?.latest_version} is available`}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Download Progress */}
            {updateDownload.isDownloading && (
              <div className="space-y-2">
                <Progress value={updateDownload.downloadProgress} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{updateDownload.downloadMessage}</span>
                  <span>{Math.round(updateDownload.downloadProgress)}%</span>
                </div>
              </div>
            )}

            {/* Download Error */}
            {updateDownload.downloadError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {updateDownload.downloadError}
                </AlertDescription>
              </Alert>
            )}

            {/* Ready to Apply */}
            {updateDownload.readyToApply && !updateDownload.isApplying && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription>
                  Download complete. Click "Apply Update" to install. The application will restart automatically.
                </AlertDescription>
              </Alert>
            )}

            {/* Apply in Progress */}
            {updateDownload.isApplying && (
              <Alert>
                <Loader2 className="h-4 w-4 animate-spin" />
                <AlertDescription>
                  Applying update... The application will restart shortly.
                </AlertDescription>
              </Alert>
            )}

            {/* Apply Success */}
            {updateDownload.applySuccess && (
              <Alert>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription>
                  Update applied! Please close and reopen the application.
                </AlertDescription>
              </Alert>
            )}

            {/* Apply Error */}
            {updateDownload.applyError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to apply update: {updateDownload.applyError}
                </AlertDescription>
              </Alert>
            )}

            {/* Changelog (only show when not downloading) */}
            {!updateDownload.isDownloading && !updateDownload.readyToApply && (
              <div className="max-h-48 overflow-y-auto p-3 bg-muted rounded-lg text-sm">
                <h4 className="font-medium mb-2">What's New</h4>
                {changelogQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading changelog...
                  </div>
                ) : changelogQuery.data?.entries && changelogQuery.data.entries.length > 0 ? (
                  <div className="space-y-3">
                    {changelogQuery.data.entries.map((entry) => (
                      <div key={entry.version}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-primary">v{entry.version}</span>
                          {entry.prerelease && (
                            <Badge variant="outline" className="text-xs py-0">pre</Badge>
                          )}
                          {entry.date && (
                            <span className="text-xs text-muted-foreground">
                              {new Date(entry.date).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <div className="prose prose-sm dark:prose-invert whitespace-pre-wrap text-muted-foreground">
                          {entry.body || "No release notes."}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : status?.webapp?.release_notes ? (
                  <div className="prose prose-sm dark:prose-invert whitespace-pre-wrap">
                    {status.webapp.release_notes}
                  </div>
                ) : (
                  <p className="text-muted-foreground italic">No release notes available.</p>
                )}
              </div>
            )}

            {/* Download Size */}
            {!updateDownload.isDownloading && !updateDownload.readyToApply && status?.webapp?.download_size_bytes && (
              <p className="text-sm text-muted-foreground">
                Download size: {formatBytes(status.webapp.download_size_bytes)}
              </p>
            )}

            {/* Info Alert (only show before download starts) */}
            {!updateDownload.isDownloading && !updateDownload.readyToApply && !updateDownload.downloadError && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Webapp updates will be downloaded and extracted. The application will restart to apply the update.
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {/* Cancel/Close button */}
            {!updateDownload.isApplying && !updateDownload.applySuccess && (
              <Button
                variant="outline"
                onClick={() => {
                  if (updateDownload.isDownloading) {
                    updateDownload.cancelDownload();
                  } else if (updateDownload.readyToApply) {
                    updateDownload.cancelStagedUpdate();
                    updateDownload.reset();
                  } else {
                    setWebappDialogOpen(false);
                  }
                }}
                disabled={updateDownload.isCancellingDownload || updateDownload.isCancellingStagedUpdate}
              >
                {(updateDownload.isCancellingDownload || updateDownload.isCancellingStagedUpdate) && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {updateDownload.isDownloading || updateDownload.readyToApply ? (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Cancel Update
                  </>
                ) : (
                  "Later"
                )}
              </Button>
            )}

            {/* Main action button */}
            {!updateDownload.readyToApply && !updateDownload.isDownloading && !updateDownload.applySuccess && (
              <>
                {/* Manual download link as fallback */}
                {status?.webapp?.release_url && (
                  <Button variant="outline" asChild>
                    <a href={status.webapp.release_url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Manual Download
                    </a>
                  </Button>
                )}

                {/* Auto download button */}
                <Button
                  onClick={() => updateDownload.startDownload()}
                  disabled={updateDownload.isStartingDownload}
                >
                  {updateDownload.isStartingDownload ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download & Install
                </Button>
              </>
            )}

            {/* Apply Update button */}
            {updateDownload.readyToApply && !updateDownload.isApplying && !updateDownload.applySuccess && (
              <Button
                onClick={() => setApplyConfirmOpen(true)}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Apply Update
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Update Confirmation Dialog */}
      <Dialog open={applyConfirmOpen} onOpenChange={setApplyConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart to Apply Update?</DialogTitle>
            <DialogDescription>
              The application will close and restart with version {updateDownload.stagedVersion || status?.webapp?.latest_version}.
              Make sure you have saved any unsaved work.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setApplyConfirmOpen(false);
                updateDownload.applyUpdate();
              }}
              disabled={updateDownload.isApplying}
            >
              {updateDownload.isApplying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="mr-2 h-4 w-4" />
              )}
              Restart Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* nirs4all Update Dialog */}
      <Dialog open={nirs4allDialogOpen} onOpenChange={setNirs4allDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {status?.nirs4all?.current_version ? "Update nirs4all" : "Install nirs4all"}
            </DialogTitle>
            <DialogDescription>
              {status?.nirs4all?.current_version
                ? `Update from ${status.nirs4all.current_version} to ${status.nirs4all.latest_version}`
                : `Install nirs4all ${status?.nirs4all?.latest_version} in the managed environment`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {status?.nirs4all?.release_notes && (
              <div className="max-h-48 overflow-y-auto p-3 bg-muted rounded-lg text-sm">
                <h4 className="font-medium mb-2">About this version</h4>
                <p className="text-muted-foreground line-clamp-6">
                  {status.nirs4all.release_notes.substring(0, 500)}...
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              This will install/upgrade nirs4all in the managed virtual environment.
              A backend restart may be required afterward.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNirs4allDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                installMutation.mutate(
                  { version: status?.nirs4all?.latest_version || undefined },
                  {
                    onSuccess: (data) => {
                      setNirs4allDialogOpen(false);
                      if (data?.requires_restart) {
                        setNeedsRestart(true);
                      }
                    },
                  }
                );
              }}
              disabled={installMutation.isPending}
            >
              {installMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {status?.nirs4all?.current_version ? "Update" : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
