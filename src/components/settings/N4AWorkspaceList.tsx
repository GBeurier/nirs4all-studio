/**
 * N4AWorkspaceList Component
 * Shows linked nirs4all workspaces with activate/scan/unlink actions.
 * Phase 7 Implementation
 */

import { useState, useEffect } from "react";
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
import type { LucideIcon } from "lucide-react";
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
  unlinkN4AWorkspace,
  activateN4AWorkspace,
  scanN4AWorkspace,
} from "@/api/linkedWorkspaces";
import type { LinkedWorkspace } from "@/types/linked-workspaces";
import {
  useInvalidateDatasets,
  useLinkedWorkspacesQuery,
} from "@/hooks/useDatasetQueries";
import {
  WORKSPACE_ACTION_COPY,
  getLastScannedLabel,
  getLinkedWorkspaceCountLabel,
  getScanSuccessMessage,
  getWorkspaceDiscoveredCountItems,
  getWorkspaceItemState,
  type DiscoveredCountKey,
} from "./N4AWorkspaceListData";

const discoveredCountIcons: Record<DiscoveredCountKey, LucideIcon> = {
  runs: Play,
  exports: FileBox,
  datasets: Database,
  templates: FileCode,
};

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

  const itemState = getWorkspaceItemState(workspace);
  const lastScannedLabel = getLastScannedLabel(workspace.last_scanned);
  const discoveredCounts = getWorkspaceDiscoveredCountItems(workspace.discovered);

  return (
    <div className={itemState.containerClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium truncate">{workspace.name}</span>
            {itemState.activeBadge && (
              <Badge
                variant={itemState.activeBadge.variant}
                className={itemState.activeBadge.className}
              >
                {itemState.activeBadge.label}
              </Badge>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-1 truncate">
            {workspace.path}
          </p>

          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
            {lastScannedLabel && (
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>{lastScannedLabel}</span>
              </div>
            )}
            {discoveredCounts.map((item) => {
              const CountIcon = discoveredCountIcons[item.key];

              return (
                <div key={item.key} className="flex items-center gap-1">
                  <CountIcon className="h-3 w-3" />
                  <span>{item.label}</span>
                </div>
              );
            })}
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
                    {WORKSPACE_ACTION_COPY.activate.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{WORKSPACE_ACTION_COPY.activate.tooltip}</TooltipContent>
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
                  aria-label={WORKSPACE_ACTION_COPY.scan.tooltip}
                >
                  {isScanning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{WORKSPACE_ACTION_COPY.scan.tooltip}</TooltipContent>
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
                      aria-label={WORKSPACE_ACTION_COPY.unlink.tooltip}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>{WORKSPACE_ACTION_COPY.unlink.tooltip}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{WORKSPACE_ACTION_COPY.unlink.dialogTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {WORKSPACE_ACTION_COPY.unlink.dialogDescription}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{WORKSPACE_ACTION_COPY.unlink.cancelLabel}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onUnlink(workspace.id)}>
                  {WORKSPACE_ACTION_COPY.unlink.confirmLabel}
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
  const invalidateDatasets = useInvalidateDatasets();

  const {
    data: workspacesData,
    isLoading,
    refetch: loadWorkspaces,
  } = useLinkedWorkspacesQuery();

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
      await invalidateDatasets();
      onWorkspaceChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate");
    }
  };

  const handleScan = async (id: string) => {
    try {
      setError(null);
      const result = await scanN4AWorkspace(id);
      setSuccessMessage(getScanSuccessMessage(result.discovered));
      await invalidateDatasets();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan");
    }
  };

  const handleUnlink = async (id: string) => {
    try {
      setError(null);
      await unlinkN4AWorkspace(id);
      setSuccessMessage("Workspace unlinked");
      await invalidateDatasets();
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
        <Button variant="ghost" size="sm" onClick={() => void loadWorkspaces()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          {WORKSPACE_ACTION_COPY.retry.label}
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
          {getLinkedWorkspaceCountLabel(workspaces.length)}
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => void loadWorkspaces()}
                disabled={isLoading}
                aria-label={WORKSPACE_ACTION_COPY.refresh.tooltip}
              >
                <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{WORKSPACE_ACTION_COPY.refresh.tooltip}</TooltipContent>
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
