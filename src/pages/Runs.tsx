import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play,
  Pause,
  Square,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronRight,
  Database,
  Layers,
  Box,
  FileText,
  Plus,
  BarChart3,
  Target,
  FolderOpen,
  LayoutTemplate,
  GitBranch,
  Settings2,
  Terminal,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { RunDetailSheet } from "@/components/runs/RunDetailSheet";
import { NoWorkspaceState, EmptyState, CardSkeleton } from "@/components/ui/state-display";
import { Run, DatasetRun, PipelineRun, RunStatus, runStatusConfig, PipelineTemplate, RunDatasetInfo } from "@/types/runs";
import {
  listRuns,
  getRunStats,
  getLinkedWorkspaces,
  getN4AWorkspaceRuns
} from "@/api/client";
import type { DiscoveredRun } from "@/types/linked-workspaces";

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
  partial: AlertCircle,
};

function formatTimeAgo(dateString: string | null, t: (key: string, options?: { count?: number }) => string): string {
  if (!dateString) return t("runs.unknown");
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return t("runs.unknown");

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t("time.justNow");
  if (diffMins < 60) return t("time.minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("time.hoursAgo", { count: diffHours });
  return t("time.daysAgo", { count: diffDays });
}

/**
 * Extended DiscoveredRun interface with v2 fields.
 * The API returns additional fields for v2 format runs.
 */
interface DiscoveredRunV2 extends DiscoveredRun {
  format?: "v1" | "v2" | "parquet_derived";
  templates?: Array<{
    id: string;
    name: string;
    file?: string;
    expansion_count: number;
  }>;
  datasets?: Array<{
    name: string;
    path?: string;
    hash?: string;
    task_type?: string;
    n_samples?: number;
    n_features?: number;
  }>;
  total_pipeline_configs?: number;
  summary?: {
    total_results?: number;
    completed_results?: number;
    failed_results?: number;
    best_result?: Record<string, unknown>;
  };
  description?: string;
  status?: string;
  results_count?: number;
}

/**
 * Convert discovered runs from workspace to the Run type used by the UI.
 * Supports both v1 (legacy) and v2 (templates) formats.
 */
function convertDiscoveredRunsToRuns(discoveredRuns: DiscoveredRunV2[]): Run[] {
  const runs: Run[] = [];

  const buildRunId = (dr: DiscoveredRunV2): string => {
    return (
      dr.id ||
      dr.name ||
      dr.manifest_path ||
      `${dr.dataset || dr.datasets?.[0]?.name || "run"}-${dr.pipeline_id || "pipeline"}-${dr.created_at || "unknown"}`
    );
  };

  const buildRunName = (dr: DiscoveredRunV2, runId: string): string => {
    if (dr.name && dr.name.trim()) return dr.name;

    const datasetName = dr.dataset || dr.datasets?.[0]?.name;
    const templateName = dr.templates?.[0]?.name || dr.pipeline_id;
    if (datasetName && templateName) {
      return `${datasetName} × ${templateName}`;
    }
    if (datasetName) return datasetName;
    return runId;
  };

  for (const dr of discoveredRuns) {
    const isV2 = dr.format === "v2";
    const runId = buildRunId(dr);
    const runName = buildRunName(dr, runId);

    if (isV2) {
      // V2 format: run has templates and multiple datasets
      const templates: PipelineTemplate[] = (dr.templates || []).map(t => ({
        id: t.id,
        name: t.name,
        file: t.file,
        expansion_count: t.expansion_count,
      }));

      const datasetsInfo: RunDatasetInfo[] = (dr.datasets || []).map(d => ({
        name: d.name,
        path: d.path,
        hash: d.hash,
        task_type: d.task_type,
        n_samples: d.n_samples,
        n_features: d.n_features,
      }));

      // Create dataset entries from the datasets array
      const datasetRuns: DatasetRun[] = (dr.datasets || [])
        .filter(d => d.name)
        .map(d => ({
          dataset_id: d.name,
          dataset_name: d.name,
          pipelines: [], // Will be populated from results if needed
        }));

      // Determine status
      let status: RunStatus = "completed";
      if (dr.status) {
        const statusLower = dr.status.toLowerCase();
        if (["queued", "running", "completed", "failed", "paused", "partial"].includes(statusLower)) {
          status = statusLower as RunStatus;
        }
      }

      runs.push({
        id: runId,
        name: runName,
        description: dr.description,
        status,
        format: "v2",
        created_at: dr.created_at || new Date().toISOString(),
        datasets: datasetRuns,
        templates,
        datasets_info: datasetsInfo,
        total_pipeline_configs: dr.total_pipeline_configs,
        summary: dr.summary,
        results_count: dr.results_count,
        manifest_path: dr.manifest_path,
      });
    } else {
      // V1 or parquet_derived format: group by name like before
      let existingRun = runs.find(r => r.id === runId);

      if (!existingRun) {
        existingRun = {
          id: runId,
          name: runName,
          status: "completed" as RunStatus,
          format: dr.format || "v1",
          created_at: dr.created_at || new Date().toISOString(),
          datasets: [],
        };
        runs.push(existingRun);
      }

      // Find or create the dataset entry
      let datasetRun = existingRun.datasets.find(d => d.dataset_id === dr.dataset);
      if (!datasetRun) {
        datasetRun = {
          dataset_id: dr.dataset,
          dataset_name: dr.dataset,
          pipelines: [],
        };
        existingRun.datasets.push(datasetRun);
      }

      // Add pipeline entry
      const pipeline: PipelineRun = {
        id: dr.pipeline_id || dr.id,
        pipeline_id: dr.pipeline_id || dr.id,
        pipeline_name: dr.name,
        model: dr.models?.[0] || "Unknown",
        preprocessing: "-",
        split_strategy: "-",
        status: "completed",
        progress: 100,
        val_score: dr.best_val_score ?? null,
        test_score: dr.best_test_score ?? null,
        metrics: dr.best_val_score != null || dr.best_test_score != null ? {
          r2: dr.best_val_score ?? dr.best_test_score ?? 0,
          rmse: 0,
        } : undefined,
      };

      datasetRun.pipelines.push(pipeline);
    }
  }

  return runs;
}

export default function Runs() {
  const { t } = useTranslation();
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [expandedDatasets, setExpandedDatasets] = useState<Set<string>>(new Set());
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Fetch linked workspaces
  const { data: workspacesData } = useQuery({
    queryKey: ["linked-workspaces"],
    queryFn: getLinkedWorkspaces,
    staleTime: 30000,
  });

  // Get active workspace ID
  const activeWorkspaceId = workspacesData?.active_workspace_id;

  // Fetch runs from in-memory store (active/ongoing runs)
  const {
    data: activeRunsData,
    isLoading: isLoadingActive
  } = useQuery({
    queryKey: ["runs"],
    queryFn: listRuns,
    staleTime: 5000, // Refresh more frequently for active runs
    refetchInterval: 10000, // Poll for updates on running experiments
  });

  // Fetch run stats
  const { data: statsData } = useQuery({
    queryKey: ["run-stats"],
    queryFn: getRunStats,
    staleTime: 10000,
    refetchInterval: 15000,
  });

  // Fetch discovered runs from active workspace (historical runs)
  const {
    data: discoveredRunsData,
    isLoading: isLoadingDiscovered
  } = useQuery({
    queryKey: ["workspace-runs", activeWorkspaceId],
    queryFn: () => activeWorkspaceId ? getN4AWorkspaceRuns(activeWorkspaceId) : Promise.resolve({ runs: [], total: 0, workspace_id: "" }),
    enabled: !!activeWorkspaceId,
    staleTime: 60000,
  });

  // Combine active runs with discovered historical runs
  const runs = useMemo(() => {
    const activeRuns = activeRunsData?.runs || [];
    const discoveredRuns = discoveredRunsData?.runs || [];

    // Convert discovered runs to Run format
    const historicalRuns = convertDiscoveredRunsToRuns(discoveredRuns);

    // Merge, with active runs taking precedence
    const activeRunIds = new Set(activeRuns.map(r => r.id));
    const uniqueHistoricalRuns = historicalRuns.filter(r => !activeRunIds.has(r.id));

    return [...activeRuns, ...uniqueHistoricalRuns].filter(r => !!r.id);
  }, [activeRunsData, discoveredRunsData]);

  const isLoading = isLoadingActive || isLoadingDiscovered;

  const openRunDetails = (run: Run, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedRun(run);
    setSheetOpen(true);
  };

  const toggleRun = (id: string) => {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleDataset = (key: string) => {
    setExpandedDatasets(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Calculate stats from combined runs or use API stats
  const runningCount = runs.filter(r => r.status === "running").length;
  const queuedCount = runs.filter(r => r.status === "queued").length;
  const completedCount = runs.filter(r => r.status === "completed").length;
  const failedCount = runs.filter(r => r.status === "failed").length;
  const totalPipelines = runs.reduce((acc, r) => acc + r.datasets.reduce((a, d) => a + d.pipelines.length, 0), 0);

  const hasActiveWorkspace = !!activeWorkspaceId;

  const computeRunStats = (run: Run) => {
    // For v2 format, use the run-level stats
    if (run.format === "v2") {
      const templatesCount = run.templates?.length || 0;
      const datasetsCount = run.datasets_info?.length || run.datasets.length;
      const pipelineConfigs = run.total_pipeline_configs || 0;
      const resultsCount = run.results_count || run.summary?.total_results || 0;
      const completedResults = run.summary?.completed_results || 0;
      return {
        templatesCount,
        datasetsCount,
        pipelineCount: pipelineConfigs,
        resultsCount,
        completedResults,
        modelCount: 0, // Not easily available in v2 without reading results
        completedPipelines: completedResults,
      };
    }

    // For v1/parquet format, compute from pipelines
    const pipelineCount = run.datasets.reduce((acc, d) => acc + d.pipelines.length, 0);
    const models = new Set(run.datasets.flatMap(d => d.pipelines.map(p => p.model)));
    const completedPipelines = run.datasets.flatMap(d => d.pipelines).filter(p => p.status === "completed").length;
    return {
      templatesCount: 0,
      datasetsCount: run.datasets.length,
      pipelineCount,
      resultsCount: pipelineCount,
      completedResults: completedPipelines,
      modelCount: models.size,
      completedPipelines,
    };
  };

  const getRunProgress = (run: Run): number => {
    const pipelines = run.datasets.flatMap(d => d.pipelines);
    if (pipelines.length === 0) return 0;
    return pipelines.reduce((acc, p) => acc + p.progress, 0) / pipelines.length;
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("runs.title")}</h1>
          <p className="text-muted-foreground">{t("runs.subtitle")}</p>
        </div>
        <Button asChild>
          <Link to="/editor">
            <Plus className="h-4 w-4 mr-2" />
            {t("runs.newRun")}
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-2/10">
              <RefreshCw className={cn("h-5 w-5 text-chart-2", runningCount > 0 && "animate-spin")} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("runs.stats.running")}</p>
              <p className="text-2xl font-bold text-foreground">{runningCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted/50">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("runs.stats.queued")}</p>
              <p className="text-2xl font-bold text-foreground">{queuedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-1/10">
              <CheckCircle2 className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("runs.stats.completed")}</p>
              <p className="text-2xl font-bold text-foreground">{completedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("runs.stats.failed")}</p>
              <p className="text-2xl font-bold text-foreground">{failedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Layers className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("runs.stats.totalPipelines")}</p>
              <p className="text-2xl font-bold text-foreground">{totalPipelines}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Runs List */}
      <div className="space-y-4">
        {isLoading ? (
          // Loading skeleton
          <CardSkeleton count={3} />
        ) : !hasActiveWorkspace ? (
          // No workspace linked
          <NoWorkspaceState
            title={t("runs.noWorkspace", { defaultValue: "No workspace linked" })}
            description={t("runs.noWorkspaceHint", { defaultValue: "Link a nirs4all workspace to see your runs and training results. Go to Settings to link a workspace directory." })}
          />
        ) : runs.length === 0 ? (
          <EmptyState
            icon={Play}
            title={t("runs.empty")}
            description={t("runs.emptyHint")}
            action={{
              label: t("runs.newRun"),
              href: "/editor",
            }}
          />
        ) : (
          runs.map((run) => {
            const StatusIcon = statusIcons[run.status] || statusIcons.completed;
            const config = runStatusConfig[run.status] || runStatusConfig.completed;
            const stats = computeRunStats(run);
            const isExpanded = expandedRuns.has(run.id);
            const progress = getRunProgress(run);
            const isV2 = run.format === "v2";

            return (
              <Card key={run.id} className="overflow-hidden">
                <Collapsible open={isExpanded} onOpenChange={() => toggleRun(run.id)}>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 text-muted-foreground" />
                          )}
                          <div className={`p-2 rounded-lg ${config.bg}`}>
                            <StatusIcon
                              className={cn(
                                "h-5 w-5",
                                config.color,
                                config.iconClass
                              )}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-foreground">{run.name}</h3>
                              {isV2 && (
                                <Badge variant="outline" className="text-xs">v2</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              {/* Show templates for v2 format */}
                              {isV2 && stats.templatesCount > 0 && (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <span className="flex items-center gap-1">
                                          <LayoutTemplate className="h-3.5 w-3.5 text-primary" />
                                          {stats.templatesCount} {stats.templatesCount === 1 ? "template" : "templates"}
                                        </span>
                                      </TooltipTrigger>
                                      <TooltipContent>
                                        <p className="font-medium">Templates:</p>
                                        <ul className="text-xs">
                                          {run.templates?.slice(0, 5).map(t => (
                                            <li key={t.id}>{t.name} ({t.expansion_count} configs)</li>
                                          ))}
                                          {(run.templates?.length || 0) > 5 && (
                                            <li>...and {(run.templates?.length || 0) - 5} more</li>
                                          )}
                                        </ul>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                  <span>•</span>
                                </>
                              )}
                              <span className="flex items-center gap-1">
                                <Database className="h-3.5 w-3.5" />
                                {stats.datasetsCount} {stats.datasetsCount === 1 ? "dataset" : "datasets"}
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Layers className="h-3.5 w-3.5" />
                                {isV2 ? (
                                  <>{stats.pipelineCount} configs</>
                                ) : (
                                  <>{stats.pipelineCount} pipelines</>
                                )}
                              </span>
                              {!isV2 && stats.modelCount > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <Box className="h-3.5 w-3.5" />
                                    {stats.modelCount} models
                                  </span>
                                </>
                              )}
                              {isV2 && stats.resultsCount > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="flex items-center gap-1">
                                    <BarChart3 className="h-3.5 w-3.5" />
                                    {stats.completedResults}/{stats.resultsCount} results
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Progress for running */}
                          {run.status === "running" && (
                            <div className="flex items-center gap-2 w-32">
                              <Progress value={progress} className="h-2" />
                              <span className="text-xs text-muted-foreground">{Math.round(progress)}%</span>
                            </div>
                          )}

                          <div className="text-right text-sm text-muted-foreground">
                            <div>{formatTimeAgo(run.created_at, t)}</div>
                            {run.duration && <div className="text-xs">{run.duration}</div>}
                          </div>

                          {/* Action buttons based on status */}
                          {run.status === "running" && (
                            <>
                              <Button variant="outline" size="icon" onClick={(e) => e.stopPropagation()}>
                                <Pause className="h-4 w-4" />
                              </Button>
                              <Button variant="outline" size="icon" onClick={(e) => e.stopPropagation()}>
                                <Square className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {run.status === "completed" && (
                            <Button variant="outline" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                              <Link to={`/results`}>
                                <BarChart3 className="h-4 w-4 mr-2" />
                                {t("results.title")}
                              </Link>
                            </Button>
                          )}
                          {run.status === "failed" && (
                            <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              {t("runs.actions.retry")}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => openRunDetails(run, e)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            {t("runs.actions.view")}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-0 space-y-3">
                      {/* Progress and logs for running runs */}
                      {run.status === "running" && (
                        <div className="space-y-3">
                          {/* Overall progress bar */}
                          <div className="p-3 rounded-lg bg-chart-2/10 border border-chart-2/20">
                            <div className="flex items-center justify-between text-sm mb-2">
                              <span className="font-medium text-foreground flex items-center gap-2">
                                <RefreshCw className="h-4 w-4 animate-spin text-chart-2" />
                                {t("runs.status.running")}
                              </span>
                              <span className="text-muted-foreground">{Math.round(progress)}% complete</span>
                            </div>
                            <Progress value={progress} className="h-2" />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>
                                {run.completed_pipelines || 0}/{run.total_pipelines || 0} pipelines
                              </span>
                              {run.duration && <span>Elapsed: {run.duration}</span>}
                            </div>
                          </div>
                          {/* Live logs for running */}
                          {(() => {
                            const allLogs = run.datasets.flatMap(d => d.pipelines).flatMap(p => p.logs || []);
                            if (allLogs.length > 0) {
                              return (
                                <div className="rounded-lg border bg-muted/30">
                                  <div className="flex items-center gap-2 px-3 py-2 border-b">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs font-medium text-muted-foreground">Live Log</span>
                                    <Badge variant="outline" className="text-[10px] animate-pulse">Live</Badge>
                                  </div>
                                  <ScrollArea className="h-24">
                                    <div className="p-3 font-mono text-xs space-y-0.5">
                                      {allLogs.slice(-20).map((log, i) => (
                                        <div
                                          key={i}
                                          className={cn(
                                            log.includes("[ERROR]") && "text-destructive",
                                            log.includes("[WARN]") && "text-amber-500",
                                            log.includes("[INFO]") && "text-muted-foreground"
                                          )}
                                        >
                                          {log}
                                        </div>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {/* Error message and logs for failed runs */}
                      {run.status === "failed" && (
                        <div className="space-y-2">
                          <div className="p-3 rounded-lg bg-destructive/10 text-sm text-destructive">
                            <div className="flex items-center gap-2 font-medium mb-1">
                              <AlertCircle className="h-4 w-4" />
                              {t("runs.error")}
                            </div>
                            {run.datasets.flatMap(d => d.pipelines).find(p => p.error_message)?.error_message || t("runs.unknownError")}
                          </div>
                          {/* Show logs if available */}
                          {(() => {
                            const allLogs = run.datasets.flatMap(d => d.pipelines).flatMap(p => p.logs || []);
                            if (allLogs.length > 0) {
                              return (
                                <div className="rounded-lg border bg-muted/30">
                                  <div className="flex items-center gap-2 px-3 py-2 border-b">
                                    <Terminal className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-xs font-medium text-muted-foreground">Execution Log</span>
                                  </div>
                                  <ScrollArea className="h-32">
                                    <div className="p-3 font-mono text-xs space-y-0.5">
                                      {allLogs.map((log, i) => (
                                        <div
                                          key={i}
                                          className={cn(
                                            log.includes("[ERROR]") && "text-destructive",
                                            log.includes("[WARN]") && "text-amber-500",
                                            log.includes("[INFO]") && "text-muted-foreground"
                                          )}
                                        >
                                          {log}
                                        </div>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}

                      {/* Dataset breakdown */}
                      {run.datasets.map((datasetRun) => {
                        const datasetKey = `${run.id}-${datasetRun.dataset_id}`;
                        const isDatasetExpanded = expandedDatasets.has(datasetKey);
                        const completedInDataset = datasetRun.pipelines.filter(p => p.status === "completed").length;

                        return (
                          <Collapsible
                            key={datasetKey}
                            open={isDatasetExpanded}
                            onOpenChange={() => toggleDataset(datasetKey)}
                          >
                            <CollapsibleTrigger asChild>
                              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
                                {isDatasetExpanded ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                                <Database className="h-4 w-4 text-primary" />
                                <span className="font-medium text-sm">{datasetRun.dataset_name}</span>
                                <Badge variant="secondary" className="text-xs">
                                  {completedInDataset}/{datasetRun.pipelines.length} pipelines
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                  {new Set(datasetRun.pipelines.map(p => p.model)).size} models
                                </Badge>
                              </div>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="ml-8 mt-2 space-y-2">
                                {datasetRun.pipelines.map((pipeline) => {
                                  const PipelineStatusIcon = statusIcons[pipeline.status];
                                  const pipelineConfig = runStatusConfig[pipeline.status];
                                  return (
                                    <div
                                      key={pipeline.id}
                                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                                    >
                                      <div className="flex items-center gap-3">
                                        <PipelineStatusIcon
                                          className={cn(
                                            "h-4 w-4",
                                            pipelineConfig.color,
                                            pipelineConfig.iconClass
                                          )}
                                        />
                                        <code className="text-xs bg-accent px-1.5 py-0.5 rounded">
                                          {pipeline.pipeline_name}
                                        </code>
                                        <Badge variant="outline" className="text-xs">{pipeline.model}</Badge>
                                        <Badge variant="secondary" className="text-xs">{pipeline.preprocessing}</Badge>
                                        <Badge variant="secondary" className="text-xs">{pipeline.split_strategy}</Badge>
                                      </div>
                                      <div className="flex items-center gap-4">
                                        {pipeline.status === "running" && (
                                          <div className="flex items-center gap-2 w-32">
                                            <Progress value={pipeline.progress} className="h-1.5" />
                                            <span className="text-xs text-muted-foreground">{pipeline.progress}%</span>
                                          </div>
                                        )}
                                        {(pipeline.val_score != null || pipeline.test_score != null) ? (
                                          <div className="flex gap-2 text-xs">
                                            {pipeline.val_score != null && (
                                              <span className="text-chart-1 font-mono">Val={pipeline.val_score.toFixed(3)}</span>
                                            )}
                                            {pipeline.test_score != null && (
                                              <span className="text-muted-foreground font-mono">Test={pipeline.test_score.toFixed(3)}</span>
                                            )}
                                          </div>
                                        ) : (
                                          pipeline.metrics && (pipeline.metrics.r2 != null || pipeline.metrics.rmse != null) && (
                                            <div className="flex gap-2 text-xs">
                                              {pipeline.metrics.r2 != null && <span className="text-chart-1 font-mono">R²={pipeline.metrics.r2.toFixed(3)}</span>}
                                              {pipeline.metrics.rmse != null && <span className="text-muted-foreground font-mono">RMSE={pipeline.metrics.rmse.toFixed(2)}</span>}
                                            </div>
                                          )
                                        )}
                                        {pipeline.status === "completed" && (
                                          <Link
                                            to={`/predictions?config=${encodeURIComponent(pipeline.pipeline_name)}&dataset=${encodeURIComponent(datasetRun.dataset_name)}`}
                                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Target className="h-3 w-3" />
                                            {t("predictions.title")}
                                          </Link>
                                        )}
                                        <Button variant="ghost" size="icon" className="h-7 w-7">
                                          <FileText className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })
        )}
      </div>

      {/* Quick Guide */}
      {runs.length > 0 && runs.every(r => r.status === "completed" || r.status === "failed") && (
        <Card className="border-dashed">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">{t("runs.guide.title")}</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  1
                </Badge>
                <div>
                  <p className="font-medium text-sm">{t("runs.guide.selectDatasets")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("runs.guide.selectDatasetsDesc")}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  2
                </Badge>
                <div>
                  <p className="font-medium text-sm">{t("runs.guide.choosePipelines")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("runs.guide.choosePipelinesDesc")}
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  3
                </Badge>
                <div>
                  <p className="font-medium text-sm">{t("runs.guide.configureAndLaunch")}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("runs.guide.configureAndLaunchDesc")}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <RunDetailSheet
        run={selectedRun}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  );
}
