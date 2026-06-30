import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Activity,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Eye,
  Layers,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RunItem } from "@/components/runs/RunItem";
import { ProjectFilter } from "@/components/runs/ProjectFilter";
import { MetricSelector } from "@/components/scores/MetricSelector";
import { NoWorkspaceState, EmptyState, CardSkeleton, ErrorState } from "@/components/ui/state-display";
import { cn } from "@/lib/utils";
import type {
  RunsExecutionTaskPanelData,
  RunsExecutionJobListIndicators,
  RunsMetricSelectionContext,
  RunsPageStats,
} from "@/lib/runs/pageData";
import {
  GROUPED_EXECUTION_JOB_PREVIEW_COUNT,
  getExecutionTaskGroupKey,
  getExecutionTaskItemKey,
  getVisibleExecutionTaskGroups,
  getVisibleExecutionTaskItems,
  isOrphanedExecutionTask,
} from "@/lib/runs/executionTaskView";
import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";
import {
  buildExecutionJobRecordDetail,
  type ExecutionJobRecordDetailAction,
  type ExecutionJobRecordDetailActionId,
  type ExecutionJobRecordDetailField,
} from "@/lib/runs/executionJobRecordDetail";
import { formatRunProgress, formatRunTokenLabel } from "@/lib/runs/format";
import type { EnrichedRun } from "@/types/enriched-runs";

interface RunsPageHeaderProps {
  metricContext: RunsMetricSelectionContext;
  onProjectChange: (projectId: string | null) => void;
  onSelectedMetricsChange: (metrics: string[]) => void;
  selectedMetrics: string[];
  selectedProjectId: string | null;
}

export function RunsPageHeader({
  metricContext,
  onProjectChange,
  onSelectedMetricsChange,
  selectedMetrics,
  selectedProjectId,
}: RunsPageHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("runs.title")}</h1>
        <p className="text-muted-foreground text-sm">{t("runs.subtitle")}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <MetricSelector
          taskType={metricContext.taskType}
          taskTypes={metricContext.taskTypes}
          selectedMetrics={selectedMetrics}
          onSelectedMetricsChange={onSelectedMetricsChange}
          availableMetricKeys={metricContext.availableMetricKeys}
        />
        <ProjectFilter selectedProjectId={selectedProjectId} onProjectChange={onProjectChange} />
        <Button asChild>
          <Link to="/editor">
            <Plus className="h-4 w-4 mr-2" />
            {t("runs.newRun")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

interface RunsStatsGridProps {
  stats: RunsPageStats;
}

interface RunsStatCardProps {
  icon: LucideIcon;
  iconClassName: string;
  iconContainerClassName: string;
  label: string;
  value: number;
}

function RunsStatCard({
  icon: Icon,
  iconClassName,
  iconContainerClassName,
  label,
  value,
}: RunsStatCardProps) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={cn("p-2 rounded-lg", iconContainerClassName)}>
          <Icon className={cn("h-4 w-4", iconClassName)} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function RunsStatsGrid({ stats }: RunsStatsGridProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
      <RunsStatCard
        icon={RefreshCw}
        iconClassName={cn("text-chart-2", stats.runningCount > 0 && "animate-spin")}
        iconContainerClassName="bg-chart-2/10"
        label={t("runs.stats.running")}
        value={stats.runningCount}
      />
      <RunsStatCard
        icon={Clock}
        iconClassName="text-muted-foreground"
        iconContainerClassName="bg-muted/50"
        label={t("runs.stats.queued")}
        value={stats.queuedCount}
      />
      <RunsStatCard
        icon={CheckCircle2}
        iconClassName="text-chart-1"
        iconContainerClassName="bg-chart-1/10"
        label={t("runs.stats.completed")}
        value={stats.completedCount}
      />
      <RunsStatCard
        icon={AlertCircle}
        iconClassName="text-destructive"
        iconContainerClassName="bg-destructive/10"
        label={t("runs.stats.failed")}
        value={stats.failedCount}
      />
      <RunsStatCard
        icon={Layers}
        iconClassName="text-primary"
        iconContainerClassName="bg-primary/10"
        label={t("runs.stats.totalPipelines")}
        value={stats.totalPipelines}
      />
    </div>
  );
}

interface RunsExecutionTasksPanelProps {
  data: RunsExecutionTaskPanelData;
  onInspectJob?: (jobId: string) => void;
}

function formatJsonValue(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

export function RunsExecutionTasksPanel({ data, onInspectJob }: RunsExecutionTasksPanelProps) {
  const [isPanelExpanded, setPanelExpanded] = useState(false);
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());

  if (!data.hasTasks) {
    return null;
  }

  const orphanedCount = data.items.filter(isOrphanedExecutionTask).length;
  const visibleItems = getVisibleExecutionTaskItems(data.items);
  const visibleGroups = getVisibleExecutionTaskGroups(data.groups);
  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  return (
    <Card>
      <Collapsible open={isPanelExpanded} onOpenChange={setPanelExpanded}>
        <CardContent className="p-3 space-y-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
              aria-label={isPanelExpanded ? "Collapse execution tasks" : "Expand execution tasks"}
            >
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-primary/10 p-1.5">
                  <Activity className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Execution tasks</h2>
                  <p className="text-xs text-muted-foreground">
                    {data.activeCount} active / {data.totalCount} tracked
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {orphanedCount > 0 && (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                    {orphanedCount} orphaned
                  </Badge>
                )}
                <Badge variant="outline">{data.remoteRequestedCount} remote requested</Badge>
                <Badge variant="outline">{data.completedCount} completed</Badge>
                {data.failedCount > 0 && (
                  <Badge variant="destructive">{data.failedCount} failed</Badge>
                )}
                {isPanelExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {visibleItems.map((item) => {
                const isOrphaned = isOrphanedExecutionTask(item);

                return (
                  <div
                    key={getExecutionTaskItemKey(item)}
                    className={cn(
                      "rounded-md border bg-muted/20 p-2",
                      isOrphaned && "border-amber-500/40 bg-amber-500/5",
                    )}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{item.runName || item.runId}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {formatRunTokenLabel(item.requestedBackend)}
                          {item.executionBackend !== item.requestedBackend
                            ? ` -> ${formatRunTokenLabel(item.executionBackend)}`
                            : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {isOrphaned && (
                          <Badge
                            variant="outline"
                            className="h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                          >
                            Orphaned
                          </Badge>
                        )}
                        <Badge variant={item.isActive ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                          {formatRunTokenLabel(item.executionStatus)}
                        </Badge>
                        {onInspectJob && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => onInspectJob(item.jobId)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                  <span className="sr-only">Inspect execution job</span>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Inspect job record</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span className="truncate">{item.progressMessage || item.runStatus}</span>
                        {item.progressUnavailable ? (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            Telemetry unavailable
                          </Badge>
                        ) : (
                          <span className="font-mono">{formatRunProgress(item.progress)}</span>
                        )}
                      </div>
                      <Progress value={item.progress} className="h-1.5" />
                    </div>
                  </div>
                );
              })}
            </div>

            {visibleGroups.length > 0 && (
              <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">Grouped jobs</h3>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {visibleGroups.length} runs
              </Badge>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleGroups.map((group) => {
                const isGroupExpanded = expandedGroupIds.has(group.groupId);
                const groupItems = isGroupExpanded
                  ? group.items
                  : group.items.slice(0, GROUPED_EXECUTION_JOB_PREVIEW_COUNT);
                const hiddenJobCount = group.items.length - groupItems.length;
                const groupLabel = group.runName || group.runId;

                return (
                  <div
                    key={getExecutionTaskGroupKey(group)}
                    className={cn(
                      "rounded-md border bg-muted/10 p-2",
                      group.isOrphaned && "border-amber-500/40 bg-amber-500/5",
                    )}
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium" title={groupLabel}>
                          {groupLabel}
                        </div>
                        <div className="flex flex-wrap gap-1 pt-1">
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            {group.totalCount} jobs
                          </Badge>
                          {group.activeCount > 0 && (
                            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                              {group.activeCount} active
                            </Badge>
                          )}
                          {group.failedCount > 0 && (
                            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                              {group.failedCount} failed
                            </Badge>
                          )}
                        </div>
                      </div>
                      {group.isOrphaned && (
                        <Badge
                          variant="outline"
                          className="h-5 shrink-0 border-amber-500/40 bg-amber-500/10 px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
                        >
                          Orphaned
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 space-y-1">
                      {groupItems.map((item) => (
                        <div
                          key={getExecutionTaskItemKey(item)}
                          className="flex min-w-0 items-center justify-between gap-2 rounded-sm bg-background/60 px-2 py-1 text-[11px]"
                        >
                          <div className="min-w-0 truncate text-muted-foreground">
                            {formatRunTokenLabel(item.executionStatus)}
                            {" · "}
                            {formatRunTokenLabel(item.requestedBackend)}
                            {item.executionBackend !== item.requestedBackend
                              ? ` -> ${formatRunTokenLabel(item.executionBackend)}`
                              : ""}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {item.progressUnavailable ? (
                              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                                No telemetry
                              </Badge>
                            ) : (
                              <span className="font-mono text-muted-foreground">{formatRunProgress(item.progress)}</span>
                            )}
                            {onInspectJob && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                                onClick={() => onInspectJob(item.jobId)}
                              >
                                <Eye className="h-3 w-3" />
                                <span className="sr-only">Inspect execution job {item.jobId}</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                      {group.items.length > GROUPED_EXECUTION_JOB_PREVIEW_COUNT && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                          onClick={() => toggleGroup(group.groupId)}
                          aria-expanded={isGroupExpanded}
                          aria-label={
                            isGroupExpanded
                              ? `Collapse execution jobs for ${groupLabel}`
                              : `Expand ${hiddenJobCount} hidden execution jobs for ${groupLabel}`
                          }
                        >
                          {isGroupExpanded ? (
                            <>
                              <ChevronUp className="mr-1 h-3 w-3" />
                              Show fewer
                            </>
                          ) : (
                            <>
                              <ChevronDown className="mr-1 h-3 w-3" />
                              +{hiddenJobCount} more
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
              </div>
            )}
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

interface RunsExecutionJobRecordDialogProps {
  actionErrorMessage?: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  jobId: string | null;
  onCancelJob?: (jobId: string) => void | Promise<unknown>;
  onOpenChange: (open: boolean) => void;
  onRetryRun?: (runId: string) => void | Promise<unknown>;
  open: boolean;
  pendingAction?: ExecutionJobRecordDetailActionId | null;
  record: ExecutionJobRecord | null;
}

function ExecutionJobRecordField({ label, tone, value }: Pick<ExecutionJobRecordDetailField, "label" | "tone" | "value">) {
  if (value == null || value === "") return null;

  return (
    <div
      className={cn(
        "min-w-0 rounded-md border bg-muted/20 p-2",
        tone === "destructive" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("truncate text-xs font-medium", tone === "destructive" && "text-destructive")}>
        {value}
      </dd>
    </div>
  );
}

function ExecutionJobRecordJsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold">{label}</h3>
      <pre className="max-h-52 overflow-auto rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed">
        {formatJsonValue(value)}
      </pre>
    </section>
  );
}

function getActionButtonVariant(action: ExecutionJobRecordDetailAction): "default" | "destructive" | "outline" {
  if (action.id === "cancel") return "destructive";
  if (action.enabled) return "default";
  return "outline";
}

export function RunsExecutionJobRecordDialog({
  actionErrorMessage,
  errorMessage,
  isLoading,
  jobId,
  onCancelJob,
  onOpenChange,
  onRetryRun,
  open,
  pendingAction,
  record,
}: RunsExecutionJobRecordDialogProps) {
  const detail = record ? buildExecutionJobRecordDetail(record) : null;
  const displayJobId = detail?.description ?? (jobId ? `Job ${jobId}` : "");
  const visibleActions = detail?.actions.filter(action => action.visible) ?? [];
  const handleAction = (action: ExecutionJobRecordDetailAction) => {
    if (!action.enabled) return;
    if (action.id === "cancel") {
      void onCancelJob?.(action.jobId);
    } else if (action.id === "retry") {
      if (!action.runId) return;
      void onRetryRun?.(action.runId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Execution job record</DialogTitle>
          <DialogDescription className="truncate">
            {displayJobId || "Execution snapshot"}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading job record
          </div>
        ) : errorMessage ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : detail ? (
          <ScrollArea className="max-h-[65vh] pr-4">
            <div className="space-y-4">
              <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {detail.fields.map(field => (
                  <ExecutionJobRecordField
                    key={field.id}
                    label={field.label}
                    tone={field.tone}
                    value={field.value}
                  />
                ))}
              </dl>

              {visibleActions.length > 0 && (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold">Control readiness</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {visibleActions.map(action => (
                      <div key={action.id} className="rounded-md border bg-muted/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium">{action.label}</span>
                          {action.id === "cancel" || action.id === "retry" ? (
                            <Button
                              type="button"
                              variant={getActionButtonVariant(action)}
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={!action.enabled || pendingAction != null}
                              onClick={() => handleAction(action)}
                            >
                              {pendingAction === action.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                              {action.label}
                            </Button>
                          ) : (
                            <Badge variant={action.enabled ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                              {action.enabled ? "Available" : "Unavailable"}
                            </Badge>
                          )}
                        </div>
                        {action.reason && (
                          <p className="mt-1 text-[11px] text-muted-foreground">{action.reason}</p>
                        )}
                        {action.href && (
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{action.href}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  {actionErrorMessage && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                      {actionErrorMessage}
                    </div>
                  )}
                </section>
              )}

              {detail.jsonSections.map(section => (
                <ExecutionJobRecordJsonBlock
                  key={section.id}
                  label={section.label}
                  value={section.value}
                />
              ))}
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface RunsListProps {
  errorMessage: string | null;
  hasActiveWorkspace: boolean;
  isLoading: boolean;
  onRetry: () => void | Promise<unknown>;
  onViewDetails: (run: EnrichedRun) => void;
  runs: EnrichedRun[];
  selectedMetrics: string[];
  workspaceId: string | undefined;
  executionJobIndicators?: ReadonlyMap<string, RunsExecutionJobListIndicators>;
}

export function RunsList({
  errorMessage,
  hasActiveWorkspace,
  isLoading,
  onRetry,
  onViewDetails,
  runs,
  selectedMetrics,
  workspaceId,
  executionJobIndicators,
}: RunsListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      {isLoading ? (
        <CardSkeleton count={3} />
      ) : !hasActiveWorkspace ? (
        <NoWorkspaceState title="No workspace linked" description="Link a nirs4all workspace to see your runs. Go to Settings." />
      ) : errorMessage && runs.length === 0 ? (
        <ErrorState
          title="Failed to load run history"
          message={errorMessage}
          onRetry={() => {
            void onRetry();
          }}
        />
      ) : runs.length === 0 ? (
        <EmptyState icon={Play} title={t("runs.empty")} description={t("runs.emptyHint")} action={{ label: t("runs.newRun"), href: "/editor" }} />
      ) : (
        runs.map(run => (
          <RunItem
            key={run.run_id}
            run={run}
            onViewDetails={onViewDetails}
            workspaceId={workspaceId!}
            selectedMetrics={selectedMetrics}
            executionJob={executionJobIndicators?.get(run.run_id)}
          />
        ))
      )}
    </div>
  );
}
