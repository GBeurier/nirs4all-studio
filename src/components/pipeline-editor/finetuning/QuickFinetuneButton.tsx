/**
 * QuickFinetuneButton - Quick action to enable finetuning
 */

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "../types";
import {
  buildQuickFinetuneConfig,
  getNumericFinetuneParamNames,
} from "./QuickFinetuneData";

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
  const availableParams = getNumericFinetuneParamNames(step.params);
  const quickFinetuneConfig = buildQuickFinetuneConfig({
    modelName: step.name,
    params: step.params,
  });

  const handleQuickEnable = () => {
    if (hasFinetuning) {
      onOpenTab?.();
      return;
    }

    if (!quickFinetuneConfig) {
      return;
    }

    onUpdate({
      finetuneConfig: quickFinetuneConfig,
    });

    onOpenTab?.();
  };

  if (availableParams.length === 0) {
    return null;
  }

  if (!hasFinetuning && !quickFinetuneConfig) {
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
