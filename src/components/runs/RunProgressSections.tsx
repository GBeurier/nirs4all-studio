/**
 * Presentational sections for the RunProgress page.
 *
 * These are render-only components extracted from src/pages/RunProgress.tsx to
 * keep the page focused on route params, query/websocket/log side effects, the
 * stop/export handlers, and data derivation. They hold no local state and
 * compose existing primitives from @/components/runs and @/components/ui.
 */

import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Database,
  Layers,
  Loader2,
  Square,
} from "lucide-react";

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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress, IndeterminateProgress } from "@/components/ui/progress";
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
import { getActiveLocale } from "@/lib/activeLocale";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(getActiveLocale());
}

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
  const { t } = useTranslation();
  const isActive = run.status === "running" || run.status === "queued";

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/runs" aria-label={t("common.back")}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{run.name}</h1>
            <StatusBadge status={run.status} />
          </div>
          <p className="text-muted-foreground text-sm">
            {run.description || t("runs.progress.started", { date: formatDateTime(run.created_at) })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isActive && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isStopping}>
                {isStopping ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Square className="h-4 w-4 mr-2" />
                )}
                {t("runs.execution.stopConfirm")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("runs.execution.stopTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("runs.execution.stopDescription")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("runs.execution.stopCancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={onStop}>{t("runs.execution.stopConfirm")}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
  progressUnavailable = false,
}: {
  primaryText: string;
  secondaryText: string | null;
  overallProgress: number;
  progressUnavailable?: boolean;
}) {
  const { t } = useTranslation();

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
          <span className="text-sm font-medium">{progressUnavailable ? t("runs.widget.unavailable") : `${Math.round(overallProgress)}%`}</span>
        </div>
        {progressUnavailable
          ? <IndeterminateProgress className="h-3" />
          : <Progress value={overallProgress} className="h-3" />}
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
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold">{datasetCount}</p>
            <p className="text-xs text-muted-foreground">{t("runs.detail.statDatasets")}</p>
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
            <p className="text-xs text-muted-foreground">{t("runs.detail.statPipelines")}</p>
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
            <p className="text-xs text-muted-foreground">{t("runs.stats.completed")}</p>
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
            <p className="text-xs text-muted-foreground">{t("runs.stats.failed")}</p>
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
  const { t } = useTranslation();

  return (
    <div className="lg:col-span-2 space-y-4">
      <h2 className="text-lg font-semibold">{t("runs.detail.statPipelines")}</h2>
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
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("runs.progress.runInfo")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("runs.jobDetail.runId")}</span>
          <code className="text-xs bg-muted px-1 py-0.5 rounded">{run.id}</code>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">{t("runs.jobDetail.created")}</span>
          <span>{formatDateTime(run.created_at)}</span>
        </div>
        {run.started_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("runs.detail.overview.started")}</span>
            <span>{formatDateTime(run.started_at)}</span>
          </div>
        )}
        {run.completed_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("runs.detail.overview.completed")}</span>
            <span>{formatDateTime(run.completed_at)}</span>
          </div>
        )}
        {run.duration && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("runs.item.duration")}</span>
            <span>{run.duration}</span>
          </div>
        )}
        {run.cv_folds && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("runs.detail.overview.cvFolds")}</span>
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
  const { t } = useTranslation();
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
              ? t("runs.progress.metricsPending")
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
