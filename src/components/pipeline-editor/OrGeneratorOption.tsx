/**
 * OrGeneratorOption - Individual option row within an OR generator
 *
 * Extracted from OrGenerator.tsx to isolate the per-option presentation and
 * inline parameter editor. Behaviour is unchanged; OrGenerator.tsx re-exports
 * `OrOptionItem` from here as a façade for compatibility.
 */

import {
  X,
  ChevronDown,
  ChevronUp,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "./types";
import { getStepColor } from "./stepPresentation";
import {
  getOrOptionContainerClassNames,
  getOrOptionState,
} from "./OrGeneratorData";

/**
 * OrOptionItem - Individual option within an OR generator
 */
interface OrOptionItemProps {
  option: PipelineStep;
  index: number;
  isSelected?: boolean;
  isExpanded?: boolean;
  onSelect?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  onToggleExpand?: () => void;
  onUpdate?: (updates: Partial<PipelineStep>) => void;
}

export function OrOptionItem({
  option,
  index,
  isSelected = false,
  isExpanded = false,
  onSelect,
  onRemove,
  onDuplicate,
  onToggleExpand,
  onUpdate,
}: OrOptionItemProps) {
  const colors = getStepColor(option);
  const optionState = getOrOptionState(option, index, isExpanded);

  return (
    <div
      className={cn(...getOrOptionContainerClassNames(colors, isSelected))}
      aria-disabled={optionState.isDisabled}
    >
      {/* Option Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer"
        onClick={onSelect}
      >
        {/* Index indicator */}
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-background/50 text-xs font-mono text-muted-foreground">
          {optionState.indexLabel}
        </div>

        {/* Option name */}
        <div className="flex-1 min-w-0">
          <span className={cn("font-medium text-sm", colors.text)}>
            {option.name}
          </span>
          {optionState.parameterSummary && (
            <span className="ml-2 text-xs text-muted-foreground">
              {optionState.parameterSummary}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onToggleExpand && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand();
                  }}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {optionState.expandToggleLabel} parameters
              </TooltipContent>
            </Tooltip>
          )}
          {onDuplicate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate();
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Duplicate option</TooltipContent>
            </Tooltip>
          )}
          {onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove option</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Expanded Parameters */}
      {optionState.shouldShowParameters && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/50">
          {Object.entries(option.params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground capitalize flex-shrink-0 w-24">
                {key.replace(/_/g, " ")}
              </Label>
              <Input
                value={String(value)}
                onChange={(e) => {
                  if (!onUpdate) return;
                  const newValue =
                    typeof value === "number"
                      ? parseFloat(e.target.value) || 0
                      : typeof value === "boolean"
                      ? e.target.value === "true"
                      : e.target.value;
                  onUpdate({
                    params: { ...option.params, [key]: newValue },
                  });
                }}
                className="h-7 text-xs font-mono flex-1"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
