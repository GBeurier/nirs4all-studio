import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { Link } from "react-router-dom";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { RunDetailSheet } from "@/components/runs/RunDetailSheet";
import { Run, DatasetRun, PipelineRun, RunStatus, runStatusConfig } from "@/types/runs";
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
};

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return "Unknown";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

/**
 * Convert discovered runs from workspace to the Run type used by the UI.
 * Groups runs by config_name (run name) and creates pipelines for each.
 */
function convertDiscoveredRunsToRuns(discoveredRuns: DiscoveredRun[]): Run[] {
  // Group by config_name/name - each discovered run represents a pipeline execution
  const runMap = new Map<string, Run>();

  for (const dr of discoveredRuns) {
    const runId = dr.name || dr.id;

    if (!runMap.has(runId)) {
      // Create new run
      runMap.set(runId, {
        id: runId,
        name: dr.name || dr.id,
        status: "completed" as RunStatus, // Discovered runs are historical/completed
        created_at: dr.created_at || new Date().toISOString(),
        datasets: [],
      });
    }

    const run = runMap.get(runId)!;

    // Find or create the dataset entry
    let datasetRun = run.datasets.find(d => d.dataset_id === dr.dataset);
    if (!datasetRun) {
      datasetRun = {
        dataset_id: dr.dataset,
        dataset_name: dr.dataset,
        pipelines: [],
      };
      run.datasets.push(datasetRun);
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
      metrics: dr.best_val_score != null || dr.best_test_score != null ? {
        r2: dr.best_val_score ?? dr.best_test_score ?? 0,
        rmse: 0, // Not available in discovered runs
      } : undefined,
    };

    datasetRun.pipelines.push(pipeline);
  }

  return Array.from(runMap.values());
}

export default function Runs() {
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

    return [...activeRuns, ...uniqueHistoricalRuns];
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
  const runningCount = statsData?.running ?? runs.filter(r => r.status === "running").length;
  const queuedCount = statsData?.queued ?? runs.filter(r => r.status === "queued").length;
  const completedCount = statsData?.completed ?? runs.filter(r => r.status === "completed").length;
  const failedCount = statsData?.failed ?? runs.filter(r => r.status === "failed").length;
  const totalPipelines = statsData?.total_pipelines ?? runs.reduce((acc, r) => acc + r.datasets.reduce((a, d) => a + d.pipelines.length, 0), 0);

  const hasActiveWorkspace = !!activeWorkspaceId;

  const computeRunStats = (run: Run) => {
    const pipelineCount = run.datasets.reduce((acc, d) => acc + d.pipelines.length, 0);
    const models = new Set(run.datasets.flatMap(d => d.pipelines.map(p => p.model)));
    const completedPipelines = run.datasets.flatMap(d => d.pipelines).filter(p => p.status === "completed").length;
    return { pipelineCount, modelCount: models.size, completedPipelines };
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
          <h1 className="text-2xl font-bold text-foreground">Runs</h1>
          <p className="text-muted-foreground">Track and monitor active and historical pipeline executions</p>
        </div>
        <Button asChild>
          <Link to="/runs/new">
            <Plus className="h-4 w-4 mr-2" />
            New Run
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
              <p className="text-sm text-muted-foreground">Running</p>
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
              <p className="text-sm text-muted-foreground">Queued</p>
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
              <p className="text-sm text-muted-foreground">Completed</p>
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
              <p className="text-sm text-muted-foreground">Failed</p>
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
              <p className="text-sm text-muted-foreground">Total Pipelines</p>
              <p className="text-2xl font-bold text-foreground">{totalPipelines}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Runs List */}
      <div className="space-y-4">
        {isLoading ? (
          // Loading skeleton
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-8 w-24" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !hasActiveWorkspace ? (
          // No workspace linked
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/50 mb-4">
                  <FolderOpen className="h-10 w-10 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  No workspace linked
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  Link a nirs4all workspace to see your runs and training results.
                  Go to Settings to link a workspace directory.
                </p>
                <Button asChild variant="outline">
                  <Link to="/settings">
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Link Workspace
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="p-12">
              <div className="flex flex-col items-center justify-center text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mb-4">
                  <Play className="h-10 w-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  No runs yet
                </h3>
                <p className="text-muted-foreground max-w-md mb-6">
                  Start a new run to train models on your datasets using your
                  configured pipelines. Track progress and monitor execution.
                </p>
                <Button asChild>
                  <Link to="/runs/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Start New Run
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          runs.map((run) => {
            const StatusIcon = statusIcons[run.status];
            const config = runStatusConfig[run.status];
            const { pipelineCount, modelCount, completedPipelines } = computeRunStats(run);
            const isExpanded = expandedRuns.has(run.id);
            const progress = getRunProgress(run);

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
                            <h3 className="font-semibold text-foreground">{run.name}</h3>
                            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Database className="h-3.5 w-3.5" />
                                {run.datasets.length} datasets
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Layers className="h-3.5 w-3.5" />
                                {pipelineCount} pipelines
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Box className="h-3.5 w-3.5" />
                                {modelCount} models
                              </span>
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
                            <div>{formatTimeAgo(run.created_at)}</div>
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
                                Results
                              </Link>
                            </Button>
                          )}
                          {run.status === "failed" && (
                            <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                              <RefreshCw className="h-4 w-4 mr-2" />
                              Retry
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => openRunDetails(run, e)}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Details
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-0 space-y-3">
                      {/* Error message for failed runs */}
                      {run.status === "failed" && (
                        <div className="p-3 rounded-lg bg-destructive/10 text-sm text-destructive">
                          Error: {run.datasets.flatMap(d => d.pipelines).find(p => p.error_message)?.error_message || "Unknown error"}
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
                                        {pipeline.metrics && (
                                          <div className="flex gap-2 text-xs">
                                            <span className="text-chart-1 font-mono">R²={pipeline.metrics.r2.toFixed(3)}</span>
                                            <span className="text-muted-foreground font-mono">RMSE={pipeline.metrics.rmse.toFixed(2)}</span>
                                          </div>
                                        )}
                                        {pipeline.status === "completed" && (
                                          <Link
                                            to={`/predictions?config=${encodeURIComponent(pipeline.pipeline_name)}&dataset=${encodeURIComponent(datasetRun.dataset_name)}`}
                                            className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Target className="h-3 w-3" />
                                            Predictions
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
            <h3 className="font-semibold mb-4">How to start a new run</h3>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  1
                </Badge>
                <div>
                  <p className="font-medium text-sm">Select Dataset(s)</p>
                  <p className="text-xs text-muted-foreground">
                    Choose one or more datasets for training
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  2
                </Badge>
                <div>
                  <p className="font-medium text-sm">Choose Pipeline(s)</p>
                  <p className="text-xs text-muted-foreground">
                    Select pipelines to run on each dataset
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Badge className="h-6 w-6 rounded-full flex items-center justify-center shrink-0">
                  3
                </Badge>
                <div>
                  <p className="font-medium text-sm">Configure & Launch</p>
                  <p className="text-xs text-muted-foreground">
                    Set options and start the experiment
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
