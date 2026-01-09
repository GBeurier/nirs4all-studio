/**
 * RunProgress Page - Real-time run execution monitoring (Run A implementation)
 *
 * This page shows live progress for a single run with:
 * - Step-by-step pipeline visualization
 * - Real-time metrics as they become available
 * - Logs panel
 * - Model export options when complete
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowLeft,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  Loader2,
  Database,
  Layers,
  BarChart3,
  Download,
  FileCode,
  Terminal,
  Target,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getRun, stopRun } from "@/api/client";
import type { Run, RunStatus, PipelineRun, RunMetrics } from "@/types/runs";
import { runStatusConfig } from "@/types/runs";

// WebSocket connection for real-time updates
function useRunWebSocket(runId: string, onUpdate: (data: unknown) => void) {
  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          // Subscribe to job channel
          ws?.send(JSON.stringify({
            type: "subscribe",
            channel: `job:${runId}`,
            data: {},
          }));
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            if (message.channel === `job:${runId}` || message.channel === "system") {
              onUpdate(message);
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          // Attempt reconnection after 3 seconds
          reconnectTimer = setTimeout(connect, 3000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available
      }
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, [runId, onUpdate]);
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Clock,
  partial: AlertCircle,
};

function StatusBadge({ status }: { status: RunStatus }) {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  return (
    <Badge variant="secondary" className={cn("gap-1.5", config.bg)}>
      <Icon className={cn("h-3.5 w-3.5", config.color, config.iconClass)} />
      {config.label}
    </Badge>
  );
}

function MetricsCard({ metrics, label }: { metrics?: RunMetrics; label: string }) {
  if (!metrics) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-2xl font-bold text-chart-1">
              {(metrics.r2 * 100).toFixed(2)}%
            </div>
            <div className="text-xs text-muted-foreground">R² Score</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-chart-2">
              {metrics.rmse.toFixed(4)}
            </div>
            <div className="text-xs text-muted-foreground">RMSE</div>
          </div>
          {metrics.mae && (
            <div>
              <div className="text-lg font-semibold">
                {metrics.mae.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">MAE</div>
            </div>
          )}
          {metrics.rpd && (
            <div>
              <div className="text-lg font-semibold">
                {metrics.rpd.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">RPD</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineProgress({ pipeline }: { pipeline: PipelineRun }) {
  const Icon = statusIcons[pipeline.status];
  const config = runStatusConfig[pipeline.status];

  return (
    <Card className={cn(
      "transition-all",
      pipeline.status === "running" && "border-chart-2/50 shadow-sm"
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", config.bg)}>
              <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />
            </div>
            <div>
              <h4 className="font-medium">{pipeline.pipeline_name}</h4>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{pipeline.model}</Badge>
                <span>•</span>
                <span>{pipeline.preprocessing}</span>
              </div>
            </div>
          </div>
          <StatusBadge status={pipeline.status} />
        </div>

        {/* Progress bar for running pipelines */}
        {pipeline.status === "running" && (
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Training...</span>
              <span>{pipeline.progress}%</span>
            </div>
            <Progress value={pipeline.progress} className="h-2" />
          </div>
        )}

        {/* Metrics for completed pipelines */}
        {pipeline.status === "completed" && pipeline.metrics && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-chart-1" />
              <span className="font-mono">R² = {(pipeline.metrics.r2 * 100).toFixed(2)}%</span>
            </div>
            <div className="text-muted-foreground font-mono">
              RMSE = {pipeline.metrics.rmse.toFixed(4)}
            </div>
          </div>
        )}

        {/* Error message for failed pipelines */}
        {pipeline.status === "failed" && pipeline.error_message && (
          <div className="text-sm text-destructive mt-2">
            {pipeline.error_message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogsPanel({ logs }: { logs: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-48">
          <div className="font-mono text-xs space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
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
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function RunProgress() {
  const { id: runId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isStopping, setIsStopping] = useState(false);

  // Fetch run data with polling for active runs
  const { data: run, isLoading, error } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as Run | undefined;
      // Poll every 2 seconds for active runs
      if (data?.status === "running" || data?.status === "queued") {
        return 2000;
      }
      return false;
    },
  });

  // WebSocket updates
  const handleWsUpdate = useCallback(
    (message: unknown) => {
      // Invalidate query on WebSocket update
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
    },
    [queryClient, runId]
  );

  useRunWebSocket(runId || "", handleWsUpdate);

  // Stop run handler
  const handleStop = async () => {
    if (!runId) return;
    setIsStopping(true);
    try {
      await stopRun(runId);
      toast.success("Run stopped");
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
    } catch (err) {
      toast.error("Failed to stop run");
    } finally {
      setIsStopping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Run Not Found</h2>
            <p className="text-muted-foreground mb-4">
              The run you're looking for doesn't exist or has been deleted.
            </p>
            <Button asChild>
              <Link to="/runs">Back to Runs</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Aggregate pipeline info
  const allPipelines = run.datasets.flatMap(d => d.pipelines);
  const completedCount = allPipelines.filter(p => p.status === "completed").length;
  const failedCount = allPipelines.filter(p => p.status === "failed").length;
  const runningPipeline = allPipelines.find(p => p.status === "running");
  const overallProgress = run.total_pipelines
    ? (completedCount / run.total_pipelines) * 100
    : 0;

  // Collect all logs
  const allLogs = allPipelines.flatMap(p => p.logs || []);

  // Get best metrics from completed pipelines
  const completedPipelines = allPipelines.filter(p => p.status === "completed" && p.metrics);
  const bestPipeline = completedPipelines.length > 0
    ? completedPipelines.reduce((best, p) =>
        (p.metrics?.r2 ?? 0) > (best.metrics?.r2 ?? 0) ? p : best
      )
    : null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
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
          {(run.status === "running" || run.status === "queued") && (
            <Button
              variant="destructive"
              onClick={handleStop}
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
          {run.status === "completed" && (
            <>
              <Button variant="outline" asChild>
                <Link to={`/predictions?run=${run.id}`}>
                  <Target className="h-4 w-4 mr-2" />
                  Predict
                </Link>
              </Button>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress overview for running runs */}
      {(run.status === "running" || run.status === "queued") && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <span>
                  Pipeline {completedCount + 1} of {run.total_pipelines}
                </span>
                {runningPipeline && (
                  <Badge variant="secondary" className="text-xs">
                    {runningPipeline.pipeline_name}
                  </Badge>
                )}
              </div>
              <span className="text-sm font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-3" />
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{run.datasets.length}</p>
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
              <p className="text-2xl font-bold">{run.total_pipelines || 0}</p>
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

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipelines column */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">Pipelines</h2>
          {run.datasets.map(dataset => (
            <div key={dataset.dataset_id} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                {dataset.dataset_name}
              </div>
              {dataset.pipelines.map(pipeline => (
                <PipelineProgress key={pipeline.id} pipeline={pipeline} />
              ))}
            </div>
          ))}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Best result */}
          {bestPipeline && bestPipeline.metrics && (
            <MetricsCard
              metrics={bestPipeline.metrics}
              label={`Best: ${bestPipeline.pipeline_name}`}
            />
          )}

          {/* Logs */}
          <LogsPanel logs={allLogs} />

          {/* Run info */}
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
        </div>
      </div>
    </div>
  );
}
