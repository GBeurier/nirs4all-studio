/**
 * PresetSelector component for pipeline presets
 */

import { motion } from "@/lib/motion";
import {
  ArrowRight,
  Beaker,
  Boxes,
  Calculator,
  Cpu,
  FlaskConical,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PipelinePreset, PipelinePresetVariantId } from "@/types/pipelines";
import { buildPipelinePreview, computePipelineStats } from "@/lib/pipelineStats";
import { importFromNirs4all } from "@/utils/pipelineConverter";

export type PresetSelectorVariant = "full" | "strip";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string, variant: PipelinePresetVariantId) => void;
  loading?: boolean;
  variant?: PresetSelectorVariant;
  onSeeAll?: () => void;
}

const presetIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pls_basic: Calculator,
  pls_derivative: GitBranch,
  rf_standard: Sparkles,
  kennard_stone_pls: FlaskConical,
  advanced_nirs: Beaker,
  default: GitBranch,
};

const categoryColors: Record<string, string> = {
  regression: "bg-primary/10 text-primary",
  classification: "bg-accent/10 text-accent",
  default: "bg-muted text-muted-foreground",
};

const variantLabels: Record<PipelinePresetVariantId, string> = {
  regression: "Regression",
  classification: "Classification",
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

/**
 * Convert a preset's canonical nirs4all pipeline into editor-step format so the
 * same stats/preview helpers used for saved pipelines work here too. Returns
 * an empty array on any parse failure — caller falls back to `steps_count`.
 */
function getPresetVariants(preset: PipelinePreset): PipelinePresetVariantId[] {
  if (preset.available_variants?.length > 0) {
    return preset.available_variants;
  }
  if (preset.task_type) {
    return [preset.task_type];
  }
  return ["regression"];
}

function getPresetPrimaryVariant(preset: PipelinePreset): PipelinePresetVariantId {
  return preset.default_variant ?? preset.task_type ?? getPresetVariants(preset)[0];
}

function getPresetPipeline(preset: PipelinePreset, variant: PipelinePresetVariantId): unknown[] {
  return preset.variants?.[variant]?.pipeline ?? preset.pipeline ?? [];
}

function deriveEditorStepsFromPreset(
  preset: PipelinePreset,
  variant: PipelinePresetVariantId
): unknown[] {
  const pipeline = getPresetPipeline(preset, variant);
  if (!pipeline) return [];
  try {
    return importFromNirs4all(pipeline as Parameters<typeof importFromNirs4all>[0]);
  } catch {
    return [];
  }
}

function StatCell({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string | number;
  emphasize?: boolean;
}) {
  return (
    <div className="flex flex-col">
      <span
        className={cn(
          "font-semibold tabular-nums leading-none",
          emphasize ? "text-base text-primary" : "text-sm text-foreground"
        )}
      >
        {value}
      </span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

export function PresetSelector({
  presets,
  onSelect,
  loading,
  variant = "full",
  onSeeAll,
}: PresetSelectorProps) {
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
        <p className="text-muted-foreground">No preset pipelines available</p>
      </Card>
    );
  }

  if (variant === "strip") {
    return (
      <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-scrollbar">
        {presets.map((preset) => {
          const Icon = presetIcons[preset.id] || presetIcons.default;
          const colorClass = categoryColors[preset.task_type] || categoryColors.default;
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
                    {variantLabels[variantId]}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
        {onSeeAll && (
          <Button size="sm" variant="ghost" onClick={onSeeAll} className="flex-shrink-0">
            See all
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {presets.map((preset) => {
        const Icon = presetIcons[preset.id] || presetIcons.default;
        const variants = getPresetVariants(preset);
        const primaryVariant = getPresetPrimaryVariant(preset);
        const editorSteps = deriveEditorStepsFromPreset(preset, primaryVariant);
        const stats = computePipelineStats(editorSteps);
        const preview = buildPipelinePreview(editorSteps, 5);

        return (
          <motion.div key={preset.id} variants={itemVariants}>
            <div className="step-card group flex h-full flex-col">
              <div className="mb-3 flex items-start gap-2">
                <div className="flex items-center gap-2 rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  <Icon className="h-3 w-3" />
                  Template
                </div>
              </div>

              <h3 className="truncate text-base font-semibold text-foreground">
                {preset.name}
              </h3>
              {preset.description && (
                <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                  {preset.description}
                </p>
              )}

              <div className="mt-3 grid grid-cols-4 gap-2 rounded-md border border-border/40 bg-muted/20 px-3 py-2">
                <StatCell
                  label="ops"
                  value={stats.operators || preset.steps_count}
                />
                <StatCell label="models" value={stats.models} />
                <StatCell label="branches" value={stats.branches} />
                <StatCell
                  label="variants"
                  value={stats.hasGenerators ? stats.variants : 1}
                  emphasize={stats.hasGenerators}
                />
              </div>

              {preview.nodes.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {preview.nodes.map((node) => (
                    <li
                      key={node.id}
                      className="flex items-center gap-2 text-muted-foreground"
                      style={{ paddingLeft: `${node.depth * 12}px` }}
                    >
                      {node.kind === "branch" ? (
                        <GitBranch className="h-3 w-3 text-accent" />
                      ) : node.kind === "model" ? (
                        <Cpu className="h-3 w-3 text-primary" />
                      ) : (
                        <Boxes className="h-3 w-3 text-muted-foreground/70" />
                      )}
                      <span className="truncate text-foreground/80">{node.label}</span>
                      {node.hasGenerator && (
                        <Sparkles className="h-3 w-3 flex-shrink-0 text-amber-500" />
                      )}
                    </li>
                  ))}
                  {preview.truncated && (
                    <li className="pl-0.5 text-[11px] italic text-muted-foreground/70">
                      + {preview.totalSteps - preview.nodes.length} more step
                      {preview.totalSteps - preview.nodes.length === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>
              )}

              <div
                className={cn(
                  "mt-auto pt-3",
                  variants.length > 1 ? "grid grid-cols-2 gap-2" : "flex"
                )}
              >
                {variants.map((variantId) => (
                  <Button
                    key={variantId}
                    size="sm"
                    variant="outline"
                    onClick={() => onSelect(preset.id, variantId)}
                    className={cn(
                      fullVariantButtonClass,
                      "w-full",
                      variants.length === 1 && "flex-1",
                      variantButtonToneStyles[variantId]
                    )}
                  >
                    {variantLabels[variantId]}
                  </Button>
                ))}
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
