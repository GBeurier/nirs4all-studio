import { AlertCircle, ExternalLink, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import { formatBytes } from "@/hooks/useUpdates";
import { getActiveLocale } from "@/lib/activeLocale";

interface UpdatesWebappDialogProps {
  changelogEntries?: ChangelogEntry[];
  installerUrl: string | null;
  isChangelogLoading: boolean;
  onOpenInstaller: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: UpdateStatus | null | undefined;
}

export function UpdatesWebappDialog({
  changelogEntries,
  installerUrl,
  isChangelogLoading,
  onOpenInstaller,
  onOpenChange,
  open,
  status,
}: UpdatesWebappDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("settings.updates.webappDialog.availableTitle")}
            {status?.webapp?.is_prerelease && (
              <Badge variant="outline" className="text-xs">
                {t("settings.updates.webappDialog.preRelease")}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {t("settings.updates.webappDialog.availableDescription", { version: status?.webapp?.latest_version })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-h-48 overflow-y-auto p-3 bg-muted rounded-lg text-sm">
            <h4 className="font-medium mb-2">{t("settings.updates.webappDialog.whatsNew")}</h4>
            {isChangelogLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("settings.updates.webappDialog.loadingChangelog")}
              </div>
            ) : changelogEntries && changelogEntries.length > 0 ? (
              <div className="space-y-3">
                {changelogEntries.map((entry) => (
                  <div key={entry.version}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-primary">v{entry.version}</span>
                      {entry.prerelease && (
                        <Badge variant="outline" className="text-xs py-0">
                          {t("settings.updates.webappDialog.preTag")}
                        </Badge>
                      )}
                      {entry.date && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString(getActiveLocale())}
                        </span>
                      )}
                    </div>
                    <div className="prose prose-sm dark:prose-invert whitespace-pre-wrap text-muted-foreground">
                      {entry.body || t("settings.updates.webappDialog.noNotes")}
                    </div>
                  </div>
                ))}
              </div>
            ) : status?.webapp?.release_notes ? (
              <div className="prose prose-sm dark:prose-invert whitespace-pre-wrap">
                {status.webapp.release_notes}
              </div>
            ) : (
              <p className="text-muted-foreground italic">{t("settings.updates.webappDialog.noNotesAvailable")}</p>
            )}
          </div>

          {status?.webapp?.download_size_bytes && (
            <p className="text-sm text-muted-foreground">
              {t("settings.updates.webappDialog.downloadSize", { size: formatBytes(status.webapp.download_size_bytes) })}
            </p>
          )}

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{t("settings.updates.webappDialog.installerNote")}</AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.updates.webappDialog.later")}
          </Button>
          <Button onClick={onOpenInstaller} disabled={!installerUrl}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t("settings.updates.webappDialog.downloadInstaller")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
