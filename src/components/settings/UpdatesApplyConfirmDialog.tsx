import { Loader2, RotateCcw } from "lucide-react";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restart to Apply Update?</DialogTitle>
          <DialogDescription>
            The application will close and restart with version {updateDownload.stagedVersion || latestVersion}.
            Make sure you have saved any unsaved work.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
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
            Restart Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
