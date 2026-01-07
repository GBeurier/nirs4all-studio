/**
 * RecentWorkspacesList Component
 *
 * Displays a list of recently accessed workspaces with options to
 * switch to or remove workspaces from the list.
 *
 * Phase 3 Implementation
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  FolderOpen,
  Clock,
  Database,
  FileBox,
  Trash2,
  ExternalLink,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
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
  getRecentWorkspaces,
  removeWorkspaceFromList,
  selectWorkspace,
} from "@/api/client";
import { formatRelativeTime } from "@/utils/formatters";
import type { WorkspaceInfo } from "@/types/settings";

interface WorkspaceItemProps {
  workspace: WorkspaceInfo;
  isCurrentWorkspace: boolean;
  onSwitch: (path: string) => Promise<void>;
  onRemove: (path: string) => Promise<void>;
  isSwitching: boolean;
}

function WorkspaceItem({
  workspace,
  isCurrentWorkspace,
  onSwitch,
  onRemove,
  isSwitching,
}: WorkspaceItemProps) {
  const { t } = useTranslation();
  const [isRemoving, setIsRemoving] = useState(false);

  const handleRemove = async () => {
    setIsRemoving(true);
    try {
      await onRemove(workspace.path);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div
      className={`
        p-4 rounded-lg border transition-colors
        ${isCurrentWorkspace
          ? "bg-primary/5 border-primary/30"
          : "bg-card hover:bg-muted/50"
        }
      `}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Name and badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <FolderOpen className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="font-medium truncate">{workspace.name}</span>
            {isCurrentWorkspace && (
              <Badge variant="default" className="text-xs">
                {t("settings.workspace.recent.current")}
              </Badge>
            )}
          </div>

          {/* Path */}
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {workspace.path}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>{formatRelativeTime(workspace.last_accessed)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Database className="h-3 w-3" />
              <span>{t("settings.workspace.recent.datasets", { count: workspace.num_datasets })}</span>
            </div>
            <div className="flex items-center gap-1">
              <FileBox className="h-3 w-3" />
              <span>{t("settings.workspace.recent.pipelines", { count: workspace.num_pipelines })}</span>
            </div>
          </div>

          {/* Description if available */}
          {workspace.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-1">
              {workspace.description}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isCurrentWorkspace && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSwitch(workspace.path)}
                    disabled={isSwitching || isRemoving}
                  >
                    {isSwitching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    <span className="ml-1">{t("settings.workspace.recent.open")}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("settings.workspace.recent.openHint")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <AlertDialog>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      disabled={isRemoving || isSwitching}
                    >
                      {isRemoving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("settings.workspace.recent.remove")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("settings.workspace.recent.removeConfirm")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("settings.workspace.recent.removeDescription", { name: workspace.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleRemove}>
                  {t("common.remove")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

export interface RecentWorkspacesListProps {
  /** Current workspace path for highlighting */
  currentWorkspacePath?: string | null;
  /** Maximum number of workspaces to show */
  limit?: number;
  /** Callback when workspace is switched */
  onWorkspaceSwitch?: (path: string) => void;
  /** Optional class name */
  className?: string;
}

export function RecentWorkspacesList({
  currentWorkspacePath,
  limit = 10,
  onWorkspaceSwitch,
  className,
}: RecentWorkspacesListProps) {
  const { t } = useTranslation();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadWorkspaces = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await getRecentWorkspaces(limit);
      setWorkspaces(response.workspaces);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load recent workspaces"
      );
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleSwitch = async (path: string) => {
    try {
      setIsSwitching(true);
      setError(null);
      await selectWorkspace(path);
      setSuccessMessage(t("settings.workspace.recent.switchSuccess"));
      onWorkspaceSwitch?.(path);
      // Reload list to update order
      await loadWorkspaces();
      // Reload the page to reflect the new workspace
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to switch workspace"
      );
    } finally {
      setIsSwitching(false);
    }
  };

  const handleRemove = async (path: string) => {
    try {
      setError(null);
      await removeWorkspaceFromList(path);
      setSuccessMessage(t("settings.workspace.recent.removeSuccess"));
      // Update local state
      setWorkspaces((prev) => prev.filter((ws) => ws.path !== path));
      // Clear success message after a delay
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("settings.workspace.recent.removeError")
      );
    }
  };

  // Clear success message after a delay
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-6 ${className}`}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && workspaces.length === 0) {
    return (
      <div className={`flex items-center gap-2 p-4 text-destructive ${className}`}>
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
        <Button variant="ghost" size="sm" onClick={loadWorkspaces}>
          <RefreshCw className="h-4 w-4 mr-1" />
          {t("common.refresh")}
        </Button>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={`text-sm text-muted-foreground p-4 ${className}`}>
        {t("settings.workspace.recent.emptyHint")}
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">
          {t("settings.workspace.recent.count", { count: workspaces.length })}
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
                <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.refresh")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Feedback messages */}
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

      {/* Workspace list */}
      <div className="space-y-2">
        {workspaces.map((workspace) => (
          <WorkspaceItem
            key={workspace.path}
            workspace={workspace}
            isCurrentWorkspace={currentWorkspacePath === workspace.path}
            onSwitch={handleSwitch}
            onRemove={handleRemove}
            isSwitching={isSwitching}
          />
        ))}
      </div>
    </div>
  );
}

export default RecentWorkspacesList;
