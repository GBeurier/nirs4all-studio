/**
 * ExecutionPreviewPanel Component
 *
 * Displays a comprehensive preview of what will happen when the pipeline runs:
 * - Total variant count (from sweeps)
 * - Finetuning trials breakdown
 * - Total model fits calculation
 * - Performance warnings and optimization suggestions
 * - Time estimates (when applicable)
 *
 * Part of Phase 5: UX Polish
 */

import { useMemo } from "react";
import {
  Repeat,
  Sparkles,
  Calculator,
  AlertTriangle,
  Clock,
  Cpu,
  TrendingUp,
  ChevronDown,
  Lightbulb,
  Layers,
  Zap,
  Box,
  RefreshCw,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PipelineStep, FinetuneConfig } from "./types";
import { formatVariantCount, getVariantCountSeverity } from "@/hooks/useVariantCount";
import { analyzeExecution } from "./executionAnalysis";
import {
  buildExecutionFormula,
  estimateExecutionTime,
  generateExecutionSuggestions,
  getComplexityLabel,
  getExecutionProgressValue,
  getFitsSeverity,
  getSeverityColor,
} from "./executionPreviewPresentation";

export interface ExecutionPreviewPanelProps {
  steps: PipelineStep[];
  variantCount: number;
  variantBreakdown?: Record<string, { name: string; count: number }>;
  isLoading?: boolean;
  className?: string;
}

export function ExecutionPreviewPanel({
  steps,
  variantCount,
  variantBreakdown,
  isLoading,
  className = "",
}: ExecutionPreviewPanelProps) {
  const breakdown = useMemo(
    () => analyzeExecution(steps, variantCount),
    [steps, variantCount]
  );
  const severity = getFitsSeverity(breakdown.totalFits);
  const severityColor = getSeverityColor(severity);
  const timeEstimate = estimateExecutionTime(breakdown.totalFits);
  const suggestions = useMemo(() => generateExecutionSuggestions(breakdown), [breakdown]);
  const progressValue = useMemo(
    () => getExecutionProgressValue(breakdown.totalFits),
    [breakdown.totalFits]
  );

  if (steps.length === 0) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Main Stats */}
      <div className="grid grid-cols-3 gap-3">
        {/* Sweep Variants */}
        <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Repeat className="h-4 w-4 text-orange-500" />
            <span className="text-xs font-medium text-orange-500">Sweeps</span>
          </div>
          <div className="text-xl font-bold text-foreground">
            {formatVariantCount(breakdown.sweepVariants)}
          </div>
          <p className="text-[10px] text-muted-foreground">
            pipeline variants
          </p>
        </div>

        {/* Finetuning Trials */}
        <div className="p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="h-4 w-4 text-purple-500" />
            <span className="text-xs font-medium text-purple-500">Finetuning</span>
          </div>
          <div className="text-xl font-bold text-foreground">
            {breakdown.finetuningTrials || "—"}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {breakdown.modelsWithFinetuning > 0 ? `${breakdown.modelsWithFinetuning} model${breakdown.modelsWithFinetuning > 1 ? "s" : ""}` : "disabled"}
          </p>
        </div>

        {/* Total Fits */}
        <div className={`p-3 rounded-lg border ${
          severity === "low" ? "bg-emerald-500/5 border-emerald-500/20" :
          severity === "medium" ? "bg-amber-500/5 border-amber-500/20" :
          severity === "high" ? "bg-orange-500/5 border-orange-500/20" :
          "bg-red-500/5 border-red-500/20"
        }`}>
          <div className="flex items-center gap-2 mb-1">
            <Calculator className={`h-4 w-4 ${severityColor}`} />
            <span className={`text-xs font-medium ${severityColor}`}>Total Fits</span>
          </div>
          <div className="text-xl font-bold text-foreground">
            {formatVariantCount(breakdown.totalFits)}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {timeEstimate}
          </p>
        </div>
      </div>

      {/* Progress Indicator */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Execution Complexity</span>
          <span className={`font-medium ${severityColor}`}>
            {getComplexityLabel(severity)}
          </span>
        </div>
        <Progress
          value={progressValue}
          className={`h-2 ${
            severity === "extreme" ? "[&>div]:bg-red-500" :
            severity === "high" ? "[&>div]:bg-orange-500" :
            severity === "medium" ? "[&>div]:bg-amber-500" :
            "[&>div]:bg-emerald-500"
          }`}
        />
      </div>

      {/* Formula Breakdown */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
            <span className="text-xs text-muted-foreground">Calculation Details</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm font-mono">
              <Tooltip>
                <TooltipTrigger>
                  <span className="px-2 py-1 rounded bg-orange-500/10 text-orange-500">
                    {breakdown.sweepVariants}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Sweep Variants</TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground">×</span>
              <Tooltip>
                <TooltipTrigger>
                  <span className="px-2 py-1 rounded bg-purple-500/10 text-purple-500">
                    {Math.max(1, breakdown.finetuningTrials)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Finetuning Trials (or 1 if disabled)</TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground">×</span>
              <Tooltip>
                <TooltipTrigger>
                  <span className="px-2 py-1 rounded bg-primary/10 text-primary">
                    {breakdown.cvFolds}
                  </span>
                </TooltipTrigger>
                <TooltipContent>CV Folds</TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground">=</span>
              <span className={`px-2 py-1 rounded font-bold ${
                severity === "extreme" ? "bg-red-500/10 text-red-500" :
                severity === "high" ? "bg-orange-500/10 text-orange-500" :
                severity === "medium" ? "bg-amber-500/10 text-amber-500" :
                "bg-emerald-500/10 text-emerald-500"
              }`}>
                {breakdown.totalFits.toLocaleString()}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              sweep variants × trials × cv folds = total model fits
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Warnings & Suggestions */}
      {(severity === "high" || severity === "extreme" || suggestions.length > 0) && (
        <div className="space-y-2">
          {/* Warning */}
          {(severity === "high" || severity === "extreme") && (
            <div className={`flex items-start gap-2 p-3 rounded-lg ${
              severity === "extreme"
                ? "bg-red-500/10 border border-red-500/30"
                : "bg-amber-500/10 border border-amber-500/30"
            }`}>
              <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${
                severity === "extreme" ? "text-red-500" : "text-amber-500"
              }`} />
              <div className="text-xs">
                <p className={`font-medium ${
                  severity === "extreme" ? "text-red-500" : "text-amber-500"
                }`}>
                  {severity === "extreme"
                    ? "Very Large Execution"
                    : "Large Execution"}
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {severity === "extreme"
                    ? "This configuration will run a very large number of model fits. Consider reducing search space."
                    : "This may take significant time. Review your configuration."}
                </p>
              </div>
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
                  <span className="flex items-center gap-1.5 text-xs">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                    <span className="text-amber-500 font-medium">
                      {suggestions.length} Optimization Suggestion{suggestions.length > 1 ? "s" : ""}
                    </span>
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-2">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
                  >
                    <div className="w-4 h-4 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-[10px] font-bold text-amber-500">{index + 1}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{suggestion}</p>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {/* Breakdown by step (if provided) */}
      {variantBreakdown && Object.keys(variantBreakdown).length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between h-8 px-2">
              <span className="text-xs text-muted-foreground">Variant Breakdown by Step</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="space-y-1.5">
              {Object.entries(variantBreakdown).map(([stepId, info]) => (
                <div
                  key={stepId}
                  className="flex items-center justify-between py-1 px-2 rounded bg-muted/30"
                >
                  <span className="text-xs truncate max-w-[60%]">{info.name}</span>
                  <Badge variant="outline" className="text-[10px] h-5">
                    {info.count > 1 ? `×${info.count}` : "—"}
                  </Badge>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// Compact version for header/inline use — single training summary capsule.
export function ExecutionPreviewCompact({
  steps,
  variantCount,
}: {
  steps: PipelineStep[];
  variantCount: number;
}) {
  const breakdown = useMemo(
    () => analyzeExecution(steps, variantCount),
    [steps, variantCount]
  );
  const severity = getFitsSeverity(breakdown.totalFits);

  if (steps.length === 0) return null;

  const severityClass =
    severity === "low" ? "border-emerald-500/30 text-emerald-500"
    : severity === "medium" ? "border-amber-500/30 text-amber-500"
    : severity === "high" ? "border-orange-500/30 text-orange-500"
    : "border-red-500/30 text-red-500";

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Training summary capsule */}
      <Popover>
        <PopoverTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 cursor-pointer transition-colors hover:bg-accent ${severityClass}`}
          >
            <Box className="h-3 w-3" />
            <span>{formatVariantCount(breakdown.totalModels)} model{breakdown.totalModels !== 1 ? "s" : ""} trained</span>
          </Badge>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 bg-popover">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Training Summary</h4>
              <span className={`text-lg font-bold ${getSeverityColor(severity)}`}>
                {breakdown.totalModels.toLocaleString()}
              </span>
            </div>

            <div className="space-y-1.5">
              {breakdown.totalPipelines > 1 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Repeat className="h-3 w-3" />
                    Pipeline configurations
                  </span>
                  <span className="font-mono">{breakdown.totalPipelines.toLocaleString()}</span>
                </div>
              )}
              {breakdown.sweepVariants > 1 && (
                <div className="flex items-center justify-between text-xs pl-4">
                  <span className="text-muted-foreground">Sweep variants</span>
                  <span className="font-mono">{breakdown.sweepVariants.toLocaleString()}</span>
                </div>
              )}
              {breakdown.generatorVariants > 1 && (
                <div className="flex items-center justify-between text-xs pl-4">
                  <span className="text-muted-foreground">Generator variants</span>
                  <span className="font-mono">{breakdown.generatorVariants.toLocaleString()}</span>
                </div>
              )}
              {breakdown.finetuningTrials > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-purple-500" />
                    Finetuning trials
                  </span>
                  <span className="font-mono">{breakdown.finetuningTrials.toLocaleString()}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Layers className="h-3 w-3" />
                  CV folds
                </span>
                <span className="font-mono">{breakdown.cvFolds}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Calculator className="h-3 w-3" />
                  CV fits
                </span>
                <span className="font-mono">{breakdown.totalFits.toLocaleString()}</span>
              </div>
              {breakdown.modelsWithRefit > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3 text-teal-500" />
                    Refit models
                  </span>
                  <span className="font-mono">+{breakdown.refitModels.toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border space-y-1">
              <p className="text-[11px] text-muted-foreground font-mono">
                {buildExecutionFormula(breakdown)} = {breakdown.totalModels.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                Total model training operations when you run this pipeline.
              </p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export default ExecutionPreviewPanel;
