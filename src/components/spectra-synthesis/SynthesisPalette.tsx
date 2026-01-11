/**
 * SynthesisPalette - Left panel with available synthesis steps
 *
 * Displays categories of steps that can be added to the builder.
 */

import { useState } from "react";
import {
  Waves,
  Target,
  Database,
  Sparkles,
  Brain,
  FileOutput,
  ChevronDown,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSynthesisBuilder } from "./contexts";
import {
  SYNTHESIS_CATEGORIES,
  SYNTHESIS_STEPS,
  getStepsByCategory,
} from "./definitions";
import type { SynthesisCategoryDefinition, SynthesisStepType } from "./types";
import { cn } from "@/lib/utils";

// Category icon mapping
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Waves,
  Target,
  Database,
  Sparkles,
  Brain,
  FileOutput,
};

interface SynthesisPaletteProps {
  className?: string;
}

export function SynthesisPalette({ className }: SynthesisPaletteProps) {
  const { addStep, state, hasStep } = useSynthesisBuilder();
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    new Set(["basic", "targets"])
  );

  const toggleCategory = (id: string) => {
    const newOpen = new Set(openCategories);
    if (newOpen.has(id)) {
      newOpen.delete(id);
    } else {
      newOpen.add(id);
    }
    setOpenCategories(newOpen);
  };

  const handleAddStep = (type: SynthesisStepType) => {
    addStep(type);
  };

  // Check if step can be added (not already present or allowed duplicate)
  const canAddStep = (type: SynthesisStepType): boolean => {
    // For now, prevent duplicates of the same step type
    return !state.steps.some((s) => s.type === type);
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="p-4 border-b">
        <h2 className="text-sm font-semibold">Builder Steps</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Add steps to configure your synthetic dataset
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {SYNTHESIS_CATEGORIES.map((category) => (
            <CategorySection
              key={category.id}
              category={category}
              isOpen={openCategories.has(category.id)}
              onToggle={() => toggleCategory(category.id)}
              onAddStep={handleAddStep}
              canAddStep={canAddStep}
              hasStep={hasStep}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface CategorySectionProps {
  category: SynthesisCategoryDefinition;
  isOpen: boolean;
  onToggle: () => void;
  onAddStep: (type: SynthesisStepType) => void;
  canAddStep: (type: SynthesisStepType) => boolean;
  hasStep: (type: SynthesisStepType) => boolean;
}

function CategorySection({
  category,
  isOpen,
  onToggle,
  onAddStep,
  canAddStep,
  hasStep,
}: CategorySectionProps) {
  const steps = getStepsByCategory(category.id);
  const Icon = CATEGORY_ICONS[category.icon] || Sparkles;
  const activeCount = steps.filter((s) => hasStep(s.type)).length;

  return (
    <Collapsible open={isOpen} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-3 py-2 h-auto"
        >
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{category.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                {activeCount}
              </Badge>
            )}
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </div>
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-4 pr-2 py-1 space-y-1">
          {steps.map((step) => {
            const isActive = hasStep(step.type);
            const canAdd = canAddStep(step.type);

            return (
              <Tooltip key={step.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "w-full justify-start gap-2 h-8",
                      !canAdd && !isActive && "opacity-50"
                    )}
                    onClick={() => canAdd && onAddStep(step.type)}
                    disabled={!canAdd && !isActive}
                  >
                    <Plus className={cn("h-3 w-3", isActive && "opacity-0")} />
                    <span className="text-sm truncate">{step.name}</span>
                    {isActive && (
                      <Badge
                        variant="outline"
                        className="ml-auto h-4 px-1 text-[10px]"
                      >
                        Added
                      </Badge>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="font-medium">{step.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {step.description}
                  </p>
                  {step.mutuallyExclusive && step.mutuallyExclusive.length > 0 && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                      Mutually exclusive with:{" "}
                      {step.mutuallyExclusive.join(", ")}
                    </p>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
