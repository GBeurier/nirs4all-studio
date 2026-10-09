/**
 * NodeHeader - Step info display in tree node
 *
 * Extracted from TreeNode to provide the step icon, name, badges section.
 * Displays sweep indicators, finetuning badges, generator variants, and parameter summary.
 */

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
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
import { Repeat, Sparkles, Package, Layers, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { getStepTypeLabels } from "../../stepPresentation";
import type { GeneratorKind, PipelineStep } from "../../types";
import type { MissingOperatorIssue } from "@/lib/pipelineOperatorAvailability";

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
  // Generator info
  isGenerator?: boolean;
  generatorKind?: GeneratorKind | null;
  generatorVariantCount?: number;
  generatorOptionCount?: number;
  generatorSelectionSummary?: string;
  generatorOptionNames?: string[];
  isUnavailable?: boolean;
  unavailableIssue?: MissingOperatorIssue | null;
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
  isGenerator,
  generatorKind,
  generatorVariantCount,
  generatorOptionCount,
  generatorSelectionSummary,
  generatorOptionNames,
  isUnavailable = false,
  unavailableIssue = null,
}: NodeHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      {/* Name and badges row */}
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-sm text-foreground truncate">
          {step.name}
        </span>
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
          {getStepTypeLabels()[step.type] ?? step.type}
        </Badge>
        {isUnavailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="h-4 shrink-0 gap-1 bg-amber-500 px-1 py-0 text-[9px] text-white hover:bg-amber-600">
                <AlertTriangle className="h-2.5 w-2.5" />
                {t("pipelineEditor.palette.unavailable")}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[260px]">
              <div className="space-y-1 text-xs">
                <div className="font-semibold">{t("pipelineEditor.tree.missingDependency")}</div>
                <p>{unavailableIssue?.details?.error ?? unavailableIssue?.message ?? t("pipelineEditor.tree.stepUnavailable", { name: step.name })}</p>
              </div>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Sweep indicator - with Popover for details */}
        {hasSweeps && (
          <Popover>
            <PopoverTrigger asChild>
              <Badge className="text-[9px] px-1 py-0 h-4 bg-orange-500 hover:bg-orange-600 shrink-0 cursor-pointer transition-colors">
                <Repeat className="h-2.5 w-2.5 mr-0.5" />
                {totalVariants}
              </Badge>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-64 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <Repeat className="h-4 w-4 text-orange-500" />
                    {t("pipelineEditor.tree.sweeps")}
                  </h4>
                  <Badge variant="secondary" className="text-xs">
                    {t("pipelineEditor.tree.variantsBadge", { count: totalVariants })}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("pipelineEditor.tree.sweepParamCount", { count: sweepCount })}
                </p>
                {sweepSummary && (
                  <div className="space-y-1 pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground">{t("pipelineEditor.tree.parametersLabel")}</p>
                    <pre className="text-xs text-foreground font-mono whitespace-pre-wrap">
                      {sweepSummary}
                    </pre>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Finetuning indicator - with Popover for details */}
        {hasFinetuning && (
          <Popover>
            <PopoverTrigger asChild>
              <Badge className="text-[9px] px-1 py-0 h-4 bg-purple-500 hover:bg-purple-600 shrink-0 cursor-pointer transition-colors">
                <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                {finetuneTrials}
              </Badge>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-64 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-500" />
                    {t("pipelineEditor.tree.optunaFinetuning")}
                  </h4>
                  <Badge variant="secondary" className="text-xs">
                    {t("pipelineEditor.tree.trialsBadge", { count: finetuneTrials })}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("pipelineEditor.tree.paramsToOptimize", { count: finetuneParamCount })}
                </p>
                {step.finetuneConfig?.model_params && step.finetuneConfig.model_params.length > 0 && (
                  <div className="space-y-1 pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground">{t("pipelineEditor.tree.parametersLabel")}</p>
                    {step.finetuneConfig.model_params.slice(0, 5).map((param, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-mono">{param.name}</span>
                        <span className="text-muted-foreground">
                          {param.type === "categorical"
                            ? t("pipelineEditor.tree.choicesCount", { count: param.choices?.length ?? 0 })
                            : `${param.low} → ${param.high}`
                          }
                        </span>
                      </div>
                    ))}
                    {step.finetuneConfig.model_params.length > 5 && (
                      <p className="text-xs text-muted-foreground italic">
                        {t("pipelineEditor.tree.moreItems", { count: step.finetuneConfig.model_params.length - 5 })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {/* Generator variants indicator - with Popover for option list */}
        {isGenerator && generatorVariantCount !== undefined && generatorVariantCount > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Badge className="text-[9px] px-1 py-0 h-4 bg-orange-500 hover:bg-orange-600 shrink-0 cursor-pointer transition-colors">
                <Layers className="h-2.5 w-2.5 mr-0.5" />
                {generatorVariantCount}
              </Badge>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-64 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-orange-500" />
                    {generatorKind === "cartesian" ? t("pipelineEditor.tree.generatorKinds.cartesian")
                      : generatorKind === "grid" ? t("pipelineEditor.tree.generatorKinds.grid")
                      : generatorKind === "zip" ? t("pipelineEditor.tree.generatorKinds.zip")
                      : generatorKind === "chain" ? t("pipelineEditor.tree.generatorKinds.chain")
                      : generatorKind === "sample" ? t("pipelineEditor.tree.generatorKinds.sample")
                      : t("pipelineEditor.tree.generatorKinds.or")}
                  </h4>
                  <Badge variant="secondary" className="text-xs">
                    {t("pipelineEditor.tree.variantsBadge", { count: generatorVariantCount })}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("pipelineEditor.tree.generatorOptionCount", { count: generatorOptionCount ?? 0, summary: generatorSelectionSummary })}
                </p>
                {generatorOptionNames && generatorOptionNames.length > 0 && (
                  <div className="space-y-1 pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground">
                      {generatorKind === "cartesian" ? t("pipelineEditor.tree.generatorItemsLabel.cartesian")
                        : generatorKind === "grid" || generatorKind === "zip" ? t("pipelineEditor.tree.generatorItemsLabel.param")
                        : generatorKind === "chain" ? t("pipelineEditor.tree.generatorItemsLabel.chain")
                        : t("pipelineEditor.tree.generatorItemsLabel.options")}
                    </p>
                    {generatorOptionNames.slice(0, 8).map((name, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground w-4 text-right">{idx + 1}.</span>
                        <span className="text-foreground truncate">{name}</span>
                      </div>
                    ))}
                    {generatorOptionNames.length > 8 && (
                      <p className="text-xs text-muted-foreground italic">
                        {t("pipelineEditor.tree.moreItems", { count: generatorOptionNames.length - 8 })}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
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
                  {t("pipelineEditor.tree.foldLabels.children", {
                    count: containerChildren.length,
                    noun: t(`pipelineEditor.tree.childKind_${childLabel}`, { count: containerChildren.length }),
                  })}
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
            {t("pipelineEditor.tree.sweepsInline", { count: sweepCount })}
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
