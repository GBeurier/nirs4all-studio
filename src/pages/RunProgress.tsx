/**
 * RunProgress Page - Real-time run execution monitoring (Run A implementation)
 *
 * This page shows live progress for a single run with:
 * - Step-by-step pipeline visualization
 * - Real-time metrics as they become available
 * - Logs panel
 * - Model export options when complete
 */

import { useState, useEffect, useCallback, useRef } from "react";
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
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getRun, stopRun } from "@/api/client";
import { ReconnectingIndicator, ErrorState, LoadingState } from "@/components/ui/state-display";
import type { Run, RunStatus, PipelineRun, RunMetrics } from "@/types/runs";
import { runStatusConfig } from "@/types/runs";

// WebSocket message types
interface WsMessage {
  type: string;
  channel: string;
  data: {
    job_id?: string;
    progress?: number;
    message?: string;
    log?: string;
    level?: string;
    metrics?: Record<string, number>;
    result?: Record<string, unknown>;
    error?: string;
    // Granular progress fields
    log_context?: {
      fold_id?: number;
      total_folds?: number;
      branch_name?: string;
      variant_index?: number;
      total_variants?: number;
    };
    // Fold progress
    current_fold?: number;
    total_folds?: number;
    // Branch progress
    branch_path?: number[];
    branch_name?: string;
    // Variant progress
    current_variant?: number;
    total_variants?: number;
    variant_description?: string;
  };
  timestamp: string;
}

// Progress state interface for tracking current step
interface ProgressState {
  progress: number;
  message: string;
  timestamp: number;
}

// Granular progress state for fold/branch/variant tracking
interface GranularProgress {
  currentFold: number | null;
  totalFolds: number | null;
  currentBranch: string | null;
  currentVariant: number | null;
  totalVariants: number | null;
  variantDescription: string | null;
}

// WebSocket connection for real-time updates
function useRunWebSocket(
  runId: string,
  onUpdate: (data: WsMessage) => void,
  onLog: (log: string) => void,
  onProgress: (state: ProgressState) => void,
  onReconnecting: (attempt: number, maxAttempts: number) => void,
  onConnected: () => void
) {
  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 10;

    const connect = () => {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reconnectAttempts = 0;
          onConnected();
          // Subscribe to job channel
          ws?.send(JSON.stringify({
            type: "subscribe",
            channel: `job:${runId}`,
            data: {},
          }));
        };

        ws.onmessage = (event) => {
          try {
            const message: WsMessage = JSON.parse(event.data);
            if (message.channel === `job:${runId}` || message.channel === "system") {
              onUpdate(message);

              // Handle progress updates with step messages
              if (message.type === "job_progress" && message.data) {
                const { progress, message: stepMessage } = message.data;
                if (progress !== undefined || stepMessage) {
                  onProgress({
                    progress: progress ?? 0,
                    message: stepMessage || "",
                    timestamp: Date.now(),
                  });
                }
              }

              // Extract logs from progress messages
              if (message.data?.log) {
                onLog(message.data.log);
              }
              if (message.data?.message && message.type === "job_progress") {
                // Also log progress messages
                const progressMsg = `[INFO] ${message.data.message}`;
                if (!message.data.log) {
                  onLog(progressMsg);
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        };

        ws.onclose = () => {
          // Attempt reconnection with exponential backoff
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            onReconnecting(reconnectAttempts, maxReconnectAttempts);
            reconnectTimer = setTimeout(connect, delay);
          }
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
  }, [runId, onUpdate, onLog, onProgress, onReconnecting, onConnected]);
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
          {metrics.r2 != null && (
            <div>
              <div className="text-2xl font-bold text-chart-1">
                {(metrics.r2 * 100).toFixed(2)}%
              </div>
              <div className="text-xs text-muted-foreground">R² Score</div>
            </div>
          )}
          {metrics.rmse != null && (
            <div>
              <div className="text-2xl font-bold text-chart-2">
                {metrics.rmse.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">RMSE</div>
            </div>
          )}
          {metrics.mae != null && (
            <div>
              <div className="text-lg font-semibold">
                {metrics.mae.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">MAE</div>
            </div>
          )}
          {metrics.rpd != null && (
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

function PipelineProgress({
  pipeline,
  currentStepMessage,
  granularProgress,
}: {
  pipeline: PipelineRun;
  currentStepMessage?: string;
  granularProgress?: GranularProgress;
}) {
  const Icon = statusIcons[pipeline.status];
  const config = runStatusConfig[pipeline.status];
  const hasVariants = pipeline.has_generators || (pipeline.estimated_variants && pipeline.estimated_variants > 1);

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
                {/* Show model count breakdown */}
                {pipeline.model_count_breakdown && (
                  <>
                    <span>•</span>
                    <Badge variant="secondary" className="text-[10px] bg-blue-500/10 text-blue-500">
                      {pipeline.model_count_breakdown}
                    </Badge>
                  </>
                )}
                {/* Show variant count badge (fallback) */}
                {!pipeline.model_count_breakdown && hasVariants && (
                  <>
                    <span>•</span>
                    <Badge variant="secondary" className="text-[10px] bg-purple-500/10 text-purple-500">
                      {pipeline.tested_variants !== undefined
                        ? `${pipeline.tested_variants} variants tested`
                        : pipeline.estimated_variants !== undefined
                          ? `~${pipeline.estimated_variants} variants`
                          : "sweep"}
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </div>
          <StatusBadge status={pipeline.status} />
        </div>

        {/* Granular progress indicators for running pipelines */}
        {pipeline.status === "running" && granularProgress && (
          <div className="flex flex-wrap gap-2 mb-2">
            {granularProgress.currentFold != null && granularProgress.totalFolds != null && (
              <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-600 border-cyan-500/30">
                Fold {granularProgress.currentFold}/{granularProgress.totalFolds}
              </Badge>
            )}
            {granularProgress.currentBranch && (
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30">
                {granularProgress.currentBranch}
              </Badge>
            )}
            {granularProgress.currentVariant != null && granularProgress.totalVariants != null && (
              <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30">
                Variant {granularProgress.currentVariant}/{granularProgress.totalVariants}
              </Badge>
            )}
          </div>
        )}

        {/* Progress bar for running pipelines */}
        {pipeline.status === "running" && (
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[70%]">
                {currentStepMessage || (hasVariants
                  ? `Testing ${pipeline.estimated_variants ?? "multiple"} variants...`
                  : "Training...")}
              </span>
              <span>{pipeline.progress}%</span>
            </div>
            <Progress value={pipeline.progress} className="h-2" />
          </div>
        )}

        {/* Metrics for completed pipelines */}
        {pipeline.status === "completed" && pipeline.metrics && (pipeline.metrics.r2 != null || pipeline.metrics.rmse != null) && (
          <div className="flex items-center gap-4 text-sm">
            {pipeline.metrics.r2 != null && (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-chart-1" />
                <span className="font-mono">R² = {(pipeline.metrics.r2 * 100).toFixed(2)}%</span>
              </div>
            )}
            {pipeline.metrics.rmse != null && (
              <div className="text-muted-foreground font-mono">
                RMSE = {pipeline.metrics.rmse.toFixed(4)}
              </div>
            )}
            {/* Show best of N variants */}
            {pipeline.tested_variants && pipeline.tested_variants > 1 && (
              <div className="text-muted-foreground text-xs">
                (best of {pipeline.tested_variants})
              </div>
            )}
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

// Parse log entry for context indicators (fold, branch, variant)
function parseLogContext(log: string): { foldInfo?: string; branchInfo?: string; variantInfo?: string } {
  const result: { foldInfo?: string; branchInfo?: string; variantInfo?: string } = {};

  // Match fold patterns: "Fold 3/5", "fold 3 of 5"
  const foldMatch = log.match(/[Ff]old\s*(\d+)\s*[/of]+\s*(\d+)/i);
  if (foldMatch) {
    result.foldInfo = `F${foldMatch[1]}/${foldMatch[2]}`;
  }

  // Match branch patterns: "Branch [0]:", "Branch: SNV -> PLS"
  const branchMatch = log.match(/[Bb]ranch\s*\[?(\d+)\]?\s*[:|-]\s*([^,]+)/);
  if (branchMatch) {
    result.branchInfo = branchMatch[2].trim().substring(0, 20);
  }

  // Match variant patterns: "Variant 2/6", "Config 3 of 10"
  const variantMatch = log.match(/[Vv]ariant\s*(\d+)\s*[/of]+\s*(\d+)/i) ||
                       log.match(/[Cc]onfig(?:uration)?\s*(\d+)\s*[/of]+\s*(\d+)/i);
  if (variantMatch) {
    result.variantInfo = `V${variantMatch[1]}/${variantMatch[2]}`;
  }

  return result;
}

function LogsPanel({ logs, isLive }: { logs: string[]; isLive?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current && isLive) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isLive]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Terminal className="h-4 w-4" />
          Logs
          {isLive && (
            <Badge variant="outline" className="text-[10px] text-chart-2 border-chart-2/50 animate-pulse">
              Live
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground font-normal">
            {logs.length} entries
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64" ref={scrollRef}>
          <div className="font-mono text-xs space-y-0.5">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">Waiting for logs...</div>
            ) : (
              logs.map((log, i) => {
                const context = parseLogContext(log);
                const hasContext = context.foldInfo || context.branchInfo || context.variantInfo;

                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-center gap-1",
                      log.includes("[ERROR]") && "text-destructive",
                      log.includes("[WARN]") && "text-amber-500",
                      log.includes("[INFO]") && "text-muted-foreground"
                    )}
                  >
                    {/* Context badges */}
                    {hasContext && (
                      <span className="flex gap-0.5 shrink-0">
                        {context.foldInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-cyan-500/10 text-cyan-600">
                            {context.foldInfo}
                          </span>
                        )}
                        {context.branchInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-600 max-w-[60px] truncate">
                            {context.branchInfo}
                          </span>
                        )}
                        {context.variantInfo && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-violet-500/10 text-violet-600">
                            {context.variantInfo}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="truncate">{log}</span>
                  </div>
                );
              })
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
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const [wsReconnecting, setWsReconnecting] = useState<{ attempt: number; max: number } | null>(null);
  const [currentProgress, setCurrentProgress] = useState<ProgressState | null>(null);
  const [granularProgress, setGranularProgress] = useState<GranularProgress>({
    currentFold: null,
    totalFolds: null,
    currentBranch: null,
    currentVariant: null,
    totalVariants: null,
    variantDescription: null,
  });

  // Fetch run data with polling for active runs
  const { data: run, isLoading, error, refetch } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as Run | undefined;
      // Poll every 1 second for active runs (faster updates)
      if (data?.status === "running" || data?.status === "queued") {
        return 1000;
      }
      return false;
    },
  });

  // WebSocket updates
  const handleWsUpdate = useCallback(
    (message: WsMessage) => {
      // Invalidate query on WebSocket update to refresh data
      queryClient.invalidateQueries({ queryKey: ["run", runId] });

      // Handle completion - show toast
      if (message.type === "job_completed") {
        toast.success("Run completed successfully!");
      } else if (message.type === "job_failed") {
        toast.error(`Run failed: ${message.data?.error || "Unknown error"}`);
      }

      // Handle granular progress messages
      if (message.type === "fold_started" || message.type === "fold_completed") {
        setGranularProgress((prev) => ({
          ...prev,
          currentFold: message.data.current_fold ?? prev.currentFold,
          totalFolds: message.data.total_folds ?? prev.totalFolds,
        }));
      }

      if (message.type === "branch_entered" || message.type === "branch_exited") {
        setGranularProgress((prev) => ({
          ...prev,
          currentBranch: message.type === "branch_entered" ? message.data.branch_name ?? null : null,
        }));
      }

      if (message.type === "variant_started" || message.type === "variant_completed") {
        setGranularProgress((prev) => ({
          ...prev,
          currentVariant: message.data.current_variant ?? prev.currentVariant,
          totalVariants: message.data.total_variants ?? prev.totalVariants,
          variantDescription: message.data.variant_description ?? prev.variantDescription,
        }));
      }

      // Also extract from log_context if present
      if (message.data?.log_context) {
        const ctx = message.data.log_context;
        setGranularProgress((prev) => ({
          ...prev,
          currentFold: ctx.fold_id ?? prev.currentFold,
          totalFolds: ctx.total_folds ?? prev.totalFolds,
          currentBranch: ctx.branch_name ?? prev.currentBranch,
          currentVariant: ctx.variant_index ?? prev.currentVariant,
          totalVariants: ctx.total_variants ?? prev.totalVariants,
        }));
      }
    },
    [queryClient, runId]
  );

  // Handle streaming logs from WebSocket
  const handleStreamingLog = useCallback((log: string) => {
    setStreamingLogs((prev) => {
      // Avoid duplicates and limit log size
      if (prev.includes(log)) return prev;
      const newLogs = [...prev, log];
      return newLogs.slice(-100); // Keep last 100 logs
    });
  }, []);

  // Handle progress updates from WebSocket
  const handleProgress = useCallback((state: ProgressState) => {
    setCurrentProgress(state);
  }, []);

  // Handle WebSocket reconnecting
  const handleReconnecting = useCallback((attempt: number, maxAttempts: number) => {
    setWsReconnecting({ attempt, max: maxAttempts });
  }, []);

  // Handle WebSocket connected
  const handleConnected = useCallback(() => {
    setWsReconnecting(null);
  }, []);

  useRunWebSocket(runId || "", handleWsUpdate, handleStreamingLog, handleProgress, handleReconnecting, handleConnected);

  // Reset streaming logs and progress when run changes
  useEffect(() => {
    setStreamingLogs([]);
    setCurrentProgress(null);
    setGranularProgress({
      currentFold: null,
      totalFolds: null,
      currentBranch: null,
      currentVariant: null,
      totalVariants: null,
      variantDescription: null,
    });
  }, [runId]);

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
      <div className="p-6">
        <LoadingState message="Loading run details..." />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-6">
        <ErrorState
          title="Run Not Found"
          message={
            error instanceof Error
              ? error.message
              : "The run you're looking for doesn't exist or has been deleted."
          }
          onRetry={() => refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline">
            <Link to="/runs">Back to Runs</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Aggregate pipeline info
  const allPipelines = run.datasets.flatMap(d => d.pipelines);
  const completedCount = allPipelines.filter(p => p.status === "completed").length;
  const failedCount = allPipelines.filter(p => p.status === "failed").length;
  const runningPipeline = allPipelines.find(p => p.status === "running");

  // Calculate overall progress more accurately
  // Use running pipeline progress + completed pipelines
  const baseProgress = run.total_pipelines
    ? (completedCount / run.total_pipelines) * 100
    : 0;
  const runningProgress = runningPipeline?.progress || 0;
  const runningContribution = run.total_pipelines
    ? (runningProgress / 100) * (100 / run.total_pipelines)
    : 0;
  const overallProgress = baseProgress + runningContribution;

  // Collect all logs - combine persisted logs with streaming logs
  const persistedLogs = allPipelines.flatMap(p => p.logs || []);
  // Merge logs, avoiding duplicates, with streaming logs at the end
  const allLogs = [...new Set([...persistedLogs, ...streamingLogs])];

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

      {/* WebSocket reconnecting indicator */}
      {wsReconnecting && (run.status === "running" || run.status === "queued") && (
        <ReconnectingIndicator
          message="Connection lost. Reconnecting..."
          attempt={wsReconnecting.attempt}
          maxAttempts={wsReconnecting.max}
        />
      )}

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
                <PipelineProgress
                  key={pipeline.id}
                  pipeline={pipeline}
                  currentStepMessage={pipeline.status === "running" ? currentProgress?.message : undefined}
                  granularProgress={pipeline.status === "running" ? granularProgress : undefined}
                />
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
          <LogsPanel logs={allLogs} isLive={run.status === "running"} />

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
