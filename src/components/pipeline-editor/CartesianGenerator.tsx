/**
 * CartesianGenerator - Stage-based cartesian generation UI
 *
 * Provides intuitive interface for creating stage combinations with:
 * - Multiple stages with options
 * - Add/remove stages and options
 * - Combination count preview
 * - Visual matrix for small combinations
 *
 * This file stays a thin orchestrator: combinatoric/label/badge rules live in
 * `CartesianGeneratorData.ts` and the repetitive visual sections live in
 * `CartesianGeneratorSections.tsx`.
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronUp, Grid, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepType, StepOption } from "./types";
import { calculateStepVariants } from "./variantCounting";
import {
  computeBaseCombinations,
  computeMatrixCombinations,
  generateCombinationExamples,
  getCartesianStageOptionsLabel,
  resolveCartesianStageLabel,
  type CartesianMatrixStage,
} from "./CartesianGeneratorData";
import {
  CartesianCombinationPreview,
  CartesianContainerHeader,
  CartesianInfoNote,
  StageConnector,
  StageOptionChip,
  StageOptionPicker,
} from "./CartesianGeneratorSections";

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
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [localLabel, setLocalLabel] = useState(
    resolveCartesianStageLabel(label, index)
  );

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
          {getCartesianStageOptionsLabel(options.length)}
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
          <div className="flex flex-wrap gap-2">
            {options.map((option, optIndex) => (
              <StageOptionChip
                key={option.id}
                option={option}
                canRemove={options.length > 1}
                onRemove={
                  onRemoveOption ? () => onRemoveOption(optIndex) : undefined
                }
              />
            ))}

            {onAddOption && <StageOptionPicker onAddOption={onAddOption} />}
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

  const baseCombinations = useMemo(
    () => computeBaseCombinations(stages),
    [stages]
  );

  const totalVariants = useMemo(() => calculateStepVariants(step), [step]);

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
  const combinationExamples = useMemo(
    () => generateCombinationExamples(stages, baseCombinations),
    [stages, baseCombinations]
  );

  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed border-cyan-500/30 bg-cyan-500/5 p-4 space-y-4",
        className
      )}
    >
      <CartesianContainerHeader
        stageCount={stages.length}
        baseCombinations={baseCombinations}
        totalVariants={totalVariants}
      />

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
            {stageIndex < stages.length - 1 && <StageConnector />}
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
      {combinationExamples.length > 0 && (
        <CartesianCombinationPreview
          examples={combinationExamples}
          baseCombinations={baseCombinations}
        />
      )}

      <CartesianInfoNote />
    </div>
  );
}

/**
 * CartesianPreview - Visual matrix showing combinations
 */
interface CartesianPreviewProps {
  stages: CartesianMatrixStage[];
  maxDisplay?: number;
  className?: string;
}

export function CartesianPreview({
  stages,
  maxDisplay = 50,
  className,
}: CartesianPreviewProps) {
  const totalCombinations = useMemo(
    () => computeMatrixCombinations(stages),
    [stages]
  );

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
