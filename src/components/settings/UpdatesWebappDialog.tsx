import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";

import type { ChangelogEntry, UpdateStatus } from "@/api/updates";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { formatBytes, type useUpdateDownload } from "@/hooks/useUpdates";
import type { WebappDialogCopy } from "./UpdatesSectionLogic";

type UpdateDownloadState = ReturnType<typeof useUpdateDownload>;

interface UpdatesWebappDialogProps {
  canApplyInPlace: boolean;
  changelogEntries?: ChangelogEntry[];
  copy: WebappDialogCopy;
  installerUrl: string | null;
  isChangelogLoading: boolean;
  onApplyClick: () => void;
  onClose: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatus | null | undefined;
  updateDownload: UpdateDownloadState;
}

export function UpdatesWebappDialog({
  canApplyInPlace,
  changelogEntries,
  copy,
  installerUrl,
  isChangelogLoading,
  onApplyClick,
  onClose,
  onOpenChange,
  open,
  status,
  updateDownload,
}: UpdatesWebappDialogProps) {
  const showIdleContent = !updateDownload.isDownloading && !updateDownload.readyToApply;
  const isCancelling =
    updateDownload.isCancellingDownload || updateDownload.isCancellingStagedUpdate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {copy.title}
            {status?.webapp?.is_prerelease && (
              <Badge variant="outline" className="text-xs">
                Pre-release
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {updateDownload.isDownloading && (
            <div className="space-y-2">
              <Progress value={updateDownload.downloadProgress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{updateDownload.downloadMessage}</span>
                <span>{Math.round(updateDownload.downloadProgress)}%</span>
              </div>
            </div>
          )}

          {updateDownload.downloadError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{updateDownload.downloadError}</AlertDescription>
            </Alert>
          )}

          {updateDownload.readyToApply && !updateDownload.isApplying && (
            <Alert>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertDescription>
                Download complete. Click "Apply Update" to install. The application will restart automatically.
              </AlertDescription>
            </Alert>
          )}

          {updateDownload.isApplying && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Applying update... The application will restart shortly.
              </AlertDescription>
            </Alert>
          )}

          {updateDownload.applySuccess && (
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                Update applied! Restarting the application...
              </AlertDescription>
            </Alert>
          )}

          {updateDownload.applyError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Failed to apply update: {updateDownload.applyError}
              </AlertDescription>
            </Alert>
          )}

          {showIdleContent && (
            <div className="max-h-48 overflow-y-auto p-3 bg-muted rounded-lg text-sm">
              <h4 className="font-medium mb-2">What's New</h4>
              {isChangelogLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading changelog...
                </div>
              ) : changelogEntries && changelogEntries.length > 0 ? (
                <div className="space-y-3">
                  {changelogEntries.map((entry) => (
                    <div key={entry.version}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-primary">v{entry.version}</span>
                        {entry.prerelease && (
                          <Badge variant="outline" className="text-xs py-0">
                            pre
                          </Badge>
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

          {showIdleContent && status?.webapp?.download_size_bytes && (
            <p className="text-sm text-muted-foreground">
              Download size: {formatBytes(status.webapp.download_size_bytes)}
            </p>
          )}

          {showIdleContent && !updateDownload.downloadError && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {canApplyInPlace
                  ? "Webapp updates will be downloaded and extracted. The application will restart to apply the update."
                  : "This installation uses a native installer. Download it, close Studio, then run the installer."}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
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
                  onClose();
                }
              }}
              disabled={isCancelling}
            >
              {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

          {!updateDownload.readyToApply &&
            !updateDownload.isDownloading &&
            !updateDownload.applySuccess && (
              <>
                {installerUrl && (
                  <Button variant="outline" asChild>
                    <a href={installerUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {canApplyInPlace ? "Manual Download" : "Download Installer"}
                    </a>
                  </Button>
                )}

                {canApplyInPlace && (
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
                )}
              </>
            )}

          {canApplyInPlace &&
            updateDownload.readyToApply &&
            !updateDownload.isApplying &&
            !updateDownload.applySuccess && (
              <Button onClick={onApplyClick}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Apply Update
              </Button>
            )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
