/**
 * QuickFinetuneButton - Quick action to enable finetuning
 */

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "../types";
import { getPresetsForModel } from "./presets";

interface QuickFinetuneButtonProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  onOpenTab?: () => void;
  className?: string;
}

export function QuickFinetuneButton({
  step,
  onUpdate,
  onOpenTab,
  className,
}: QuickFinetuneButtonProps) {
  const hasFinetuning = step.finetuneConfig?.enabled;

  // Get available parameters from step params
  const availableParams = Object.keys(step.params).filter(
    (p) => typeof step.params[p] === "number"
  );

  const handleQuickEnable = () => {
    if (hasFinetuning) {
      onOpenTab?.();
      return;
    }

    // Quick-enable with smart defaults
    const presets = getPresetsForModel(step.name);
    const matchingPresets = presets.filter((p) =>
      availableParams.includes(p.name)
    );

    onUpdate({
      finetuneConfig: {
        enabled: true,
        n_trials: 50,
        approach: "grouped",
        eval_mode: "best",
        model_params: matchingPresets.slice(0, 2).map((p) => ({
          name: p.name,
          type: p.type,
          low: p.low,
          high: p.high,
          step: p.step,
          choices: p.choices,
        })),
      },
    });

    onOpenTab?.();
  };

  if (availableParams.length === 0) {
    return null;
  }

  return (
    <Button
      variant={hasFinetuning ? "default" : "ghost"}
      size="sm"
      onClick={handleQuickEnable}
      className={cn(
        "h-7 px-2 text-xs gap-1.5 transition-all",
        hasFinetuning
          ? "bg-purple-500 hover:bg-purple-600 text-white"
          : "hover:bg-purple-500/10 hover:text-purple-500",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {hasFinetuning ? "Finetuning" : "Enable Finetuning"}
    </Button>
  );
}
