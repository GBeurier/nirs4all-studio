/**
 * PresetSelector component for pipeline presets
 */

import { PipelinePresetCard } from "nirs4all-ui/components";
import "nirs4all-ui/assets/pipeline-presets.css";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import {
  ArrowRight,
  Beaker,
  Boxes,
  Calculator,
  Cpu,
  Flame,
  FlaskConical,
  Gauge,
  GitBranch,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelinePreset, PipelinePresetVariantId } from "@/types/pipelines";
import {
  clampPresetComplexity,
  getPresetComplexityMeta,
  getPresetTaskColorKey,
  getPresetVariants,
  type PresetComplexityKey,
} from "./PresetSelectorData";

export type PresetSelectorVariant = "full" | "strip";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string, variant: PipelinePresetVariantId) => void;
  loading?: boolean;
  variant?: PresetSelectorVariant;
  onSeeAll?: () => void;
}

const presetIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  simple_pls: Calculator,
  fast_result: Zap,
  simple_trees_boosting: Sparkles,
  complex_pls: FlaskConical,
  complex_trees: Beaker,
  nonlinear_exploration: GitBranch,
  ultra_pls: Boxes,
  ultra_trees: Cpu,
  deep_nonlinear_exploration: Cpu,
  ultra_slow: Flame,
  default: GitBranch,
};

const categoryColors: Record<string, string> = {
  regression: "bg-primary/10 text-primary",
  classification: "bg-accent/10 text-accent",
  default: "bg-muted text-muted-foreground",
};

const variantButtonToneStyles: Record<PipelinePresetVariantId, string> = {
  regression: cn(
    "border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-700",
    "hover:border-emerald-500/45 hover:bg-emerald-500/[0.16] hover:text-emerald-800",
    "dark:border-emerald-400/30 dark:bg-emerald-400/[0.12] dark:text-emerald-200",
    "dark:hover:border-emerald-400/45 dark:hover:bg-emerald-400/[0.18] dark:hover:text-emerald-100"
  ),
  classification: cn(
    "border-sky-500/25 bg-sky-500/[0.10] text-sky-700",
    "hover:border-sky-500/45 hover:bg-sky-500/[0.16] hover:text-sky-800",
    "dark:border-sky-400/30 dark:bg-sky-400/[0.12] dark:text-sky-200",
    "dark:hover:border-sky-400/45 dark:hover:bg-sky-400/[0.18] dark:hover:text-sky-100"
  ),
};

const complexityIcons: Record<PresetComplexityKey, React.ComponentType<{ className?: string }>> = {
  starter: Zap,
  quick: Sparkles,
  balanced: Gauge,
  heavy: Boxes,
  exhaustive: Flame,
};

const compactVariantButtonClass =
  "h-6 rounded-full px-2.5 text-[10px] font-semibold leading-none shadow-none whitespace-nowrap [&_svg]:size-3";

const fullVariantButtonClass =
  "h-8 rounded-full px-3 text-[11px] font-semibold leading-none shadow-none whitespace-nowrap [&_svg]:size-3.5";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

function PresetComplexityBadge({
  complexity,
  compact = false,
}: {
  complexity: number;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const score = clampPresetComplexity(complexity);
  const meta = getPresetComplexityMeta(score);
  const Icon = complexityIcons[meta.key];
  const label = t(`pipelines.presetSelector.complexity.${meta.key}.label`);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            compact ? "whitespace-nowrap" : "",
            meta.chipClass
          )}
        >
          <Icon className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5", meta.iconClass)} />
          <span>{score}/10</span>
          {!compact && <span className="text-current/80">{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        <div className="font-semibold">{t("pipelines.presetSelector.complexityTitle", { score, label })}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-primary-foreground/90">
          {t(`pipelines.presetSelector.complexity.${meta.key}.description`)}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

export function PresetSelector({
  presets,
  onSelect,
  loading,
  variant = "full",
  onSeeAll,
}: PresetSelectorProps) {
  const { t } = useTranslation();

  if (loading) {
    if (variant === "strip") {
      return (
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 w-40 flex-shrink-0 animate-pulse rounded-full bg-muted" />
          ))}
        </div>
      );
    }
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-4 bg-muted rounded w-2/3 mb-2" />
              <div className="h-3 bg-muted rounded w-full mb-3" />
              <div className="h-8 bg-muted rounded w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (presets.length === 0) {
    if (variant === "strip") return null;
    return (
      <Card className="p-6 text-center">
        <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">{t("pipelines.presetSelector.noPresets")}</p>
      </Card>
    );
  }

  if (variant === "strip") {
    return (
      <TooltipProvider delayDuration={120}>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
          {presets.map((preset) => {
            const Icon = presetIcons[preset.id] || presetIcons.default;
            const colorClass = categoryColors[getPresetTaskColorKey(preset)] || categoryColors.default;
            const variants = getPresetVariants(preset);
            return (
              <div
                key={preset.id}
                className="flex flex-shrink-0 items-center gap-3 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-sm"
              >
                <span className={`rounded-full p-1 ${colorClass}`}>
                  <Icon className="h-3 w-3" />
                </span>
                <span className="font-medium text-foreground">{preset.name}</span>
                <PresetComplexityBadge complexity={preset.complexity} compact />
                <div className="flex items-center gap-1">
                  {variants.map((variantId) => (
                    <Button
                      key={variantId}
                      size="sm"
                      variant="outline"
                      onClick={() => onSelect(preset.id, variantId)}
                      className={cn(
                        compactVariantButtonClass,
                        variantButtonToneStyles[variantId]
                      )}
                    >
                      {t(`pipelines.presetSelector.variants.${variantId}`)}
                    </Button>
                  ))}
                </div>
              </div>
            );
          })}
          {onSeeAll && (
            <Button size="sm" variant="ghost" onClick={onSeeAll} className="flex-shrink-0">
              {t("pipelines.presetSelector.seeAll")}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          )}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={120}>
      <motion.div
        className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {presets.map((preset) => {
          const Icon = presetIcons[preset.id] || presetIcons.default;
          const complexityMeta = getPresetComplexityMeta(preset.complexity);
          const ComplexityIcon = complexityIcons[complexityMeta.key];
          return (
            <motion.div key={preset.id} variants={itemVariants}>
              <PipelinePresetCard
                preset={preset}
                templateIcon={<Icon />}
                labels={{
                  template: t("pipelines.presetSelector.template"),
                  ops: t("pipelines.collection.stats.ops"),
                  models: t("pipelines.collection.stats.models"),
                  branches: t("pipelines.collection.stats.branches"),
                  variants: t("pipelines.collection.stats.variants"),
                }}
                complexityBadge={<PresetComplexityBadge complexity={preset.complexity} />}
                complexityHint={<><ComplexityIcon className={complexityMeta.iconClass} />{t(`pipelines.presetSelector.complexity.${complexityMeta.key}.hint`)}</>}
                previewIcons={{
                  branch: <GitBranch className="text-accent" />,
                  model: <Cpu className="text-primary" />,
                  step: <Boxes className="text-muted-foreground/70" />,
                  generator: <Sparkles className="text-amber-500" />,
                }}
                moreSteps={(count) => t("pipelines.collection.moreSteps", { count })}
                renderVariant={(variantId) => (
                  <Button size="sm" variant="outline"
                    onClick={() => onSelect(preset.id, variantId)}
                    className={cn(fullVariantButtonClass, "w-full", variantButtonToneStyles[variantId])}
                  >
                    {t(`pipelines.presetSelector.variants.${variantId}`)}
                  </Button>
                )}
              />
            </motion.div>
          );
        })}
      </motion.div>
    </TooltipProvider>
  );
}
