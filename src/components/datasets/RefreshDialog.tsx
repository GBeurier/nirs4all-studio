/**
 * RefreshDialog - Phase 2: Versioning & Integrity
 *
 * Dialog to confirm refreshing a modified dataset.
 * Shows change summary and allows user to accept or cancel.
 */

import { useState } from "react";
import { RefreshCw, AlertTriangle, FileText, Plus, Minus, ArrowRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Dataset, DatasetChangeSummary } from "@/types/datasets";

interface RefreshDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataset: Dataset;
  changeSummary?: DatasetChangeSummary | null;
  onConfirm: () => Promise<void>;
  isLoading?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const sign = bytes < 0 ? "-" : "+";
  return `${sign}${parseFloat(Math.abs(bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function RefreshDialog({
  open,
  onOpenChange,
  dataset,
  changeSummary,
  onConfirm,
  isLoading = false,
}: RefreshDialogProps) {
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh dataset");
    }
  };

  const hasChanges = changeSummary && (
    (changeSummary.files_added?.length ?? 0) > 0 ||
    (changeSummary.files_removed?.length ?? 0) > 0 ||
    (changeSummary.files_changed?.length ?? 0) > 0 ||
    changeSummary.size_change_bytes !== 0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Dataset Modified
          </DialogTitle>
          <DialogDescription>
            The dataset "{dataset.name}" has changed since it was last verified.
            Review the changes and confirm to update the stored version.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hash comparison */}
          {changeSummary && (
            <div className="rounded-lg border p-3 bg-muted/50">
              <p className="text-xs font-medium text-muted-foreground mb-2">Hash Change</p>
              <div className="flex items-center gap-2 text-sm font-mono">
                <span className="text-muted-foreground">{changeSummary.old_hash || "none"}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground">{changeSummary.new_hash}</span>
              </div>
            </div>
          )}

          {/* Change summary */}
          {hasChanges && changeSummary && (
            <div className="space-y-3">
              {/* Size change */}
              {changeSummary.size_change_bytes !== 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Size change</span>
                  <Badge
                    variant={changeSummary.size_change_bytes > 0 ? "default" : "secondary"}
                  >
                    {formatBytes(changeSummary.size_change_bytes)}
                  </Badge>
                </div>
              )}

              {/* Files added */}
              {(changeSummary.files_added?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Plus className="h-4 w-4 text-green-500" />
                    <span className="text-muted-foreground">
                      {changeSummary.files_added!.length} file(s) added
                    </span>
                  </div>
                  <ScrollArea className="max-h-24">
                    <div className="pl-6 space-y-0.5">
                      {changeSummary.files_added!.map((file) => (
                        <p key={file} className="text-xs font-mono text-muted-foreground">
                          {file}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Files removed */}
              {(changeSummary.files_removed?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Minus className="h-4 w-4 text-red-500" />
                    <span className="text-muted-foreground">
                      {changeSummary.files_removed!.length} file(s) removed
                    </span>
                  </div>
                  <ScrollArea className="max-h-24">
                    <div className="pl-6 space-y-0.5">
                      {changeSummary.files_removed!.map((file) => (
                        <p key={file} className="text-xs font-mono text-muted-foreground">
                          {file}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

              {/* Files changed */}
              {(changeSummary.files_changed?.length ?? 0) > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">
                      {changeSummary.files_changed!.length} file(s) modified
                    </span>
                  </div>
                  <ScrollArea className="max-h-24">
                    <div className="pl-6 space-y-0.5">
                      {changeSummary.files_changed!.map((file) => (
                        <p key={file} className="text-xs font-mono text-muted-foreground">
                          {file}
                        </p>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}

          {!hasChanges && (
            <p className="text-sm text-muted-foreground">
              Content hash has changed but specific file changes could not be determined.
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Refreshing...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Accept Changes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
