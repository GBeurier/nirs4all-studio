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
import type { PipelinePreset } from "@/types/pipelines";
import { buildPipelinePreview, computePipelineStats } from "@/lib/pipelineStats";
import { importFromNirs4all } from "@/utils/pipelineConverter";

export type PresetSelectorVariant = "full" | "strip";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string) => void;
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
function deriveEditorStepsFromPreset(preset: PipelinePreset): unknown[] {
  if (!preset.pipeline) return [];
  try {
    return importFromNirs4all(preset.pipeline as Parameters<typeof importFromNirs4all>[0]);
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
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset.id)}
              className="group flex flex-shrink-0 items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className={`rounded-full p-1 ${colorClass}`}>
                <Icon className="h-3 w-3" />
              </span>
              <span className="font-medium text-foreground">{preset.name}</span>
              <Badge variant="outline" className="text-[10px]">
                {preset.task_type}
              </Badge>
              <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
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
        const editorSteps = deriveEditorStepsFromPreset(preset);
        const stats = computePipelineStats(editorSteps);
        const preview = buildPipelinePreview(editorSteps, 5);

        return (
          <motion.div key={preset.id} variants={itemVariants}>
            <div className="step-card group flex h-full flex-col">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  <Icon className="h-3 w-3" />
                  Template
                </div>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {preset.task_type}
                </Badge>
              </div>

              <button type="button" onClick={() => onSelect(preset.id)} className="text-left">
                <h3 className="truncate text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                  {preset.name}
                </h3>
                {preset.description && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                    {preset.description}
                  </p>
                )}
              </button>

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

              <div className="mt-auto pt-3">
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => onSelect(preset.id)}
                  className="w-full"
                >
                  Use template
                  <ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Button>
              </div>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
