/**
 * WorkspaceStats Component
 *
 * Displays workspace statistics including space usage breakdown with
 * progress bars and actions for cache cleaning and backup.
 *
 * Phase 5 Implementation
 */

import { useState, useEffect, useCallback } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  HardDrive,
  Trash2,
  Archive,
  RefreshCw,
  Database,
  FolderOpen,
  FileBox,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  getWorkspaceStats,
  cleanWorkspaceCache,

} from "@/api/client";
import { formatBytes } from "@/utils/formatters";
import type {
  WorkspaceStatsResponse,
  SpaceUsageItem,
  CleanCacheRequest,
} from "@/types/settings";

/**
 * Get icon for a space usage category
 */
function getCategoryIcon(name: string) {
  switch (name) {
    case "results":
      return <FileBox className="h-4 w-4" />;
    case "models":
      return <Database className="h-4 w-4" />;
    case "predictions":
      return <FolderOpen className="h-4 w-4" />;
    case "pipelines":
      return <Archive className="h-4 w-4" />;
    case "cache":
    case "temp":
      return <Trash2 className="h-4 w-4 text-muted-foreground" />;
    default:
      return <HardDrive className="h-4 w-4" />;
  }
}

/**
 * Get color class for a space usage category
 */
function getCategoryColor(name: string): string {
  switch (name) {
    case "results":
      return "bg-blue-500";
    case "models":
      return "bg-green-500";
    case "predictions":
      return "bg-purple-500";
    case "pipelines":
      return "bg-orange-500";
    case "cache":
    case "temp":
      return "bg-gray-400";
    default:
      return "bg-slate-500";
  }
}

interface SpaceUsageBarProps {
  item: SpaceUsageItem;
}

function SpaceUsageBar({ item }: SpaceUsageBarProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {getCategoryIcon(item.name)}
          <span className="capitalize font-medium">{item.name}</span>
          <Badge variant="outline" className="text-xs">
            {item.file_count} files
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{formatBytes(item.size_bytes)}</span>
          <span className="w-12 text-right">{item.percentage}%</span>
        </div>
      </div>
      <Progress
        value={item.percentage}
        className={`h-2 [&>div]:${getCategoryColor(item.name)}`}
      />
    </div>
  );
}

interface CleanCacheDialogProps {
  onClean: (options: Partial<CleanCacheRequest>) => Promise<void>;
  isLoading: boolean;
}

function CleanCacheDialog({ onClean, isLoading }: CleanCacheDialogProps) {
  const [cleanTemp, setCleanTemp] = useState(true);
  const [cleanOrphan, setCleanOrphan] = useState(false);
  const [cleanOldPredictions, setCleanOldPredictions] = useState(false);

  const handleClean = async () => {
    await onClean({
      clean_temp: cleanTemp,
      clean_orphan_results: cleanOrphan,
      clean_old_predictions: cleanOldPredictions,
      days_threshold: 30,
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={isLoading}>
          <Trash2 className="mr-2 h-4 w-4" />
          Clean Cache
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clean Workspace Cache</AlertDialogTitle>
          <AlertDialogDescription>
            Select what you want to clean. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-4 py-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="clean-temp"
              checked={cleanTemp}
              onCheckedChange={(checked) => setCleanTemp(checked === true)}
            />
            <Label htmlFor="clean-temp" className="text-sm">
              <span className="font-medium">Temporary files</span>
              <span className="text-muted-foreground ml-2">
                (.tmp and .cache directories)
              </span>
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="clean-orphan"
              checked={cleanOrphan}
              onCheckedChange={(checked) => setCleanOrphan(checked === true)}
            />
            <Label htmlFor="clean-orphan" className="text-sm">
              <span className="font-medium">Orphan results</span>
              <span className="text-muted-foreground ml-2">
                (results without associated runs)
              </span>
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="clean-old"
              checked={cleanOldPredictions}
              onCheckedChange={(checked) => setCleanOldPredictions(checked === true)}
            />
            <Label htmlFor="clean-old" className="text-sm">
              <span className="font-medium">Old predictions</span>
              <span className="text-muted-foreground ml-2">
                (older than 30 days)
              </span>
            </Label>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleClean} disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cleaning...
              </>
            ) : (
              "Clean Selected"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface WorkspaceStatsProps {
  /** Optional class name */
  className?: string;
  /** Callback when stats change (after clean/backup) */
  onStatsChange?: () => void;
}

export function WorkspaceStats({ className, onStatsChange }: WorkspaceStatsProps) {
  const [stats, setStats] = useState<WorkspaceStatsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{
    type: "clean" | "backup";
    message: string;
  } | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getWorkspaceStats();
      setStats(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load workspace statistics"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleCleanCache = async (options: Partial<CleanCacheRequest>) => {
    try {
      setIsActionLoading(true);
      const result = await cleanWorkspaceCache(options);
      setLastAction({
        type: "clean",
        message: `Cleaned ${result.files_removed} files, freed ${formatBytes(result.bytes_freed)}`,
      });
      await loadStats();
      onStatsChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clean cache");
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleBackup = async () => {
    // TODO: Implement backup functionality when backend API is available
    setLastAction({
      type: "backup",
      message: "Backup feature coming soon",
    });
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardContent className="p-6 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error && !stats) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return null;
  }

  // Filter out empty categories for cleaner display
  const nonEmptyUsage = stats.space_usage.filter((item) => item.size_bytes > 0);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Workspace Statistics
            </CardTitle>
            <CardDescription>
              {stats.path}
            </CardDescription>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={loadStats}
                  disabled={isLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh statistics</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Total Size</p>
            <p className="text-2xl font-bold">
              {formatBytes(stats.total_size_bytes)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Linked Datasets</p>
            <p className="text-2xl font-bold">
              {stats.linked_datasets_count}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({formatBytes(stats.linked_datasets_external_size)} external)
              </span>
            </p>
          </div>
        </div>

        <Separator />

        {/* Space Usage Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Space Usage</h4>
          {nonEmptyUsage.length > 0 ? (
            <div className="space-y-4">
              {nonEmptyUsage.map((item) => (
                <SpaceUsageBar key={item.name} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No data stored yet
            </p>
          )}
        </div>



        {/* Action Feedback */}
        {lastAction && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <span>{lastAction.message}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <CleanCacheDialog
            onClean={handleCleanCache}
            isLoading={isActionLoading}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleBackup}
            disabled={isActionLoading}
          >
            {isActionLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Archive className="mr-2 h-4 w-4" />
            )}
            Backup Now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default WorkspaceStats;
