/**
 * PresetSelector component for pipeline presets
 * Phase 6: Pipelines Library
 */

import { motion } from "@/lib/motion";
import { ArrowRight, FlaskConical, Calculator, GitBranch, Sparkles, Beaker } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PipelinePreset } from "@/types/pipelines";

interface PresetSelectorProps {
  presets: PipelinePreset[];
  onSelect: (presetId: string) => void;
  loading?: boolean;
}

// Icon mapping for preset ids. Falls back to `default` for unknown presets.
const presetIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pls_basic: Calculator,
  pls_derivative: GitBranch,
  rf_standard: Sparkles,
  kennard_stone_pls: FlaskConical,
  advanced_nirs: Beaker,
  default: GitBranch,
};

// Color mapping for categories
const categoryColors: Record<string, string> = {
  regression: "bg-primary/10 text-primary",
  classification: "bg-accent/10 text-accent",
  default: "bg-muted text-muted-foreground",
};

export function PresetSelector({ presets, onSelect, loading }: PresetSelectorProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.05 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: { opacity: 1, y: 0 },
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
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
    return (
      <Card className="p-6 text-center">
        <FlaskConical className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No preset pipelines available</p>
      </Card>
    );
  }

  return (
    <motion.div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {presets.map((preset) => {
        const Icon = presetIcons[preset.id] || presetIcons.default;
        const colorClass = categoryColors[preset.task_type] || categoryColors.default;

        return (
          <motion.div key={preset.id} variants={itemVariants}>
            <Card className="step-card group h-full border-border/70 bg-card/95">
              <CardContent className="flex h-full flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-2xl p-2.5 ${colorClass}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{preset.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                        {preset.description}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {preset.task_type}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {preset.steps_count} steps
                  </Badge>
                  <Badge variant="outline" className="font-normal">
                    Creates editable copy
                  </Badge>
                </div>

                <div className="mt-auto flex items-end justify-between gap-3">
                  <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                    The template stays unchanged. Clicking Use Template creates a new pipeline in your library.
                  </p>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onSelect(preset.id)}
                    className="shrink-0"
                  >
                    Use Template
                    <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

