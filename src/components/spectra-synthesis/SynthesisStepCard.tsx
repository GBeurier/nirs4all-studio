/**
 * SynthesisStepCard - Individual step in the builder chain
 *
 * Displays a step with:
 * - Icon and name
 * - Toggle enabled/disabled
 * - Remove button
 * - Selected state
 */

import {
  Waves,
  Target,
  Tags,
  FileText,
  Split,
  Layers,
  GitMerge,
  TrendingUp,
  Shuffle,
  Mountain,
  FileOutput,
  X,
  GripVertical,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSynthesisBuilder } from "./contexts";
import { getStepDefinition } from "./definitions";
import type { SynthesisStep } from "./types";
import { cn } from "@/lib/utils";

// Icon mapping
const ICON_MAP: Record<string, LucideIcon> = {
  Waves,
  Target,
  Tags,
  FileText,
  Split,
  Layers,
  GitMerge,
  TrendingUp,
  Shuffle,
  Mountain,
  FileOutput,
};

interface SynthesisStepCardProps {
  step: SynthesisStep;
  isSelected: boolean;
  isDragging?: boolean;
  dragHandleProps?: Record<string, unknown>;
  className?: string;
}

export function SynthesisStepCard({
  step,
  isSelected,
  isDragging,
  dragHandleProps,
  className,
}: SynthesisStepCardProps) {
  const { selectStep, removeStep, toggleStep } = useSynthesisBuilder();
  const definition = getStepDefinition(step.type);

  if (!definition) return null;

  const Icon = ICON_MAP[definition.icon] || Waves;

  return (
    <Card
      className={cn(
        "transition-all duration-200 cursor-pointer group",
        definition.color.border,
        isSelected && "ring-2 ring-primary",
        !step.enabled && "opacity-50",
        isDragging && "shadow-lg scale-105",
        className
      )}
      onClick={() => selectStep(step.id)}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          {/* Drag handle */}
          <div
            className="cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Icon */}
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              definition.color.bg
            )}
          >
            <Icon className={cn("h-4 w-4", definition.color.text)} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium truncate">{definition.name}</h4>
              <code className="text-xs text-muted-foreground font-mono hidden sm:inline">
                .{definition.method}()
              </code>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {definition.description}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={step.enabled}
                    onCheckedChange={() => toggleStep(step.id)}
                    className="h-5 w-9"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {step.enabled ? "Disable step" : "Enable step"}
              </TooltipContent>
            </Tooltip>

            {/* Remove */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeStep(step.id);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove step</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
