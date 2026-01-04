/**
 * SweepsSummaryPanel - Overview of all active sweeps in the pipeline
 *
 * Displays:
 * - Per-step sweep breakdown
 * - Total variant count with formula
 * - Quick actions to edit or clear sweeps
 * - Warnings for large search spaces
 * - Recommendations for optimization strategies
 */

import { useState, useMemo } from "react";
import {
  Repeat,
  X,
  Edit3,
  AlertTriangle,
  Sparkles,
  Settings,
  ChevronDown,
  ChevronUp,
  Info,
  Trash2,
  Zap,
  Target,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineStep, ParameterSweep, StepType } from "./types";
import {
  stepColors,
  calculateSweepVariants,
  calculateStepVariants,
  formatSweepDisplay,
} from "./types";

interface StepSweepInfo {
  stepId: string;
  stepName: string;
  stepType: StepType;
  totalVariants: number;
  sweeps: {
    param: string;
    sweep: ParameterSweep;
    variants: number;
    display: string;
  }[];
}

// Extract sweep information from steps recursively
function extractSweepInfo(steps: PipelineStep[]): StepSweepInfo[] {
  const result: StepSweepInfo[] = [];

  for (const step of steps) {
    if (step.enabled === false) continue;

    // Check for parameter sweeps
    if (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) {
      const sweeps = Object.entries(step.paramSweeps).map(([param, sweep]) => ({
        param,
        sweep,
        variants: calculateSweepVariants(sweep),
        display: formatSweepDisplay(sweep),
      }));

      result.push({
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        totalVariants: calculateStepVariants(step),
        sweeps,
      });
    }

    // Recurse into branches
    if (step.branches) {
      for (const branch of step.branches) {
        result.push(...extractSweepInfo(branch));
      }
    }
  }

  return result;
}

// Get severity level for variant count
function getSeverity(count: number): "low" | "medium" | "high" | "extreme" {
  if (count <= 50) return "low";
  if (count <= 500) return "medium";
  if (count <= 5000) return "high";
  return "extreme";
}

// Get color class based on severity
function getSeverityColor(severity: "low" | "medium" | "high" | "extreme"): string {
  switch (severity) {
    case "low":
      return "text-emerald-500";
    case "medium":
      return "text-amber-500";
    case "high":
      return "text-orange-500";
    case "extreme":
      return "text-red-500";
  }
}

// Get background class based on severity
function getSeverityBg(severity: "low" | "medium" | "high" | "extreme"): string {
  switch (severity) {
    case "low":
      return "bg-emerald-500/10";
    case "medium":
      return "bg-amber-500/10";
    case "high":
      return "bg-orange-500/10";
    case "extreme":
      return "bg-red-500/10";
  }
}

interface SweepsSummaryPanelProps {
  steps: PipelineStep[];
  totalVariants: number;
  onEditStep?: (stepId: string) => void;
  onClearSweep?: (stepId: string, param: string) => void;
  onClearAllSweeps?: () => void;
  onOpenFinetuning?: () => void;
  className?: string;
}

export function SweepsSummaryPanel({
  steps,
  totalVariants,
  onEditStep,
  onClearSweep,
  onClearAllSweeps,
  onOpenFinetuning,
  className,
}: SweepsSummaryPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Extract sweep info from all steps
  const sweepInfos = useMemo(() => extractSweepInfo(steps), [steps]);

  // Calculate total from steps with sweeps
  const hasSweeps = sweepInfos.length > 0;
  const severity = getSeverity(totalVariants);

  // Toggle step expansion
  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  if (!hasSweeps) {
    return null;
  }

  return (
    <div className={cn("border border-border rounded-lg overflow-hidden", className)}>
      {/* Header */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <div
            className={cn(
              "flex items-center justify-between px-4 py-3 cursor-pointer transition-colors",
              getSeverityBg(severity)
            )}
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-lg bg-orange-500/20">
                <Repeat className="h-4 w-4 text-orange-500" />
              </div>
              <div>
                <h4 className="font-medium text-sm">Active Sweeps</h4>
                <p className="text-xs text-muted-foreground">
                  {sweepInfos.length} step{sweepInfos.length !== 1 ? "s" : ""} with sweeps
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge
                variant="secondary"
                className={cn("font-bold", getSeverityColor(severity))}
              >
                {totalVariants.toLocaleString()} variants
              </Badge>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-border">
            {/* Warning for large spaces */}
            {severity === "high" || severity === "extreme" ? (
              <div
                className={cn(
                  "flex items-start gap-2 p-3 text-sm",
                  severity === "extreme"
                    ? "bg-red-500/10 text-red-600"
                    : "bg-orange-500/10 text-orange-600"
                )}
              >
                <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">
                    {severity === "extreme"
                      ? "Very Large Search Space"
                      : "Large Search Space"}
                  </p>
                  <p className="text-xs mt-0.5 opacity-80">
                    {totalVariants.toLocaleString()} pipeline variants will be trained.
                    Consider reducing ranges or using Optuna finetuning for smarter exploration.
                  </p>
                </div>
              </div>
            ) : null}

            {/* Steps with sweeps */}
            <ScrollArea className="max-h-64">
              <div className="p-3 space-y-2">
                {sweepInfos.map((info) => {
                  const isStepExpanded = expandedSteps.has(info.stepId);
                  const colors = stepColors[info.stepType];

                  return (
                    <div
                      key={info.stepId}
                      className={cn(
                        "rounded-lg border",
                        colors.border,
                        colors.bg
                      )}
                    >
                      {/* Step header */}
                      <div
                        className="flex items-center justify-between px-3 py-2 cursor-pointer"
                        onClick={() => toggleStep(info.stepId)}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn("font-medium text-sm", colors.text)}>
                            {info.stepName}
                          </span>
                          <Badge
                            variant="secondary"
                            className="text-xs bg-orange-500/20 text-orange-600"
                          >
                            {info.totalVariants} variants
                          </Badge>
                        </div>

                        <div className="flex items-center gap-1">
                          {onEditStep && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onEditStep(info.stepId);
                                  }}
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit step</TooltipContent>
                            </Tooltip>
                          )}
                          {isStepExpanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>

                      {/* Sweep details */}
                      {isStepExpanded && (
                        <div className="px-3 pb-2 pt-1 border-t border-border/30 space-y-1.5">
                          {info.sweeps.map(({ param, variants, display }) => (
                            <div
                              key={param}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-muted-foreground capitalize">
                                {param.replace(/_/g, " ")}:
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-foreground">
                                  {display}
                                </span>
                                <Badge variant="outline" className="text-[10px] py-0">
                                  ×{variants}
                                </Badge>
                                {onClearSweep && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onClearSweep(info.stepId, param);
                                    }}
                                  >
                                    <X className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>

            {/* Formula */}
            <div className="px-3 py-2 border-t border-border bg-muted/30">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Calculation:</span>
                <span className="font-mono">
                  {sweepInfos
                    .map((info) => info.totalVariants)
                    .join(" × ")}{" "}
                  = {totalVariants.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/50">
              <div className="flex items-center gap-2">
                {onClearAllSweeps && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearAllSweeps}
                    className="text-xs h-7 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Clear All
                  </Button>
                )}
              </div>

              {severity !== "low" && onOpenFinetuning && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onOpenFinetuning}
                      className="text-xs h-7 border-purple-500/50 text-purple-500 hover:bg-purple-500/10"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1" />
                      Use Finetuning Instead
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Switch to Optuna-based intelligent search
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * SweepVsFinetuningAdvisor - Helps users choose between sweep and finetuning
 */
interface SweepVsFinetuningAdvisorProps {
  variantCount: number;
  hasModel: boolean;
  onUseSweep?: () => void;
  onUseFinetuning?: () => void;
  onUseHybrid?: () => void;
  className?: string;
}

export function SweepVsFinetuningAdvisor({
  variantCount,
  hasModel,
  onUseSweep,
  onUseFinetuning,
  onUseHybrid,
  className,
}: SweepVsFinetuningAdvisorProps) {
  // Determine recommendation
  const recommendation = useMemo(() => {
    if (!hasModel) return "sweep";
    if (variantCount <= 50) return "sweep";
    if (variantCount > 500) return "finetune";
    return "hybrid";
  }, [variantCount, hasModel]);

  return (
    <div className={cn("rounded-lg border border-border p-4 space-y-4", className)}>
      <div className="flex items-center gap-2">
        <Info className="h-5 w-5 text-blue-500" />
        <h4 className="font-medium">Search Strategy Recommendation</h4>
      </div>

      <p className="text-sm text-muted-foreground">
        You have {variantCount.toLocaleString()} parameter variations. Choose your strategy:
      </p>

      <div className="grid grid-cols-2 gap-3">
        {/* Grid Sweep */}
        <div
          className={cn(
            "rounded-lg border-2 p-3 cursor-pointer transition-all",
            recommendation === "sweep"
              ? "border-orange-500 bg-orange-500/5"
              : "border-border hover:border-orange-500/50"
          )}
          onClick={onUseSweep}
        >
          <div className="flex items-center gap-2 mb-2">
            <Repeat className="h-5 w-5 text-orange-500" />
            <span className="font-medium">Grid Sweep</span>
            {recommendation === "sweep" && (
              <Badge className="bg-orange-500 text-[10px]">Recommended</Badge>
            )}
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Run ALL combinations</li>
            <li>• Guaranteed best result</li>
            <li>• {variantCount.toLocaleString()} runs needed</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            Best for: Small spaces, need all results
          </p>
        </div>

        {/* Finetuning */}
        <div
          className={cn(
            "rounded-lg border-2 p-3 cursor-pointer transition-all",
            recommendation === "finetune"
              ? "border-purple-500 bg-purple-500/5"
              : "border-border hover:border-purple-500/50"
          )}
          onClick={onUseFinetuning}
        >
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            <span className="font-medium">Finetuning</span>
            {recommendation === "finetune" && (
              <Badge className="bg-purple-500 text-[10px]">Recommended</Badge>
            )}
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Smart exploration</li>
            <li>• Early stopping</li>
            <li>• ~50 trials typical</li>
          </ul>
          <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            Best for: Large spaces, time-limited
          </p>
        </div>
      </div>

      {/* Hybrid option */}
      {hasModel && (
        <div
          className={cn(
            "rounded-lg border-2 border-dashed p-3 cursor-pointer transition-all",
            recommendation === "hybrid"
              ? "border-teal-500 bg-teal-500/5"
              : "border-border hover:border-teal-500/50"
          )}
          onClick={onUseHybrid}
        >
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-teal-500" />
            <span className="text-sm font-medium">Hybrid Approach</span>
            {recommendation === "hybrid" && (
              <Badge className="bg-teal-500 text-[10px]">Recommended</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Sweep preprocessing variants + Finetune model parameters
          </p>
        </div>
      )}
    </div>
  );
}
