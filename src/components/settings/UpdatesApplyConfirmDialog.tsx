import { Loader2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { useUpdateDownload } from "@/hooks/useUpdates";

type UpdateDownloadState = ReturnType<typeof useUpdateDownload>;

interface UpdatesApplyConfirmDialogProps {
  latestVersion?: string | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  updateDownload: UpdateDownloadState;
}

export function UpdatesApplyConfirmDialog({
  latestVersion,
  onOpenChange,
  open,
  updateDownload,
}: UpdatesApplyConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("settings.updates.applyConfirm.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.updates.applyConfirm.description", { version: updateDownload.stagedVersion || latestVersion })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              updateDownload.applyUpdate();
            }}
            disabled={updateDownload.isApplying}
          >
            {updateDownload.isApplying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            {t("settings.updates.applyConfirm.restartNow")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
