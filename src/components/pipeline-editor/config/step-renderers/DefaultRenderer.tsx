/**
 * DefaultRenderer - Generic step configuration renderer
 *
 * Used for step types that follow the standard pattern:
 * 1. Algorithm selection dropdown
 * 2. Parameter list with sweep support
 *
 * This applies to: preprocessing, splitting, filter, augmentation
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { Info, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { stepOptions } from "../../types";
import { StepActions } from "./StepActions";
import type { ParameterRendererProps } from "./types";

/**
 * DefaultRenderer - Standard algorithm selection + parameters UI
 *
 * Renders:
 * - Algorithm dropdown with available options for the step type
 * - Parameter inputs with sweep support
 * - Action buttons (duplicate, remove)
 */
export function DefaultRenderer({
  step,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: ParameterRendererProps) {
  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Step Algorithm Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Algorithm</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>Select the algorithm for this {step.type} step</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select value={step.name} onValueChange={handleNameChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-[300px]">
                {stepOptions[step.type]?.map((opt) => (
                  <SelectItem key={opt.name} value={opt.name}>
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentOption && (
              <p className="text-xs text-muted-foreground">
                {currentOption.description}
              </p>
            )}
          </div>

          <Separator />

          {/* Parameters */}
          {Object.keys(step.params).length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Parameters</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleResetParams}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              {Object.entries(step.params).map(([key, value]) =>
                renderParamInput(key, value)
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="p-3 rounded-full bg-muted/50 w-fit mx-auto mb-3">
                <Info className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No configurable parameters
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This step uses default settings
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}
