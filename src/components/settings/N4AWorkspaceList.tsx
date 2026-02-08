/**
 * N4AWorkspaceList Component
 * Shows linked nirs4all workspaces with activate/scan/unlink actions.
 * Phase 7 Implementation
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Clock,
  Play,
  FileBox,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Zap,
  Database,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getLinkedWorkspaces,
  unlinkN4AWorkspace,
  activateN4AWorkspace,
  scanN4AWorkspace,
} from "@/api/client";
import { formatRelativeTime } from "@/utils/formatters";
import type { LinkedWorkspace } from "@/types/linked-workspaces";

interface WorkspaceItemProps {
  workspace: LinkedWorkspace;
  onActivate: (id: string) => Promise<void>;
  onScan: (id: string) => Promise<void>;
  onUnlink: (id: string) => Promise<void>;
  isLoading: boolean;
}

function WorkspaceItem({
  workspace,
  onActivate,
  onScan,
  onUnlink,
  isLoading,
}: WorkspaceItemProps) {
  const [isScanning, setIsScanning] = useState(false);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await onScan(workspace.id);
    } finally {
      setIsScanning(false);
    }
  };

  const discovered = workspace.discovered;

  return (
    <div
      className={
        workspace.is_active
          ? "p-4 rounded-lg border transition-colors bg-primary/5 border-primary/30"
          : "p-4 rounded-lg border transition-colors bg-card hover:bg-muted/50"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium truncate">{workspace.name}</span>
            {workspace.is_active && (
              <Badge variant="default" className="text-xs">Active</Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-1 truncate">
            {workspace.path}
          </p>

          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
            {workspace.last_scanned && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>Scanned {formatRelativeTime(workspace.last_scanned)}</span>
              </div>
            )}
            <div className="flex items-center gap-1">
              <Play className="h-3 w-3" />
              <span>{discovered.runs_count} runs</span>
            </div>
            <div className="flex items-center gap-1">
              <FileBox className="h-3 w-3" />
              <span>{discovered.exports_count} exports</span>
            </div>
            <div className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              <span>{discovered.datasets_count} datasets</span>
            </div>
            <div className="flex items-center gap-1">
              <FileCode className="h-3 w-3" />
              <span>{discovered.templates_count} templates</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!workspace.is_active && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onActivate(workspace.id)}
                    disabled={isLoading}
                  >
                    <Zap className="h-4 w-4 mr-1" />
                    Activate
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Set as active workspace</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleScan}
                  disabled={isLoading || isScanning}
                >
                  {isScanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rescan workspace</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <AlertDialog>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={isLoading}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Unlink workspace</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Unlink workspace?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the workspace from your linked list.
                  The actual files will not be deleted.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onUnlink(workspace.id)}>
                  Unlink
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

export interface N4AWorkspaceListProps {
  onWorkspaceChange?: () => void;
  className?: string;
}

export function N4AWorkspaceList({
  onWorkspaceChange,
  className = "",
}: N4AWorkspaceListProps) {
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const {
    data: workspacesData,
    isLoading,
    refetch: loadWorkspaces,
  } = useQuery({
    queryKey: ["linked-workspaces"],
    queryFn: getLinkedWorkspaces,
    staleTime: 10000,
  });

  const workspaces = workspacesData?.workspaces ?? [];

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleActivate = async (id: string) => {
    try {
      setError(null);
      await activateN4AWorkspace(id);
      setSuccessMessage("Workspace activated");
      // Invalidate cross-page queries so Runs, Results, Predictions pick up the change
      queryClient.invalidateQueries({ queryKey: ["linked-workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onWorkspaceChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate");
    }
  };

  const handleScan = async (id: string) => {
    try {
      setError(null);
      const result = await scanN4AWorkspace(id);
      const d = result.discovered;
      setSuccessMessage("Scanned: " + d.runs_count + " runs, " + d.exports_count + " exports");
      queryClient.invalidateQueries({ queryKey: ["linked-workspaces"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan");
    }
  };

  const handleUnlink = async (id: string) => {
    try {
      setError(null);
      await unlinkN4AWorkspace(id);
      setSuccessMessage("Workspace unlinked");
      // Invalidate cross-page queries
      queryClient.invalidateQueries({ queryKey: ["linked-workspaces"] });
      queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onWorkspaceChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unlink");
    }
  };

  if (isLoading) {
    return (
      <div className={"flex items-center justify-center p-6 " + className}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && workspaces.length === 0) {
    return (
      <div className={"flex items-center gap-2 p-4 text-destructive " + className}>
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={loadWorkspaces}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={"text-sm text-muted-foreground p-4 text-center " + className}>
        No nirs4all workspaces linked yet. Use the button above to link one.
      </div>
    );
  }

  return (
    <div className={"space-y-3 " + className}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""} linked
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={loadWorkspaces}
                disabled={isLoading}
              >
                <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh list</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {successMessage && (
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 p-2 bg-green-50 dark:bg-green-950/20 rounded">
          <CheckCircle2 className="h-4 w-4" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive p-2 bg-destructive/10 rounded">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {workspaces.map((workspace) => (
          <WorkspaceItem
            key={workspace.id}
            workspace={workspace}
            onActivate={handleActivate}
            onScan={handleScan}
            onUnlink={handleUnlink}
            isLoading={isLoading}
          />
        ))}
      </div>
    </div>
  );
}

export default N4AWorkspaceList;
