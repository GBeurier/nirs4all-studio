/**
 * PipelineExecutionDialog - Execute pipeline with real-time progress tracking.
 *
 * Phase 6 Implementation:
 * - Dataset selection
 * - Real-time progress via WebSocket
 * - Result visualization
 * - Export options (Python, YAML, JSON)
 *
 * Run A Enhancement:
 * - Quick Run option that navigates to /runs/{id} for progress tracking
 * - Persisted runs with model export
 */

import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Square,
  Check,
  X,
  AlertCircle,
  Download,
  Copy,
  FileCode,
  FileJson,
  FileText,
  Loader2,
  Database,
  TrendingUp,
  Trophy,
  Wifi,
  WifiOff,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import {
  usePipelineExecution,
  usePipelineExport,
  useDatasetSelection,
  ExecutionStatus,
  ExecutionResult,
  ExportResult,
} from "@/hooks/usePipelineExecution";
import { quickRun } from "@/api/client";

// ============================================================================
// Types
// ============================================================================

export interface PipelineExecutionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  variantCount?: number;
}

// ============================================================================
// Subcomponents
// ============================================================================

/** Connection status indicator */
function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs",
        connected ? "text-emerald-500" : "text-amber-500"
      )}
    >
      {connected ? (
        <>
          <Wifi className="h-3 w-3" />
          <span>Connected</span>
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          <span>Connecting...</span>
        </>
      )}
    </div>
  );
}

/** Status badge with animation */
function StatusBadge({ status }: { status: ExecutionStatus }) {
  const variants: Record<
    ExecutionStatus,
    { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Play }
  > = {
    idle: { label: "Ready", variant: "secondary", icon: Play },
    starting: { label: "Starting...", variant: "default", icon: Loader2 },
    running: { label: "Running", variant: "default", icon: Loader2 },
    completed: { label: "Completed", variant: "default", icon: Check },
    failed: { label: "Failed", variant: "destructive", icon: X },
    cancelled: { label: "Cancelled", variant: "secondary", icon: Square },
  };

  const config = variants[status];
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="gap-1.5">
      <Icon
        className={cn(
          "h-3 w-3",
          (status === "starting" || status === "running") && "animate-spin"
        )}
      />
      {config.label}
    </Badge>
  );
}

/** Progress display with percentage and message */
function ProgressDisplay({
  progress,
  message,
}: {
  progress: number;
  message: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{message || "Processing..."}</span>
        <span className="font-medium">{Math.round(progress)}%</span>
      </div>
      <Progress value={progress} className="h-2" />
    </div>
  );
}

/** Results display after execution completes */
function ResultsDisplay({ result }: { result: ExecutionResult }) {
  if (!result.success) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
          <div>
            <h4 className="font-medium text-destructive">Execution Failed</h4>
            <p className="text-sm text-muted-foreground mt-1">{result.error}</p>
            {result.traceback && (
              <ScrollArea className="h-24 mt-2">
                <pre className="text-xs text-muted-foreground font-mono bg-muted p-2 rounded">
                  {result.traceback}
                </pre>
              </ScrollArea>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Metrics summary */}
      {result.metrics && Object.keys(result.metrics).length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {result.metrics.rmse !== undefined && (
            <div className="rounded-lg border bg-card p-3 text-center">
              <div className="text-2xl font-bold text-emerald-500">
                {result.metrics.rmse.toFixed(4)}
              </div>
              <div className="text-xs text-muted-foreground">RMSE</div>
            </div>
          )}
          {result.metrics.r2 !== undefined && (
            <div className="rounded-lg border bg-card p-3 text-center">
              <div className="text-2xl font-bold text-blue-500">
                {(result.metrics.r2 * 100).toFixed(2)}%
              </div>
              <div className="text-xs text-muted-foreground">R²</div>
            </div>
          )}
          {result.variantsTested !== undefined && (
            <div className="rounded-lg border bg-card p-3 text-center">
              <div className="text-2xl font-bold text-purple-500">
                {result.variantsTested}
              </div>
              <div className="text-xs text-muted-foreground">Variants</div>
            </div>
          )}
        </div>
      )}

      {/* Top results */}
      {result.topResults && result.topResults.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            Top Results
          </h4>
          <div className="rounded-lg border divide-y">
            {result.topResults.slice(0, 5).map((r) => (
              <div
                key={r.rank}
                className="flex items-center justify-between p-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="w-6 justify-center">
                    {r.rank}
                  </Badge>
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    {r.config || "Configuration"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {r.rmse !== undefined && (
                    <span>RMSE: {r.rmse.toFixed(4)}</span>
                  )}
                  {r.r2 !== undefined && (
                    <span>R²: {(r.r2 * 100).toFixed(2)}%</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model path */}
      {result.modelPath && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-emerald-500" />
          Model saved to: <code className="text-xs bg-muted px-1 py-0.5 rounded">{result.modelPath}</code>
        </div>
      )}
    </div>
  );
}

/** Export panel with format options */
function ExportPanel({
  pipelineId,
  pipelineName,
}: {
  pipelineId: string;
  pipelineName: string;
}) {
  const { isExporting, exportPipeline, downloadExport, copyToClipboard } =
    usePipelineExport();
  const [lastExport, setLastExport] = useState<ExportResult | null>(null);

  const handleExport = async (format: "python" | "yaml" | "json") => {
    const result = await exportPipeline(pipelineId, { format });
    if (result) {
      setLastExport(result);
      toast.success(`Exported as ${format.toUpperCase()}`);
    }
  };

  const handleDownload = () => {
    if (lastExport) {
      downloadExport(lastExport);
      toast.success("File downloaded");
    }
  };

  const handleCopy = async () => {
    if (lastExport) {
      const success = await copyToClipboard(lastExport);
      if (success) {
        toast.success("Copied to clipboard");
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("python")}
          disabled={isExporting}
        >
          <FileCode className="h-4 w-4 mr-2" />
          Python
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("yaml")}
          disabled={isExporting}
        >
          <FileText className="h-4 w-4 mr-2" />
          YAML
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleExport("json")}
          disabled={isExporting}
        >
          <FileJson className="h-4 w-4 mr-2" />
          JSON
        </Button>
      </div>

      {lastExport && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{lastExport.filename}</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ScrollArea className="h-48 rounded-lg border bg-muted">
            <pre className="p-3 text-xs font-mono">{lastExport.content}</pre>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PipelineExecutionDialog({
  open,
  onOpenChange,
  pipelineId,
  pipelineName,
  variantCount,
}: PipelineExecutionDialogProps) {
  const navigate = useNavigate();
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"execute" | "export">("execute");
  const [isQuickRunning, setIsQuickRunning] = useState(false);

  // Hooks
  const { datasets, isLoading: isLoadingDatasets } = useDatasetSelection();
  const {
    status,
    jobId,
    isConnected,
    progress,
    progressMessage,
    result,
    error,
    execute,
    cancel,
    reset,
  } = usePipelineExecution();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      reset();
      setActiveTab("execute");
      setIsQuickRunning(false);
    }
  }, [open, reset]);

  // Handle execution (inline mode)
  const handleExecute = async () => {
    if (!selectedDataset) {
      toast.error("Please select a dataset");
      return;
    }

    await execute({
      pipelineId,
      datasetId: selectedDataset,
      exportModel: true,
    });
  };

  // Handle Quick Run (navigates to progress page)
  const handleQuickRun = async () => {
    if (!selectedDataset) {
      toast.error("Please select a dataset");
      return;
    }

    setIsQuickRunning(true);
    try {
      const run = await quickRun({
        pipeline_id: pipelineId,
        dataset_id: selectedDataset,
        name: `${pipelineName} Run`,
        export_model: true,
        cv_folds: 5,
      });

      toast.success("Run started! Redirecting to progress page...");
      onOpenChange(false);
      navigate(`/runs/${run.id}`);
    } catch (err) {
      toast.error("Failed to start run");
      setIsQuickRunning(false);
    }
  };

  // Can close if not running
  const canClose = status !== "running" && status !== "starting" && !isQuickRunning;

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : undefined}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              {pipelineName}
            </DialogTitle>
            <div className="flex items-center gap-3">
              {jobId && <ConnectionIndicator connected={isConnected} />}
              <StatusBadge status={status} />
            </div>
          </div>
          <DialogDescription>
            Execute this pipeline against a dataset.
            {variantCount && variantCount > 1 && (
              <span className="ml-1 text-purple-500">
                ({variantCount} variants to test)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "execute" | "export")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="execute">Execute</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="execute" className="space-y-4 mt-4">
            {/* Dataset selection */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Database className="h-4 w-4" />
                Dataset
              </label>
              <Select
                value={selectedDataset}
                onValueChange={setSelectedDataset}
                disabled={status === "running" || status === "starting"}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a dataset..." />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingDatasets ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      Loading...
                    </div>
                  ) : datasets.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground">
                      No datasets available
                    </div>
                  ) : (
                    datasets.map((ds) => (
                      <SelectItem key={ds.id} value={ds.id}>
                        <div className="flex items-center gap-2">
                          <span>{ds.name}</span>
                          {ds.numSamples && (
                            <span className="text-xs text-muted-foreground">
                              ({ds.numSamples} samples)
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Progress display */}
            <AnimatePresence mode="wait">
              {(status === "running" || status === "starting") && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <ProgressDisplay
                    progress={progress}
                    message={progressMessage}
                  />
                </motion.div>
              )}

              {status === "completed" && result && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <ResultsDisplay result={result} />
                </motion.div>
              )}

              {status === "failed" && error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
                    <div>
                      <h4 className="font-medium text-destructive">
                        Execution Failed
                      </h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        {error}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </TabsContent>

          <TabsContent value="export" className="mt-4">
            <ExportPanel pipelineId={pipelineId} pipelineName={pipelineName} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          {status === "idle" && !isQuickRunning && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={handleQuickRun}
                disabled={!selectedDataset}
                className="gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                Run & Track Progress
              </Button>
              <Button
                onClick={handleExecute}
                disabled={!selectedDataset}
                className="gap-2"
              >
                <Play className="h-4 w-4" />
                Execute Here
              </Button>
            </>
          )}

          {isQuickRunning && (
            <Button disabled className="gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting Run...
            </Button>
          )}

          {(status === "starting" || status === "running") && (
            <Button variant="destructive" onClick={cancel} className="gap-2">
              <Square className="h-4 w-4" />
              Stop Execution
            </Button>
          )}

          {(status === "completed" ||
            status === "failed" ||
            status === "cancelled") && (
            <>
              <Button variant="outline" onClick={reset}>
                Run Again
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PipelineExecutionDialog;
