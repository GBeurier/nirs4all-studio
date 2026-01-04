/**
 * NodeHeader - Step info display in tree node
 *
 * Extracted from TreeNode to provide the step icon, name, badges section.
 * Displays sweep indicators, finetuning badges, and parameter summary.
 */

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Repeat, Sparkles, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PipelineStep } from "../../types";

interface NodeHeaderProps {
  step: PipelineStep;
  Icon: LucideIcon;
  colors: {
    bg: string;
    text: string;
    border?: string;
  };
  // Sweep info
  hasSweeps: boolean;
  totalVariants: number;
  sweepCount: number;
  sweepSummary: string;
  displayParams: string;
  // Finetuning info
  hasFinetuning: boolean;
  finetuneTrials: number;
  finetuneParamCount: number;
  // Container info
  isContainer: boolean;
  containerChildren: PipelineStep[];
  childLabel: string;
}

/**
 * Step header with icon, name, and badges
 */
export function NodeHeader({
  step,
  Icon,
  colors,
  hasSweeps,
  totalVariants,
  sweepCount,
  sweepSummary,
  displayParams,
  hasFinetuning,
  finetuneTrials,
  finetuneParamCount,
  isContainer,
  containerChildren,
  childLabel,
}: NodeHeaderProps) {
  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      {/* Name and badges row */}
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-sm text-foreground truncate">
          {step.name}
        </span>
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
          {step.type}
        </Badge>

        {/* Sweep indicator */}
        {hasSweeps && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="text-[9px] px-1 py-0 h-4 bg-orange-500 hover:bg-orange-500 shrink-0 cursor-help">
                <Repeat className="h-2.5 w-2.5 mr-0.5" />
                {totalVariants}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px]">
              <div className="text-xs">
                <div className="font-semibold mb-1">Sweeps ({sweepCount})</div>
                <pre className="text-muted-foreground whitespace-pre-wrap">
                  {sweepSummary}
                </pre>
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Finetuning indicator */}
        {hasFinetuning && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="text-[9px] px-1 py-0 h-4 bg-purple-500 hover:bg-purple-500 shrink-0 cursor-help">
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                {finetuneTrials}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px]">
              <div className="text-xs">
                <div className="font-semibold mb-1">Optuna Finetuning</div>
                <p className="text-muted-foreground">
                  {finetuneTrials} trials, {finetuneParamCount} parameter
                  {finetuneParamCount !== 1 ? "s" : ""}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Container children indicator */}
        {isContainer && containerChildren.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                className={`text-[9px] px-1 py-0 h-4 shrink-0 cursor-help ${colors.text} bg-opacity-20`}
                style={{ backgroundColor: "currentColor", opacity: 0.2 }}
              >
                <Package className="h-2.5 w-2.5 mr-0.5" />
                {containerChildren.length}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[220px]">
              <div className="text-xs">
                <div className="font-semibold mb-1">
                  {containerChildren.length} {childLabel}
                  {containerChildren.length !== 1 ? "s" : ""}
                </div>
                <p className="text-muted-foreground">
                  {containerChildren.map((c) => c.name).join(", ")}
                </p>
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Parameters/sweep summary row */}
      {hasSweeps ? (
        <p className="text-[10px] text-muted-foreground truncate font-mono leading-tight">
          {displayParams && <span>{displayParams}</span>}
          {displayParams && sweepCount > 0 && <span className="mx-1">•</span>}
          <span className="text-orange-500">
            {sweepCount} sweep{sweepCount !== 1 ? "s" : ""}
          </span>
        </p>
      ) : (
        displayParams && (
          <p
            className="text-[10px] text-muted-foreground truncate font-mono leading-tight"
            title={Object.entries(step.params)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          >
            {Object.entries(step.params)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          </p>
        )
      )}
    </div>
  );
}
