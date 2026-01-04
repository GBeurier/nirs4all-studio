/**
 * CartesianGenerator - Stage-based cartesian generation UI
 *
 * Provides intuitive interface for creating stage combinations with:
 * - Multiple stages with options
 * - Add/remove stages and options
 * - Combination count preview
 * - Visual matrix for small combinations
 */

import { useState, useCallback, useMemo } from "react";
import {
  Grid,
  Plus,
  X,
  Layers,
  Info,
  ChevronDown,
  ChevronUp,
  Trash2,
  Copy,
  LayoutGrid,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepType, StepOption } from "./types";
import { stepOptions, stepColors, generateStepId, createStepFromOption } from "./types";

/**
 * CartesianStage - A single stage in the cartesian generator
 */
interface CartesianStageProps {
  /** Stage index (0-based) */
  index: number;
  /** Stage label/name */
  label?: string;
  /** Steps in this stage (options) */
  options: PipelineStep[];
  /** Whether the stage is expanded */
  isExpanded?: boolean;
  /** Callback when stage label changes */
  onLabelChange?: (label: string) => void;
  /** Callback when an option is added */
  onAddOption?: (type: StepType, option: StepOption) => void;
  /** Callback when an option is removed */
  onRemoveOption?: (optionIndex: number) => void;
  /** Callback when the stage is removed */
  onRemove?: () => void;
  /** Callback to toggle expansion */
  onToggleExpand?: () => void;
  /** Whether this is the only stage (can't be removed) */
  isOnlyStage?: boolean;
  /** Additional class names */
  className?: string;
}

export function CartesianStage({
  index,
  label,
  options,
  isExpanded = true,
  onLabelChange,
  onAddOption,
  onRemoveOption,
  onRemove,
  onToggleExpand,
  isOnlyStage = false,
  className,
}: CartesianStageProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [localLabel, setLocalLabel] = useState(label || `Stage ${index + 1}`);

  // Filter step options
  const filteredStepOptions = useMemo(() => {
    const query = searchQuery.toLowerCase();
    const result: { type: StepType; options: StepOption[] }[] = [];

    (["preprocessing", "model"] as StepType[]).forEach((type) => {
      const typeOptions = stepOptions[type].filter(
        (opt) =>
          opt.name.toLowerCase().includes(query) ||
          opt.description.toLowerCase().includes(query)
      );
      if (typeOptions.length > 0) {
        result.push({ type, options: typeOptions });
      }
    });

    return result;
  }, [searchQuery]);

  // Save label on blur
  const handleLabelBlur = useCallback(() => {
    setIsEditingLabel(false);
    onLabelChange?.(localLabel);
  }, [localLabel, onLabelChange]);

  return (
    <div
      className={cn(
        "rounded-lg border border-cyan-500/30 bg-cyan-500/5 overflow-hidden",
        className
      )}
    >
      {/* Stage Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-cyan-500/10">
        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500 text-white text-xs font-bold">
          {index + 1}
        </div>

        {isEditingLabel ? (
          <Input
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleLabelBlur();
              }
            }}
            autoFocus
            className="h-6 text-sm font-medium flex-1"
          />
        ) : (
          <span
            className="font-medium text-sm text-cyan-700 dark:text-cyan-300 cursor-pointer hover:underline flex-1"
            onClick={() => setIsEditingLabel(true)}
          >
            {localLabel}
          </span>
        )}

        <Badge variant="secondary" className="text-xs bg-cyan-500/20 text-cyan-600">
          {options.length} option{options.length !== 1 ? "s" : ""}
        </Badge>

        <div className="flex items-center gap-1">
          {onToggleExpand && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={onToggleExpand}
            >
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {!isOnlyStage && onRemove && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                  onClick={onRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove stage</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Stage Options */}
      {isExpanded && (
        <div className="p-3 space-y-2">
          {/* Options list */}
          <div className="flex flex-wrap gap-2">
            {options.map((option, optIndex) => (
              <div
                key={option.id}
                className={cn(
                  "group flex items-center gap-1.5 px-2 py-1 rounded-md border text-sm",
                  stepColors[option.type].border,
                  stepColors[option.type].bg
                )}
              >
                <span className={stepColors[option.type].text}>
                  {option.name}
                </span>
                {options.length > 1 && onRemoveOption && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => onRemoveOption(optIndex)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}

            {/* Add option button */}
            {onAddOption && (
              <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 border-dashed border-cyan-500/50 text-cyan-500 hover:bg-cyan-500/10"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-64 p-2 bg-popover"
                >
                  <Input
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-2 h-7 text-xs"
                  />
                  <ScrollArea className="h-48">
                    {filteredStepOptions.map(({ type, options: opts }) => (
                      <div key={type} className="mb-2">
                        <div className="text-xs font-medium text-muted-foreground px-2 py-1 capitalize">
                          {type}
                        </div>
                        {opts.slice(0, 5).map((opt) => (
                          <Button
                            key={opt.name}
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-xs h-7"
                            onClick={() => {
                              onAddOption(type, opt);
                              setShowAddPopover(false);
                              setSearchQuery("");
                            }}
                          >
                            <span className={stepColors[type].text}>{opt.name}</span>
                          </Button>
                        ))}
                      </div>
                    ))}
                  </ScrollArea>
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * CartesianGeneratorContainer - Main container for cartesian generator
 */
interface CartesianGeneratorContainerProps {
  /** The generator step */
  step: PipelineStep;
  /** Stages (each stage is a branch with options) */
  stages: PipelineStep[][];
  /** Stage labels */
  stageLabels?: string[];
  /** Callback when a stage is added */
  onAddStage?: () => void;
  /** Callback when a stage is removed */
  onRemoveStage?: (stageIndex: number) => void;
  /** Callback when an option is added to a stage */
  onAddOption?: (stageIndex: number, type: StepType, option: StepOption) => void;
  /** Callback when an option is removed from a stage */
  onRemoveOption?: (stageIndex: number, optionIndex: number) => void;
  /** Callback when stage label changes */
  onStageLabelChange?: (stageIndex: number, label: string) => void;
  /** Whether the container is in edit mode */
  isEditing?: boolean;
  /** Additional class names */
  className?: string;
}

export function CartesianGeneratorContainer({
  step,
  stages,
  stageLabels = [],
  onAddStage,
  onRemoveStage,
  onAddOption,
  onRemoveOption,
  onStageLabelChange,
  isEditing = true,
  className,
}: CartesianGeneratorContainerProps) {
  const [expandedStages, setExpandedStages] = useState<Set<number>>(
    () => new Set(stages.map((_, i) => i))
  );

  // Calculate total combinations
  const totalCombinations = useMemo(() => {
    return stages.reduce((acc, stage) => acc * Math.max(1, stage.length), 1);
  }, [stages]);

  // Toggle stage expansion
  const toggleStage = useCallback((index: number) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Generate combination examples for preview
  const combinationExamples = useMemo(() => {
    if (stages.length === 0) return [];
    if (totalCombinations > 20) return []; // Too many to show

    const examples: string[][] = [];

    const generateCombinations = (
      currentStage: number,
      current: string[]
    ): void => {
      if (currentStage >= stages.length) {
        examples.push([...current]);
        return;
      }

      const stage = stages[currentStage];
      if (stage.length === 0) {
        generateCombinations(currentStage + 1, [...current, "(empty)"]);
      } else {
        for (const option of stage) {
          generateCombinations(currentStage + 1, [...current, option.name]);
        }
      }
    };

    generateCombinations(0, []);
    return examples.slice(0, 10); // Limit to 10 examples
  }, [stages, totalCombinations]);

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed border-cyan-500/30 bg-cyan-500/5 p-4 space-y-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/20">
            <LayoutGrid className="h-4 w-4 text-cyan-500" />
          </div>
          <div>
            <h4 className="font-medium text-sm text-cyan-600">
              Cartesian (_cartesian_)
            </h4>
            <p className="text-xs text-muted-foreground">
              {stages.length} stage{stages.length !== 1 ? "s" : ""} •{" "}
              {totalCombinations.toLocaleString()} combination
              {totalCombinations !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <Badge
          variant="secondary"
          className={cn(
            "text-sm font-bold",
            totalCombinations > 100
              ? "bg-orange-500/20 text-orange-600"
              : totalCombinations > 1000
              ? "bg-red-500/20 text-red-600"
              : "bg-cyan-500/20 text-cyan-600"
          )}
        >
          {totalCombinations.toLocaleString()} pipelines
        </Badge>
      </div>

      {/* Stages */}
      <div className="space-y-3">
        {stages.map((stage, stageIndex) => (
          <div key={stageIndex} className="relative">
            <CartesianStage
              index={stageIndex}
              label={stageLabels[stageIndex]}
              options={stage}
              isExpanded={expandedStages.has(stageIndex)}
              onToggleExpand={() => toggleStage(stageIndex)}
              onLabelChange={(label) => onStageLabelChange?.(stageIndex, label)}
              onAddOption={(type, option) =>
                onAddOption?.(stageIndex, type, option)
              }
              onRemoveOption={(optionIndex) =>
                onRemoveOption?.(stageIndex, optionIndex)
              }
              onRemove={
                stages.length > 1
                  ? () => onRemoveStage?.(stageIndex)
                  : undefined
              }
              isOnlyStage={stages.length === 1}
            />

            {/* Arrow between stages */}
            {stageIndex < stages.length - 1 && (
              <div className="flex justify-center py-1">
                <ArrowRight className="h-4 w-4 text-cyan-500/50 rotate-90" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add Stage */}
      {isEditing && onAddStage && (
        <Button
          variant="outline"
          className="w-full border-dashed border-cyan-500/30 text-cyan-500 hover:bg-cyan-500/10"
          onClick={onAddStage}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Stage
        </Button>
      )}

      {/* Combination Preview */}
      {combinationExamples.length > 0 && combinationExamples.length <= 10 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full text-xs">
              <Grid className="h-3.5 w-3.5 mr-1" />
              Preview Combinations
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 p-3 rounded-lg bg-background/50 space-y-1.5">
              {combinationExamples.map((combo, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 text-xs font-mono"
                >
                  <span className="text-muted-foreground w-4">{idx + 1}.</span>
                  {combo.map((step, stepIdx) => (
                    <span key={stepIdx} className="flex items-center">
                      {stepIdx > 0 && (
                        <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground" />
                      )}
                      <Badge variant="outline" className="text-xs py-0">
                        {step}
                      </Badge>
                    </span>
                  ))}
                </div>
              ))}
              {totalCombinations > 10 && (
                <p className="text-xs text-muted-foreground pt-1">
                  ...and {totalCombinations - 10} more combinations
                </p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 p-2 rounded-lg bg-background/50 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
        <span>
          Generates all combinations across stages. Each stage can have multiple
          options; one from each stage is selected per pipeline variant.
        </span>
      </div>
    </div>
  );
}

/**
 * CartesianPreview - Visual matrix showing combinations
 */
interface CartesianPreviewProps {
  stages: { label: string; options: string[] }[];
  maxDisplay?: number;
  className?: string;
}

export function CartesianPreview({
  stages,
  maxDisplay = 50,
  className,
}: CartesianPreviewProps) {
  const totalCombinations = useMemo(() => {
    return stages.reduce((acc, stage) => acc * Math.max(1, stage.options.length), 1);
  }, [stages]);

  if (totalCombinations > maxDisplay) {
    return (
      <div className={cn("text-center py-4 text-sm text-muted-foreground", className)}>
        <Grid className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>
          {totalCombinations.toLocaleString()} combinations
          <br />
          <span className="text-xs">(too many to display)</span>
        </p>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-2", className)}>
      {/* Header row */}
      <div className="flex gap-2">
        {stages.map((stage, idx) => (
          <div
            key={idx}
            className="flex-1 text-center text-xs font-medium text-muted-foreground px-2 py-1 bg-muted rounded"
          >
            {stage.label}
          </div>
        ))}
      </div>

      {/* Combination rows - simplified for large numbers */}
      <div className="text-xs text-muted-foreground text-center">
        {totalCombinations <= 20 ? (
          <span>
            {stages
              .map((s) => s.options.length)
              .join(" × ")}{" "}
            = {totalCombinations} combinations
          </span>
        ) : (
          <span>{totalCombinations} total combinations</span>
        )}
      </div>
    </div>
  );
}
