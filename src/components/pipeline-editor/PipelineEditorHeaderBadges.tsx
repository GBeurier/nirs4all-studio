import {
  AlertTriangle,
  Info,
  Loader2,
  Repeat,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  formatVariantCount,
  getVariantCountColor,
  getVariantCountSeverity,
} from "@/hooks/useVariantCount";
import { ExecutionPreviewCompact } from "./ExecutionPreviewPanel";
import type {
  LegacyStepType,
  PipelineStep,
} from "./types";

interface PipelineEditorHeaderBadgesProps {
  totalSteps: number;
  stepCounts: Record<LegacyStepType, number>;
  steps: PipelineStep[];
  variantCount: number;
  variantBreakdown: Record<string, { name: string; count: number }>;
  variantWarning?: string;
  isCountingVariants: boolean;
  isDirty: boolean;
}

export function PipelineEditorHeaderBadges({
  totalSteps,
  stepCounts,
  steps,
  variantCount,
  variantBreakdown,
  variantWarning,
  isCountingVariants,
  isDirty,
}: PipelineEditorHeaderBadgesProps) {
  const { t } = useTranslation();
  const variantSeverity = getVariantCountSeverity(variantCount);

  return (
    <div className="flex items-center gap-2 mt-1">
      {totalSteps > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge
              variant="outline"
              className="text-xs cursor-pointer transition-colors hover:bg-accent border-muted-foreground/30 text-muted-foreground"
            >
              {t("pipelineEditor.shell.badges.steps", { count: totalSteps })}
              {stepCounts.model > 0 && <span className="text-primary ml-1">{t("pipelineEditor.shell.badges.models", { count: stepCounts.model })}</span>}
            </Badge>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 bg-popover">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t("pipelineEditor.shell.badges.stepBreakdown")}</h4>
              <div className="space-y-1">
                {stepCounts.preprocessing > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-blue-500">{t("pipelineEditor.shell.badges.preprocessing")}</span>
                    <span className="font-mono">{stepCounts.preprocessing}</span>
                  </div>
                )}
                {stepCounts.y_processing > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-500">{t("pipelineEditor.shell.badges.yProcessing")}</span>
                    <span className="font-mono">{stepCounts.y_processing}</span>
                  </div>
                )}
                {stepCounts.filter > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-rose-500">{t("pipelineEditor.shell.badges.filters")}</span>
                    <span className="font-mono">{stepCounts.filter}</span>
                  </div>
                )}
                {stepCounts.augmentation > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-indigo-500">{t("pipelineEditor.shell.badges.augmentation")}</span>
                    <span className="font-mono">{stepCounts.augmentation}</span>
                  </div>
                )}
                {stepCounts.splitting > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-purple-500">{t("pipelineEditor.shell.badges.splitting")}</span>
                    <span className="font-mono">{stepCounts.splitting}</span>
                  </div>
                )}
                {stepCounts.model > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-primary">{t("pipelineEditor.shell.badges.modelsLabel")}</span>
                    <span className="font-mono">{stepCounts.model}</span>
                  </div>
                )}
                {stepCounts.branch > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{t("pipelineEditor.shell.badges.branches")}</span>
                    <span className="font-mono">{stepCounts.branch}</span>
                  </div>
                )}
                {stepCounts.merge > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{t("pipelineEditor.shell.badges.merges")}</span>
                    <span className="font-mono">{stepCounts.merge}</span>
                  </div>
                )}
                {stepCounts.generator > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-orange-500">{t("pipelineEditor.shell.badges.generators")}</span>
                    <span className="font-mono">{stepCounts.generator}</span>
                  </div>
                )}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {totalSteps > 0 && variantCount > 1 && (
        <Popover>
          <PopoverTrigger asChild>
            <Badge
              variant="outline"
              className={`text-xs cursor-pointer transition-colors hover:bg-accent ${
                variantSeverity === "low"
                  ? "border-emerald-500/30 text-emerald-500"
                  : variantSeverity === "medium"
                  ? "border-amber-500/30 text-amber-500"
                  : variantSeverity === "high"
                  ? "border-orange-500/30 text-orange-500"
                  : "border-red-500/30 text-red-500"
              }`}
            >
              {isCountingVariants ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Repeat className="h-3 w-3 mr-1" />
              )}
              {t("pipelineEditor.shell.badges.variants", { count: variantCount, formatted: formatVariantCount(variantCount) })}
            </Badge>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 bg-popover"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">
                  {t("pipelineEditor.shell.badges.pipelineVariants")}
                </h4>
                <span
                  className={`text-lg font-bold ${getVariantCountColor(
                    variantCount
                  )}`}
                >
                  {variantCount.toLocaleString()}
                </span>
              </div>
              {variantWarning && (
                <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 text-amber-500 text-xs">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{variantWarning}</span>
                </div>
              )}
              {Object.keys(variantBreakdown).length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t("pipelineEditor.shell.badges.breakdownByStep")}
                  </p>
                  {Object.entries(variantBreakdown).map(
                    ([stepId, info]) => (
                      <div
                        key={stepId}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-muted-foreground truncate max-w-[180px]">
                          {info.name}
                        </span>
                        <span className="font-mono">
                          {info.count.toLocaleString()}
                        </span>
                      </div>
                    )
                  )}
                </div>
              )}
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                  <Info className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  <span>
                    {t("pipelineEditor.shell.badges.variantsHint")}
                  </span>
                </p>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
      {totalSteps > 0 && (
        <ExecutionPreviewCompact
          steps={steps}
          variantCount={variantCount}
        />
      )}
      {isDirty && (
        <Badge variant="secondary" className="text-xs">
          {t("pipelineEditor.shell.badges.unsaved")}
        </Badge>
      )}
    </div>
  );
}
