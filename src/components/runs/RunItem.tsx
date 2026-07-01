import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronDown, ChevronRight, Database, Layers, Box,
  Eye, HardDrive, Timer, RefreshCw,
  Target, FolderKanban, Loader2, Trash2,
} from "lucide-react";
import {
  RuntimeEngineBadge,
  RuntimeStatusIconFrame,
} from "@/components/runtime";
import { cn } from "@/lib/utils";
import { invalidatePredictionRelatedQueries } from "@/lib/prediction-deletion";
import { buildRunStorageArtifactMetadata } from "@/lib/runs/pageData";
import type { RunsExecutionJobListIndicators } from "@/lib/runs/pageData";
import { formatRunProgress, formatRunTokenLabel } from "@/lib/runs/format";
import { getRuntimeResultStatusDisplay } from "@/ui/runtime";
import { deleteN4AWorkspaceRun } from "@/api/linkedWorkspaces";
import {
  formatMetricValue,
  getPrimaryContextMetricLabel,
  isBetterScore,
  DEFAULT_DATASET_ITEM_REGRESSION_METRICS,
} from "@/lib/scores";
import type { EnrichedRun, EnrichedDatasetRun } from "@/types/enriched-runs";
import { filterParasiticDatasets } from "./datasetFilters";
import { DatasetResultCard } from "@/components/scores/DatasetResultCard";

// ============================================================================
// Props
// ============================================================================

interface RunItemProps {
  run: EnrichedRun;
  activeRunProgress?: number;
  isActiveRun?: boolean;
  onViewDetails: (run: EnrichedRun) => void;
  workspaceId: string;
  selectedMetrics?: string[];
  executionJob?: RunsExecutionJobListIndicators;
}

// ============================================================================
// Formatting helpers
// ============================================================================

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatDatetime(iso: string | null): string {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatExecutionTokenLabel(value: string | null): string | null {
  if (!value) return null;
  return formatRunTokenLabel(value);
}

function formatExecutionProgress(progress: number | null): string | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return formatRunProgress(progress);
}

function primaryRefitLabel(metric: string | null, taskType: string | null | undefined): string {
  return getPrimaryContextMetricLabel(metric, "refit", taskType);
}

function RunSummaryStrip({
  run,
  datasets,
  bestDataset,
  showBestScore = true,
  className,
}: {
  run: EnrichedRun;
  datasets: EnrichedDatasetRun[];
  bestDataset: EnrichedDatasetRun | null;
  showBestScore?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground flex-wrap", className)}>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild>
          <span className="flex items-center gap-0.5"><Database className="h-3 w-3" />{datasets.length}</span>
        </TooltipTrigger><TooltipContent>Datasets</TooltipContent></Tooltip>
      </TooltipProvider>
      <span className="text-muted-foreground/40">|</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild>
          <span className="flex items-center gap-0.5"><Layers className="h-3 w-3" />{run.pipeline_runs_count}</span>
        </TooltipTrigger><TooltipContent>Pipeline runs</TooltipContent></Tooltip>
      </TooltipProvider>
      <span className="text-muted-foreground/40">|</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild>
          <span className="flex items-center gap-0.5"><Target className="h-3 w-3" />{run.final_models_count}</span>
        </TooltipTrigger><TooltipContent>Final models</TooltipContent></Tooltip>
      </TooltipProvider>
      <span className="text-muted-foreground/40">|</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild>
          <span className="flex items-center gap-0.5"><Box className="h-3 w-3" />{run.total_models_trained}</span>
        </TooltipTrigger><TooltipContent>Models trained</TooltipContent></Tooltip>
      </TooltipProvider>
      <span className="text-muted-foreground/40">|</span>
      <TooltipProvider>
        <Tooltip><TooltipTrigger asChild>
          <span className="flex items-center gap-0.5"><Layers className="h-3 w-3 rotate-90" />{run.total_folds}</span>
        </TooltipTrigger><TooltipContent>Total folds</TooltipContent></Tooltip>
      </TooltipProvider>
      {run.model_classes && run.model_classes.length > 0 && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <TooltipProvider>
            <Tooltip><TooltipTrigger asChild>
              <span className="flex items-center gap-1">
                {run.model_classes.map((mc) => (
                  <Badge key={mc.name} variant="outline" className="text-[10px] bg-teal-500/10 text-teal-600 border-teal-500/30 py-0 h-4">
                    {mc.name}{mc.count > 1 ? ` ×${mc.count}` : ""}
                  </Badge>
                ))}
              </span>
            </TooltipTrigger><TooltipContent>Trained model classes</TooltipContent></Tooltip>
          </TooltipProvider>
        </>
      )}
      {showBestScore && bestDataset && (bestDataset.best_final_score ?? bestDataset.best_avg_val_score) != null && (
        <>
          <span className="text-muted-foreground/40">|</span>
          <span className={cn(
            "font-mono font-bold",
            bestDataset.best_final_score != null ? "text-emerald-500" : "text-chart-1",
          )}>
            {bestDataset.best_final_score != null
              ? primaryRefitLabel(bestDataset.metric, bestDataset.task_type)
              : `CV ${getPrimaryContextMetricLabel(bestDataset.metric, "crossval", bestDataset.task_type)}`}{" "}
            {formatMetricValue(bestDataset.best_final_score ?? bestDataset.best_avg_val_score, bestDataset.metric || "score")}
          </span>
        </>
      )}
    </div>
  );
}

// ============================================================================
// RunItem — main component
// ============================================================================

export function RunItem({
  run,
  onViewDetails,
  workspaceId,
  selectedMetrics = [...DEFAULT_DATASET_ITEM_REGRESSION_METRICS],
  executionJob,
}: RunItemProps) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const statusDisplay = getRuntimeResultStatusDisplay(run.status);
  const canDeleteRun = !statusDisplay.isBusy;
  const storageArtifactMetadata = buildRunStorageArtifactMetadata(run);
  const storageArtifactFields = storageArtifactMetadata.fields;
  const executionRequestedBackend = formatExecutionTokenLabel(executionJob?.requestedBackend ?? null);
  const executionBackend = formatExecutionTokenLabel(executionJob?.executionBackend ?? null);
  const executionStatus = formatExecutionTokenLabel(executionJob?.executionStatus ?? null);
  const executionProgressUnavailable = executionJob?.progressUnavailable === true;
  const executionProgress = executionProgressUnavailable
    ? null
    : formatExecutionProgress(executionJob?.progress ?? null);
  const executionProgressSummary = executionProgressUnavailable
    ? "Telemetry unavailable"
    : executionProgress;
  const executionJobCount = executionJob?.jobCount ?? 0;
  const executionActiveJobCount = executionJob?.activeJobCount ?? 0;
  const executionFailedJobCount = executionJob?.failedJobCount ?? 0;
  const showExecutionJobCounts = Boolean(executionJob?.hasMultipleJobs);
  const showExecutionSummary = Boolean(
    executionJob
    && (executionJob.hasDurableRecord || executionRequestedBackend || executionBackend),
  );

  // Filter parasitic datasets
  const datasets = filterParasiticDatasets(run.datasets);

  // Best score summary for collapsed state
  const bestDataset = datasets.reduce<EnrichedDatasetRun | null>((best, ds) => {
    const score = ds.best_final_score ?? ds.best_avg_val_score;
    if (score == null) return best;
    if (!best) return ds;
    const bestScore = best.best_final_score ?? best.best_avg_val_score;
    if (bestScore == null) return ds;
    return isBetterScore(score, bestScore, ds.metric ?? best.metric) ? ds : best;
  }, null);

  const handleDeleteRun = async () => {
    if (!canDeleteRun) return;

    setDeleteBusy(true);
    try {
      await deleteN4AWorkspaceRun(workspaceId, run.run_id);
      await invalidatePredictionRelatedQueries(queryClient);
      setDeleteOpen(false);
      toast.success(`Run ${run.name || run.run_id} deleted`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Run deletion failed");
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <>
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <Card className="overflow-hidden" data-testid="run-card">
        {/* Header — always visible, acts as collapse trigger */}
        <CollapsibleTrigger asChild>
          <CardHeader className="p-4 pb-2 cursor-pointer hover:bg-muted/20 transition-colors">
            <div className="flex items-start gap-3 lg:grid lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_auto] lg:items-start">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <RuntimeStatusIconFrame status={run.status} className="relative shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    }
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <h3 className="font-semibold text-foreground truncate">{run.name || run.run_id}</h3>
                      </TooltipTrigger>
                      <TooltipContent>{run.name || run.run_id}</TooltipContent>
                    </Tooltip>
                    {run.project_id && (
                      <Badge variant="outline" className="text-xs shrink-0">
                        <FolderKanban className="h-3 w-3 mr-1" />
                        {run.project_name || "Project"}
                      </Badge>
                    )}
                    <RuntimeEngineBadge source={run} />
                  </div>
                  <RunSummaryStrip
                    run={run}
                    datasets={datasets}
                    bestDataset={bestDataset}
                    showBestScore={!expanded}
                    className="mt-0.5 lg:hidden"
                  />
                </div>
              </div>

              <RunSummaryStrip
                run={run}
                datasets={datasets}
                bestDataset={bestDataset}
                showBestScore={!expanded}
                className="hidden min-w-0 self-center lg:flex"
              />

              <div className="ml-auto flex items-center gap-3 shrink-0 lg:ml-0 lg:justify-self-end">
                <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1" title="Duration">
                    <Timer className="h-3 w-3" />
                    {formatDuration(run.duration_seconds)}
                  </span>
                  <span className="flex items-center gap-1" title="Artifact size">
                    <HardDrive className="h-3 w-3" />
                    {storageArtifactMetadata.artifactSizeLabel}
                  </span>
                  {showExecutionSummary && (
                    <span className="flex items-center gap-1" title="Execution backend">
                      <RefreshCw className={cn("h-3 w-3", executionJob?.executionStatus === "running" && "animate-spin")} />
                      {executionStatus ?? executionRequestedBackend ?? executionBackend}
                      {executionProgressSummary
                        ? `${executionProgressUnavailable ? " · " : " "}${executionProgressSummary}`
                        : ""}
                      {showExecutionJobCounts ? ` · ${executionJobCount} jobs` : ""}
                    </span>
                  )}
                </div>
                <div className="hidden lg:block text-right text-xs text-muted-foreground">
                  <div>{formatDatetime(run.created_at)}</div>
                  {run.completed_at && <div className="text-muted-foreground/60">{formatDatetime(run.completed_at)}</div>}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={!canDeleteRun || deleteBusy}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteOpen(true);
                  }}
                  title={canDeleteRun ? "Delete run" : "Stop the run before deleting it"}
                >
                  {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onViewDetails(run); }}>
                  <Eye className="h-4 w-4 mr-1" />
                  Details
                </Button>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        {/* Collapsible dataset score panels */}
        <CollapsibleContent>
          <CardContent className="px-4 pb-3 pt-1 space-y-3">
            {executionJob?.hasDurableRecord && (
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-foreground">Execution</span>
                  {executionStatus && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {executionStatus}
                    </Badge>
                  )}
                  {executionRequestedBackend && (
                    <span className="text-muted-foreground">
                      requested {executionRequestedBackend}
                    </span>
                  )}
                  {executionBackend && executionBackend !== executionRequestedBackend && (
                    <span className="text-muted-foreground">
                      running on {executionBackend}
                    </span>
                  )}
                  {executionProgressUnavailable && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      Telemetry unavailable
                    </Badge>
                  )}
                  {executionProgress && (
                    <span className="font-mono text-muted-foreground">
                      {executionProgress}
                    </span>
                  )}
                  {showExecutionJobCounts && (
                    <span className="text-muted-foreground">
                      {executionJobCount} jobs
                    </span>
                  )}
                  {executionActiveJobCount > 0 && (
                    <span className="text-muted-foreground">
                      {executionActiveJobCount} active
                    </span>
                  )}
                  {executionFailedJobCount > 0 && (
                    <span className="text-destructive">
                      {executionFailedJobCount} failed
                    </span>
                  )}
                </div>
                {executionJob.progressMessage && (
                  <div className="mt-1 truncate text-muted-foreground">
                    {executionJob.progressMessage}
                  </div>
                )}
              </div>
            )}

            {storageArtifactFields.length > 0 && (
              <div className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {storageArtifactFields.map((field) => (
                  <div key={field.key} className="min-w-0">
                    <div className="text-muted-foreground">{field.label}</div>
                    <div className="font-medium text-foreground break-words">{field.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Error display */}
            {run.error && (
              <div className="p-2 rounded bg-destructive/10 text-destructive text-xs">
                {run.error}
              </div>
            )}

            {/* Per-dataset cards */}
            {datasets.map((ds) => (
              <DatasetResultCard
                key={ds.dataset_name}
                dataset={ds}
                selectedMetrics={selectedMetrics}
                runId={run.run_id}
                workspaceId={workspaceId}
                defaultExpanded={false}
              />
            ))}

            {datasets.length === 0 && statusDisplay.isBusy && (
              <div className="text-sm text-muted-foreground text-center py-3">
                Waiting for results...
              </div>
            )}

            {datasets.length === 0 && !statusDisplay.isBusy && !run.error && (
              <div className="text-sm text-muted-foreground text-center py-3">
                No dataset results available
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
        </Card>
      </Collapsible>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete run?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the run and all linked predictions, chains, arrays, logs, and orphaned artifacts from the active workspace.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteRun} disabled={!canDeleteRun || deleteBusy}>
              {deleteBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete run
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
