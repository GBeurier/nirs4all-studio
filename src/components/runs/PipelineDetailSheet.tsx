import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  Clock,
  RefreshCw,
  AlertCircle,
  Pause,
  CircleDashed,
  Database,
  BarChart3,
  Download,
  Terminal,
  ExternalLink,
  Target,
  TrendingUp,
  Wrench,
  Box,
  GitBranch,
  FileJson,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PipelineRun, RunStatus, runStatusConfig } from "@/types/runs";

interface PipelineDetailSheetProps {
  pipeline: PipelineRun | null;
  datasetName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusIcons = {
  queued: Clock,
  running: RefreshCw,
  completed: CheckCircle2,
  failed: AlertCircle,
  paused: Pause,
  partial: CircleDashed,
};

const StatusIcon = ({ status }: { status: RunStatus }) => {
  const Icon = statusIcons[status];
  const config = runStatusConfig[status];
  return (
    <Icon className={cn("h-4 w-4", config.color, config.iconClass)} />
  );
};

// Mock logs for pipeline execution
const getMockLogs = (pipeline: PipelineRun): string[] => {
  if (pipeline.status === "queued") return ["[INFO] Waiting in queue..."];
  if (pipeline.status === "failed") {
    return [
      "[INFO] Starting pipeline execution...",
      "[INFO] Loading dataset...",
      "[INFO] Dataset loaded: 250 samples, 1024 features",
      "[INFO] Applying SNV preprocessing...",
      "[ERROR] Failed to process spectrum at index 142",
      "[ERROR] ValueError: Invalid spectrum values detected",
      "[ERROR] Pipeline execution failed",
    ];
  }
  return [
    "[INFO] Starting pipeline execution...",
    "[INFO] Loading dataset...",
    "[INFO] Dataset loaded: 250 samples, 1024 features",
    `[INFO] Applying ${pipeline.preprocessing} preprocessing...`,
    "[INFO] Preprocessing complete",
    `[INFO] Training ${pipeline.model} model...`,
    `[INFO] Using ${pipeline.split_strategy} validation strategy`,
    "[INFO] Model training complete",
    pipeline.status === "running"
      ? `[INFO] Cross-validation in progress... ${pipeline.progress}%`
      : `[INFO] Final R² score: ${pipeline.metrics?.r2?.toFixed(4)}`,
  ];
};

export function PipelineDetailSheet({ pipeline, datasetName, open, onOpenChange }: PipelineDetailSheetProps) {
  const [activeTab, setActiveTab] = useState("results");
  const [copied, setCopied] = useState(false);

  if (!pipeline) return null;

  const logs = getMockLogs(pipeline);

  // Build pipeline JSON for display
  const pipelineJson = JSON.stringify({
    name: pipeline.pipeline_name,
    model: pipeline.model,
    preprocessing: pipeline.preprocessing,
    split_strategy: pipeline.split_strategy,
    status: pipeline.status,
    metrics: pipeline.metrics,
    started_at: pipeline.started_at,
    completed_at: pipeline.completed_at,
  }, null, 2);

  const handleCopyJson = async () => {
    await navigator.clipboard.writeText(pipelineJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-hidden flex flex-col">
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={cn("p-2 rounded-lg", runStatusConfig[pipeline.status].bg)}>
                <StatusIcon status={pipeline.status} />
              </div>
              <div>
                <SheetTitle className="text-lg">Pipeline Details</SheetTitle>
                <SheetDescription className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-medium text-foreground">
                    {pipeline.pipeline_name}
                  </span>
                </SheetDescription>
              </div>
            </div>
            <Badge variant={pipeline.status === "completed" ? "default" : "secondary"}>
              {runStatusConfig[pipeline.status].label}
            </Badge>
          </div>

          {/* Progress bar for running */}
          {pipeline.status === "running" && (
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span className="font-medium">{pipeline.progress}%</span>
              </div>
              <Progress value={pipeline.progress} className="h-2" />
            </div>
          )}

          {/* Dataset link */}
          <div className="mt-4 p-3 rounded-lg bg-muted/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">{datasetName}</span>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/datasets/${encodeURIComponent(datasetName)}`}>
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                View Dataset
              </Link>
            </Button>
          </div>

          {/* Quick Stats - Model, Preprocessing, Split */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Box className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{pipeline.model}</p>
              <p className="text-xs text-muted-foreground">Model</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <Wrench className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{pipeline.preprocessing}</p>
              <p className="text-xs text-muted-foreground">Preprocessing</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 text-center">
              <GitBranch className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
              <p className="text-sm font-semibold">{pipeline.split_strategy}</p>
              <p className="text-xs text-muted-foreground">Split</p>
            </div>
          </div>
        </SheetHeader>

        <Separator className="my-4" />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid w-full grid-cols-3 flex-shrink-0">
            <TabsTrigger value="results" className="text-xs">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="json" className="text-xs">
              <FileJson className="h-3.5 w-3.5 mr-1.5" />
              JSON
            </TabsTrigger>
            <TabsTrigger value="logs" className="text-xs">
              <Terminal className="h-3.5 w-3.5 mr-1.5" />
              Logs
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 mt-4">
            {/* Results/Metrics Tab */}
            <TabsContent value="results" className="m-0 space-y-4">
              {pipeline.metrics ? (
                <>
                  {/* Metrics Cards - Similar to Predictions page */}
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard
                      label="R² Score"
                      value={pipeline.metrics.r2}
                      format={4}
                      icon={<Target className="h-4 w-4" />}
                      variant="primary"
                    />
                    {pipeline.metrics.rmse > 0 && (
                      <MetricCard
                        label="RMSE"
                        value={pipeline.metrics.rmse}
                        format={4}
                        icon={<TrendingUp className="h-4 w-4" />}
                        variant="secondary"
                      />
                    )}
                    {pipeline.metrics.mae !== undefined && (
                      <MetricCard
                        label="MAE"
                        value={pipeline.metrics.mae}
                        format={4}
                        icon={<BarChart3 className="h-4 w-4" />}
                      />
                    )}
                    {pipeline.metrics.rpd !== undefined && (
                      <MetricCard
                        label="RPD"
                        value={pipeline.metrics.rpd}
                        format={2}
                        icon={<TrendingUp className="h-4 w-4" />}
                      />
                    )}
                    {pipeline.metrics.nrmse !== undefined && (
                      <MetricCard
                        label="nRMSE"
                        value={pipeline.metrics.nrmse}
                        format={4}
                        icon={<BarChart3 className="h-4 w-4" />}
                      />
                    )}
                  </div>

                  {/* Timestamps */}
                  {(pipeline.started_at || pipeline.completed_at) && (
                    <div className="p-3 rounded-lg border">
                      <h4 className="font-medium text-sm mb-2 flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        Execution Times
                      </h4>
                      <div className="space-y-2 text-sm">
                        {pipeline.started_at && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Started</span>
                            <span>{pipeline.started_at}</span>
                          </div>
                        )}
                        {pipeline.completed_at && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Completed</span>
                            <span>{pipeline.completed_at}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Links to related data - discrete small links */}
                  <div className="flex items-center gap-3 pt-2 text-xs">
                    <Link
                      to={`/predictions?dataset=${encodeURIComponent(datasetName)}&config=${encodeURIComponent(pipeline.pipeline_name)}`}
                      className="text-muted-foreground hover:text-primary flex items-center gap-1"
                    >
                      <Target className="h-3 w-3" />
                      Predictions
                    </Link>
                    <Link
                      to="/results"
                      className="text-muted-foreground hover:text-primary flex items-center gap-1"
                    >
                      <BarChart3 className="h-3 w-3" />
                      Results
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">
                    {pipeline.status === "running"
                      ? "Results will appear when training completes"
                      : pipeline.status === "queued"
                      ? "Waiting to start..."
                      : "No results available"}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {pipeline.status === "failed" && pipeline.error_message && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <h4 className="font-medium text-sm text-destructive mb-2 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    Error
                  </h4>
                  <p className="text-sm text-destructive/80">{pipeline.error_message}</p>
                </div>
              )}
            </TabsContent>

            {/* JSON Tab */}
            <TabsContent value="json" className="m-0 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pipeline Configuration</span>
                <Button variant="outline" size="sm" onClick={handleCopyJson}>
                  {copied ? (
                    <Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs max-h-96 overflow-auto">
                <pre className="whitespace-pre-wrap break-words text-muted-foreground">
                  {pipelineJson}
                </pre>
              </div>
            </TabsContent>

            {/* Logs Tab */}
            <TabsContent value="logs" className="m-0 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Execution Logs</span>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download
                </Button>
              </div>

              <div className="rounded-lg border bg-muted/20 p-4 font-mono text-xs space-y-1 max-h-80 overflow-auto">
                {logs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      log.includes("[ERROR]") && "text-destructive",
                      log.includes("[INFO]") && "text-muted-foreground"
                    )}
                  >
                    {log}
                  </div>
                ))}
                {pipeline.status === "running" && (
                  <div className="flex items-center gap-2 text-chart-2">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Processing...</span>
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Metric card component similar to Predictions page
 */
function MetricCard({
  label,
  value,
  format = 4,
  icon,
  variant = "default",
}: {
  label: string;
  value: number;
  format?: number;
  icon?: React.ReactNode;
  variant?: "default" | "primary" | "secondary";
}) {
  const bgClass = variant === "primary"
    ? "bg-chart-1/10 border-chart-1/20"
    : variant === "secondary"
    ? "bg-chart-2/10 border-chart-2/20"
    : "bg-muted/30";
  const textClass = variant === "primary"
    ? "text-chart-1"
    : variant === "secondary"
    ? "text-chart-2"
    : "text-foreground";

  return (
    <div className={cn("p-3 rounded-lg border", bgClass)}>
      <div className="flex items-center gap-2 mb-1">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className={cn("text-xl font-bold", textClass)}>
        {value.toFixed(format)}
      </p>
    </div>
  );
}
