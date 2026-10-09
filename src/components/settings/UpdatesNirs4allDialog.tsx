import { Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { UpdateStatus } from "@/api/updates";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UpdatesNirs4allDialogProps {
  isInstalling: boolean;
  onInstall: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  status: UpdateStatus | null | undefined;
}

export function UpdatesNirs4allDialog({
  isInstalling,
  onInstall,
  onOpenChange,
  open,
  status,
}: UpdatesNirs4allDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {status?.nirs4all?.current_version ? t("settings.updates.nirs4allDialog.titleUpdate") : t("settings.updates.nirs4allDialog.titleInstall")}
          </DialogTitle>
          <DialogDescription>
            {status?.nirs4all?.current_version
              ? t("settings.updates.nirs4allDialog.descUpdate", { from: status.nirs4all.current_version, to: status.nirs4all.latest_version })
              : t("settings.updates.nirs4allDialog.descInstall", { version: status?.nirs4all?.latest_version })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {status?.nirs4all?.release_notes && (
            <div className="max-h-48 overflow-y-auto p-3 bg-muted rounded-lg text-sm">
              <h4 className="font-medium mb-2">{t("settings.updates.nirs4allDialog.aboutVersion")}</h4>
              <p className="text-muted-foreground line-clamp-6">
                {status.nirs4all.release_notes.substring(0, 500)}...
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {t("settings.updates.nirs4allDialog.note")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onInstall} disabled={isInstalling}>
            {isInstalling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {status?.nirs4all?.current_version ? t("settings.updates.update") : t("settings.updates.install")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
