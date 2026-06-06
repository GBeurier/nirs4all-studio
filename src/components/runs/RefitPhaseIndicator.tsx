import {
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { RefitState } from "@/lib/run-progress";
import { cn } from "@/lib/utils";

export function RefitPhaseIndicator({ refit }: { refit: RefitState }) {
  if (refit.status === "idle") return null;

  const isRunning = refit.status === "running";
  const isCompleted = refit.status === "completed";
  const isFailed = refit.status === "failed";

  return (
    <Card className={cn(
      "transition-all",
      isRunning && "border-teal-500/50 shadow-sm",
      isCompleted && "border-chart-1/50",
      isFailed && "border-destructive/50",
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg",
              isRunning && "bg-teal-500/10",
              isCompleted && "bg-chart-1/10",
              isFailed && "bg-destructive/10",
            )}>
              {isRunning && <RefreshCw className="h-4 w-4 text-teal-500 animate-spin" />}
              {isCompleted && <CheckCircle2 className="h-4 w-4 text-chart-1" />}
              {isFailed && <AlertCircle className="h-4 w-4 text-destructive" />}
            </div>
            <div>
              <h4 className="font-medium">Refit Phase</h4>
              <p className="text-xs text-muted-foreground">
                {isRunning && "Refitting best model on all training data..."}
                {isCompleted && "Best model refitted successfully"}
                {isFailed && "Refit failed"}
              </p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className={cn(
              "gap-1.5",
              isRunning && "bg-teal-500/10 text-teal-600",
              isCompleted && "bg-chart-1/10 text-chart-1",
              isFailed && "bg-destructive/10 text-destructive",
            )}
          >
            {isRunning && "Refitting"}
            {isCompleted && "Complete"}
            {isFailed && "Failed"}
          </Badge>
        </div>

        {/* Step indicators for running refit */}
        {isRunning && refit.totalSteps > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            <Badge
              variant="outline"
              className="text-[10px] bg-teal-500/10 text-teal-600 border-teal-500/30"
            >
              Step {refit.currentStep}/{refit.totalSteps}: {refit.stepName}
            </Badge>
            {refit.stepType && (
              <Badge
                variant="outline"
                className="text-[10px] bg-muted text-muted-foreground"
              >
                {refit.stepType}
              </Badge>
            )}
          </div>
        )}

        {/* Progress bar for running refit */}
        {isRunning && (
          <div className="space-y-1 mb-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate max-w-[70%]">
                {refit.message || "Refitting..."}
              </span>
              <span>{Math.round(refit.progress)}%</span>
            </div>
            <Progress value={refit.progress} className="h-2" />
          </div>
        )}

        {/* Refit score on completion */}
        {isCompleted && refit.score != null && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-chart-1" />
              <span className="font-mono">
                Refit score: {refit.score.toFixed(4)}
              </span>
            </div>
            {refit.metrics.rmse != null && (
              <div className="text-muted-foreground font-mono">
                RMSE = {refit.metrics.rmse.toFixed(4)}
              </div>
            )}
          </div>
        )}

        {/* Error message for failed refit */}
        {isFailed && refit.error && (
          <div className="text-sm text-destructive mt-2">
            {refit.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
