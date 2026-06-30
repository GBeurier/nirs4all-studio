import { motion, AnimatePresence } from "@/lib/motion";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Check, Trophy } from "lucide-react";

import {
  type ExecutionResult,
  type ExecutionStatus,
} from "@/hooks/usePipelineExecution";
import {
  formatPipelineExecutionMetricValue,
  getPrimaryPipelineExecutionMetrics,
} from "@/lib/pipelineExecutionContract";

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

  const primaryMetrics = getPrimaryPipelineExecutionMetrics(result);

  return (
    <div className="space-y-4">
      {primaryMetrics.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {primaryMetrics.map((metric) => (
            <div key={metric.key} className="rounded-lg border bg-card p-3 text-center">
              <div className="text-2xl font-bold text-emerald-500">
                {formatPipelineExecutionMetricValue(metric)}
              </div>
              <div className="text-xs text-muted-foreground">{metric.label}</div>
            </div>
          ))}
        </div>
      )}

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
                  {getPrimaryPipelineExecutionMetrics({
                    metrics: r.metrics ?? {
                      ...(r.rmse !== undefined ? { rmse: r.rmse } : {}),
                      ...(r.r2 !== undefined ? { r2: r.r2 } : {}),
                    },
                  }, 2).map((metric) => (
                    <span key={metric.key}>
                      {metric.label}: {formatPipelineExecutionMetricValue(metric)}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.modelPath && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-emerald-500" />
          Model saved to: <code className="text-xs bg-muted px-1 py-0.5 rounded">{result.modelPath}</code>
        </div>
      )}

      {result.artifacts?.map((artifact) => (
        <div key={`${artifact.kind}:${artifact.path ?? artifact.uri ?? artifact.label ?? "artifact"}`} className="flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="h-4 w-4 text-emerald-500" />
          {artifact.label ?? artifact.kind}:{" "}
          <code className="text-xs bg-muted px-1 py-0.5 rounded">
            {artifact.path ?? artifact.uri ?? artifact.kind}
          </code>
        </div>
      ))}
    </div>
  );
}

export function ExecutionFeedback({
  error,
  progress,
  progressMessage,
  result,
  status,
}: {
  error: string | null;
  progress: number;
  progressMessage: string;
  result: ExecutionResult | null;
  status: ExecutionStatus;
}) {
  return (
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
  );
}
