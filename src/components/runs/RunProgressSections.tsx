/**
 * Presentational sections for the RunProgress page.
 *
 * These are render-only components extracted from src/pages/RunProgress.tsx to
 * keep the page focused on route params, query/websocket/log side effects, the
 * stop/export handlers, and data derivation. They hold no local state and
 * compose existing primitives from @/components/runs and @/components/ui.
 */

import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Layers,
  Loader2,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { DisplayMetrics } from "@/lib/run-progress-display";
import type {
  GranularProgress,
  ProgressState,
  RefitState,
} from "@/lib/run-progress";
import type { PipelineRun, Run } from "@/types/runs";

import { LogsPanel } from "./LogsPanel";
import { MetricsCard } from "./MetricsCard";
import { PipelineProgress } from "./PipelineProgress";
import { RefitPhaseIndicator } from "./RefitPhaseIndicator";
import { StatusBadge } from "./StatusBadge";

/** Page header with back link, run name/status, description and stop action. */
export function RunProgressHeader({
  run,
  isStopping,
  onStop,
}: {
  run: Run;
  isStopping: boolean;
  onStop: () => void;
}) {
  const isActive = run.status === "running" || run.status === "queued";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/runs">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{run.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            {run.description || `Started ${new Date(run.created_at).toLocaleString()}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isActive && (
          <Button
            variant="destructive"
            onClick={onStop}
            disabled={isStopping}
          >
            {isStopping ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Square className="h-4 w-4 mr-2" />
            )}
            Stop Run
          </Button>
        )}
      </div>
    </div>
  );
}

/** Overall-progress overview card shown while a run is active. */
export function ProgressOverviewCard({
  primaryText,
  secondaryText,
  overallProgress,
}: {
  primaryText: string;
  secondaryText: string | null;
  overallProgress: number;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-start gap-2 text-sm min-w-0">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0">
              <div className="font-medium text-foreground">
                {primaryText}
              </div>
              {secondaryText && (
                <div className="text-xs text-muted-foreground truncate">
                  {secondaryText}
                </div>
              )}
            </div>
          </div>
          <span className="text-sm font-medium">{Math.round(overallProgress)}%</span>
        </div>
        <Progress value={overallProgress} className="h-3" />
      </CardContent>
    </Card>
  );
}

/** Four-up stats grid: datasets, pipelines, completed and failed counts. */
export function RunStatsGrid({
  datasetCount,
  totalPipelines,
  completedCount,
  failedCount,
}: {
  datasetCount: number;
  totalPipelines: number;
  completedCount: number;
  failedCount: number;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{datasetCount}</p>
            <p className="text-xs text-muted-foreground">Datasets</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <Layers className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="text-2xl font-bold">{totalPipelines}</p>
            <p className="text-xs text-muted-foreground">Pipelines</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-chart-1/10">
            <CheckCircle2 className="h-5 w-5 text-chart-1" />
          </div>
          <div>
            <p className="text-2xl font-bold">{completedCount}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10">
            <AlertCircle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-2xl font-bold">{failedCount}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Per-dataset list of pipeline progress cards plus the refit phase indicator. */
export function PipelinesColumn({
  run,
  pipelineIndexById,
  totalPipelineCount,
  currentPipeline,
  currentProgress,
  granularProgress,
  refitState,
}: {
  run: Run;
  pipelineIndexById: Map<string, number>;
  totalPipelineCount: number;
  currentPipeline: PipelineRun | null;
  currentProgress: ProgressState | null;
  granularProgress: GranularProgress;
  refitState: RefitState;
}) {
  return (
    <div className="lg:col-span-2 space-y-4">
      <h2 className="text-lg font-semibold">Pipelines</h2>
      {run.datasets.map(dataset => (
        <div key={dataset.dataset_id} className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Database className="h-4 w-4" />
            {dataset.dataset_name}
          </div>
          {dataset.pipelines.map(pipeline => {
            const isCurrentRunning =
              pipeline.id === currentPipeline?.id && pipeline.status === "running";
            return (
              <PipelineProgress
                key={pipeline.id}
                pipeline={pipeline}
                pipelineIndex={pipelineIndexById.get(pipeline.id) ?? null}
                totalPipelines={totalPipelineCount}
                currentStepMessage={isCurrentRunning ? currentProgress?.message : undefined}
                granularProgress={isCurrentRunning ? granularProgress : undefined}
              />
            );
          })}
        </div>
      ))}

      {/* Refit phase indicator - shown after CV phase completes */}
      {refitState.status !== "idle" && (
        <RefitPhaseIndicator refit={refitState} />
      )}
    </div>
  );
}

/** Key/value card describing the run's identity and timing metadata. */
export function RunInfoCard({ run }: { run: Run }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Run Info</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Run ID</span>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{run.id}</code>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Created</span>
          <span>{new Date(run.created_at).toLocaleString()}</span>
        </div>
        {run.started_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Started</span>
            <span>{new Date(run.started_at).toLocaleString()}</span>
          </div>
        )}
        {run.completed_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Completed</span>
            <span>{new Date(run.completed_at).toLocaleString()}</span>
          </div>
        )}
        {run.duration && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span>{run.duration}</span>
          </div>
        )}
        {run.cv_folds && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">CV Folds</span>
            <span>{run.cv_folds}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Right-hand column: summary metrics, logs panel and run info. */
export function RunSidePanel({
  run,
  summaryPipeline,
  summaryMetrics,
  summaryLabel,
  summaryPrimaryText,
  summarySecondaryText,
  summaryVariantText,
  logs,
  isLoadingLogs,
  logsError,
  onRefreshLogs,
  onExportLogs,
}: {
  run: Run;
  summaryPipeline: PipelineRun | null;
  summaryMetrics: DisplayMetrics | undefined;
  summaryLabel: string;
  summaryPrimaryText: string | undefined;
  summarySecondaryText: string | undefined;
  summaryVariantText: string | null;
  logs: string[];
  isLoadingLogs: boolean;
  logsError: string | null;
  onRefreshLogs: () => void;
  onExportLogs: () => void;
}) {
  const isActive = run.status === "running" || run.status === "queued";

  return (
    <div className="space-y-4">
      {/* Summary metrics */}
      {summaryPipeline && (
        <MetricsCard
          metrics={summaryMetrics}
          label={summaryLabel}
          primaryText={summaryPrimaryText}
          secondaryText={summarySecondaryText}
          variantText={summaryVariantText}
          pendingMessage={
            isActive
              ? "Metrics will appear here after the first completed fit for the current pipeline."
              : undefined
          }
        />
      )}

      {/* Logs */}
      <LogsPanel
        logs={logs}
        isLive={run.status === "running"}
        isLoading={isLoadingLogs}
        errorMessage={logsError}
        onRefresh={onRefreshLogs}
        onExport={onExportLogs}
      />

      {/* Run info */}
      <RunInfoCard run={run} />
    </div>
  );
}
