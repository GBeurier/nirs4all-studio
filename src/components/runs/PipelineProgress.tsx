import { Box, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  buildPipelinePrimarySummary,
  formatPipelineChainLabel,
  formatPipelineVariantLabel,
  getPipelineDisplayMetrics,
  getPipelineFitCount,
  getPipelineFoldCount,
} from "@/lib/run-progress-display";
import type { GranularProgress } from "@/lib/run-progress";
import { cn } from "@/lib/utils";
import { getRuntimeResultStatusDisplay } from "@/ui/runtime";
import type { PipelineRun } from "@/types/runs";

import { StatusBadge } from "./StatusBadge";
import { statusIcons } from "./statusIcons";

export function PipelineProgress({
  pipeline,
  pipelineIndex,
  totalPipelines,
  currentStepMessage,
  granularProgress,
}: {
  pipeline: PipelineRun;
  pipelineIndex: number | null;
  totalPipelines: number;
  currentStepMessage?: string;
  granularProgress?: GranularProgress;
}) {
  const Icon = statusIcons[pipeline.status];
  const statusDisplay = getRuntimeResultStatusDisplay(pipeline.status);
  const chainLabel = formatPipelineChainLabel(pipeline.preprocessing, pipeline.pipeline_name, pipeline.model);
  const fitCount = getPipelineFitCount(pipeline);
  const foldCount = getPipelineFoldCount(pipeline);
  const liveVariantDescription = granularProgress?.variantDescription ?? pipeline.variant_description;
  const variantLabel = formatPipelineVariantLabel(pipeline.variant_choices, liveVariantDescription);
  const hasVariants =
    Boolean(variantLabel) ||
    pipeline.has_generators ||
    (pipeline.estimated_variants != null && pipeline.estimated_variants > 1) ||
    (pipeline.tested_variants != null && pipeline.tested_variants > 1);
  const variantFallbackLabel = variantLabel || (
    hasVariants
      ? pipeline.tested_variants !== undefined
        ? `${pipeline.tested_variants} variants tested`
        : pipeline.estimated_variants !== undefined
          ? `~${pipeline.estimated_variants} variants`
          : null
      : null
  );
  const displayMetrics = getPipelineDisplayMetrics(pipeline);
  const primarySummary = buildPipelinePrimarySummary(pipelineIndex, totalPipelines, pipeline) || pipeline.pipeline_name;

  return (
    <Card className={cn(
      "transition-all",
      pipeline.status === "running" && "border-chart-2/50 shadow-sm"
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("p-2 rounded-lg", statusDisplay.bgClass)}>
              <Icon className={cn("h-4 w-4", statusDisplay.colorClass, statusDisplay.iconClass)} />
            </div>
            <div className="min-w-0">
              <h4 className="font-medium">{primarySummary}</h4>
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                {foldCount != null && (
                  <Badge variant="outline" className="text-[10px] bg-cyan-500/10 text-cyan-600 border-cyan-500/30">
                    {foldCount} folds
                  </Badge>
                )}
                <Badge className="text-[10px] bg-teal-500/15 text-teal-600 border-teal-500/30 hover:bg-teal-500/20" variant="outline">
                  <Box className="h-3 w-3 mr-0.5" />{pipeline.model}
                </Badge>
                {chainLabel && <span className="min-w-0 truncate">{chainLabel}</span>}
                {!chainLabel && fitCount != null && (
                  <span className="text-muted-foreground">{fitCount} fits</span>
                )}
              </div>
              {variantFallbackLabel && (
                <div className="mt-1">
                  <Badge variant="outline" className="max-w-full text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30 font-mono whitespace-normal break-words">
                    {variantFallbackLabel}
                  </Badge>
                </div>
              )}
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

        {/* Metrics for completed or partially evaluated pipelines */}
        {displayMetrics && (displayMetrics.r2 != null || displayMetrics.rmse != null) && pipeline.status !== "failed" && (
          <div className="flex items-center gap-4 text-sm">
            {displayMetrics.r2 != null && (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 text-chart-1" />
                <span className="font-mono">R² = {(displayMetrics.r2 * 100).toFixed(2)}%</span>
              </div>
            )}
            {displayMetrics.rmse != null && (
              <div className="text-muted-foreground font-mono">
                RMSE = {displayMetrics.rmse.toFixed(4)}
              </div>
            )}
            {pipeline.status !== "completed" && (
              <div className="text-muted-foreground text-xs">
                partial
              </div>
            )}
            {pipeline.status === "completed" && pipeline.tested_variants && pipeline.tested_variants > 1 && (
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
