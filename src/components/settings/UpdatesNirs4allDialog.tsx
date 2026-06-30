import { Download, Loader2 } from "lucide-react";

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {status?.nirs4all?.current_version ? "Update nirs4all" : "Install nirs4all"}
          </DialogTitle>
          <DialogDescription>
            {status?.nirs4all?.current_version
              ? `Update from ${status.nirs4all.current_version} to ${status.nirs4all.latest_version}`
              : `Install nirs4all ${status?.nirs4all?.latest_version} in the current runtime`}
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
            This will install or upgrade nirs4all in the current Python runtime.
            A backend restart may be required afterward.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onInstall} disabled={isInstalling}>
            {isInstalling ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {status?.nirs4all?.current_version ? "Update" : "Install"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
