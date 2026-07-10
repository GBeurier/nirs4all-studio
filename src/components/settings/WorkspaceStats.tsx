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
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import {
  getWorkspaceStats,
  cleanWorkspaceCache,
  getWorkspaceTransitionStatus,
  convertLegacyWorkspace,
} from "@/api/workspace";
import {
  getCleanCacheSuccessMessage,
  getWorkspaceActionFeedbackDescriptors,
  getWorkspaceCountCards,
  getWorkspaceSpaceUsageRows,
  getWorkspaceStorageSummaryCards,
  type WorkspaceActionFeedbackDescriptor,
  type WorkspaceActionState,
  type WorkspaceSpaceUsageRow,
} from "./WorkspaceStatsData";
import type {
  WorkspaceStatsResponse,
  CleanCacheRequest,
} from "@/types/settings";
import type { WorkspaceTransitionStatusResponse } from "@/types/storage";

/**
 * Get icon for a space usage category
 */
function getCategoryIcon(name: string) {
  switch (name) {
    case "results":
    case "Runs":
      return <FileBox className="h-4 w-4" />;
    case "models":
    case "Trained models":
      return <Database className="h-4 w-4" />;
    case "predictions":
    case "Exports":
      return <FolderOpen className="h-4 w-4" />;
    case "Prediction arrays":
      return <Database className="h-4 w-4" />;
    case "pipelines":
    case "Templates":
      return <Archive className="h-4 w-4" />;
    case "cache":
    case "temp":
    case "Cache":
    case "Temp":
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
    case "Runs":
      return "bg-blue-500";
    case "models":
    case "Trained models":
      return "bg-green-500";
    case "predictions":
    case "Exports":
      return "bg-purple-500";
    case "Prediction arrays":
      return "bg-cyan-500";
    case "pipelines":
    case "Templates":
      return "bg-orange-500";
    case "cache":
    case "temp":
    case "Cache":
    case "Temp":
      return "bg-gray-400";
    default:
      return "bg-slate-500";
  }
}

interface SpaceUsageBarProps {
  item: WorkspaceSpaceUsageRow;
}

function SpaceUsageBar({ item }: SpaceUsageBarProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {getCategoryIcon(item.name)}
          <span className="capitalize font-medium">{item.name}</span>
          <Badge variant="outline" className="text-xs">
            {item.fileCountLabel}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{item.sizeLabel}</span>
          <span className="w-12 text-right">{item.percentageLabel}</span>
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

function getActionFeedbackClassName(
  feedback: WorkspaceActionFeedbackDescriptor,
): string {
  return feedback.tone === "success"
    ? "flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
    : "flex items-center gap-2 text-sm text-destructive";
}

function getActionFeedbackIcon(feedback: WorkspaceActionFeedbackDescriptor) {
  return feedback.icon === "check" ? (
    <CheckCircle2 className="h-4 w-4" />
  ) : (
    <AlertCircle className="h-4 w-4" />
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
  const [transitionStatus, setTransitionStatus] =
    useState<WorkspaceTransitionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<WorkspaceActionState | null>(
    null,
  );

  const loadStats = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const [data, transition] = await Promise.all([
        getWorkspaceStats(),
        getWorkspaceTransitionStatus().catch(() => null),
      ]);
      setStats(data);
      setTransitionStatus(transition);
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
        message: getCleanCacheSuccessMessage(result),
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

  const handleLegacyConversion = async () => {
    try {
      setIsActionLoading(true);
      const result = await convertLegacyWorkspace({
        output_path: transitionStatus?.default_output_path ?? undefined,
        verify: true,
        link_converted_workspace: true,
      });
      setLastAction({
        type: "conversion",
        message: result.job_id
          ? `Legacy workspace conversion started (${result.job_id})`
          : result.link_error
            ? `Legacy workspace conversion completed at ${result.output_path}; link the converted workspace manually (${result.link_error})`
            : `Legacy workspace conversion completed at ${result.output_path}`,
      });
      await loadStats();
      onStatsChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start legacy conversion");
    } finally {
      setIsActionLoading(false);
    }
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

  const countCards = getWorkspaceCountCards(stats);
  const storageSummaryCards = getWorkspaceStorageSummaryCards(stats);
  const spaceUsageRows = getWorkspaceSpaceUsageRows(stats.space_usage);
  const actionFeedbackDescriptors = getWorkspaceActionFeedbackDescriptors({
    lastAction,
    error,
  });

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
        {transitionStatus?.conversion_required && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="font-medium">Legacy workspace conversion required</div>
                <p>{transitionStatus.message}</p>
                {transitionStatus.conversion_command && (
                  <code className="block overflow-x-auto rounded bg-background/70 px-2 py-1 text-xs">
                    {transitionStatus.conversion_command}
                  </code>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleLegacyConversion}
                    disabled={isActionLoading || !transitionStatus.converter_available}
                  >
                    {isActionLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Database className="mr-2 h-4 w-4" />
                    )}
                    Convert to V1 Workspace
                  </Button>
                  {!transitionStatus.converter_available && (
                    <span className="self-center text-xs">
                      Install nirs4all-tools in the Studio Python environment to convert from the UI.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Workspace-scoped counts (read from the active store via the
            scanner — these are what nirs4all itself sees in this workspace). */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {countCards.map((card) => (
            <div key={card.key} className="space-y-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className={card.valueClassName}>{card.value}</p>
            </div>
          ))}
        </div>

        <Separator />

        {/* Storage summary */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {storageSummaryCards.map((card) => (
            <div key={card.key} className="space-y-1">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className={card.valueClassName}>
                {card.value}
                {card.detail && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {card.detail}
                  </span>
                )}
              </p>
            </div>
          ))}
        </div>

        <Separator />

        {/* Space Usage Breakdown */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Space Usage</h4>
          {spaceUsageRows.length > 0 ? (
            <div className="space-y-4">
              {spaceUsageRows.map((item) => (
                <SpaceUsageBar key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No data stored yet
            </p>
          )}
        </div>

        {/* Action Feedback */}
        {actionFeedbackDescriptors.map((feedback) => (
          <div
            key={feedback.key}
            className={getActionFeedbackClassName(feedback)}
          >
            {getActionFeedbackIcon(feedback)}
            <span>{feedback.message}</span>
          </div>
        ))}

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
