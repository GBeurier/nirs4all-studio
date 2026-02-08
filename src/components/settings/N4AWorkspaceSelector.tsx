/**
 * N4AWorkspaceSelector Component
 * Browse and link nirs4all workspaces.
 * Phase 7 Implementation
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { selectFolder } from "@/utils/fileDialogs";
import { linkN4AWorkspace } from "@/api/client";

export interface N4AWorkspaceSelectorProps {
  onWorkspaceLinked?: () => void;
  trigger?: React.ReactNode;
}

export function N4AWorkspaceSelector({
  onWorkspaceLinked,
  trigger,
}: N4AWorkspaceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [isLinking, setIsLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const queryClient = useQueryClient();

  const handleBrowse = async () => {
    const selectedPath = await selectFolder();
    if (selectedPath) {
      setPath(selectedPath);
      // Auto-fill name from folder name if not set
      if (!name) {
        const parts = selectedPath.split(/[/\\]/);
        setName(parts[parts.length - 1] || "");
      }
    }
  };

  const handleLink = async () => {
    if (!path) {
      setError("Please select a workspace path");
      return;
    }

    try {
      setIsLinking(true);
      setError(null);
      await linkN4AWorkspace({ path, name: name || undefined });
      setSuccess(true);
      // Invalidate cross-page queries
      queryClient.invalidateQueries({ queryKey: ["linked-workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setTimeout(() => {
        setIsOpen(false);
        setPath("");
        setName("");
        setSuccess(false);
        onWorkspaceLinked?.();
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to link workspace";
      // Extract detail from API error
      if (typeof err === "object" && err !== null && "detail" in err) {
        setError(String((err as { detail: string }).detail));
      } else {
        setError(message);
      }
    } finally {
      setIsLinking(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setPath("");
      setName("");
      setError(null);
      setSuccess(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <FolderPlus className="mr-2 h-4 w-4" />
            Link Workspace
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link nirs4all Workspace</DialogTitle>
          <DialogDescription>
            Select a nirs4all workspace folder to discover runs, exports, and predictions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="ws-path">Workspace Path</Label>
            <div className="flex gap-2">
              <Input
                id="ws-path"
                placeholder="/path/to/nirs4all/workspace"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1"
              />
              <Button variant="outline" onClick={handleBrowse}>
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Select a nirs4all workspace folder
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ws-name">Display Name (optional)</Label>
            <Input
              id="ws-name"
              placeholder="My Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive p-2 bg-destructive/10 rounded">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-2 bg-green-50 dark:bg-green-950/20 rounded">
              <CheckCircle2 className="h-4 w-4" />
              <span>Workspace linked successfully!</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={isLinking || !path || success}>
            {isLinking ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Linking...
              </>
            ) : (
              <>
                <FolderPlus className="mr-2 h-4 w-4" />
                Link Workspace
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default N4AWorkspaceSelector;
