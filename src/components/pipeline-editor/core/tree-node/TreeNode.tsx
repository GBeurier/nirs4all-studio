/**
 * TreeNode - Refactored tree node component
 *
 * Renders a single step in the pipeline tree with:
 * - Drag handle for reordering
 * - Step icon and info
 * - Quick action buttons
 * - Context menu
 * - Nested branches/children (for branch, generator, and container steps)
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/component_refactoring_specs.md
 */

import { useState, useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Copy,
  Trash2,
  Plus,
  Settings,
  ChevronRight,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePipelineDnd } from "../../PipelineDndContext";
import { stepColors } from "../../types";
import type { TreeNodeProps } from "./types";
import {
  stepIcons,
  isContainerStep,
  getContainerChildLabel,
  isBranchableStep,
  getBranchLabel,
  computeSweepInfo,
  computeFinetuneInfo,
  computeGeneratorInfo,
  getDisplayParams,
  getFoldLabel,
} from "./utils";
import { NodeDragHandle } from "./NodeDragHandle";
import { NodeActions } from "./NodeActions";
import { NodeHeader } from "./NodeHeader";
import { BranchNode } from "./BranchNode";
import { ContainerChildrenNode } from "./ContainerChildren";

/**
 * TreeNode - Main tree node component
 */
export function TreeNode({
  step,
  index,
  path,
  depth,
  isSelected,
  onSelect,
  onRemove,
  onDuplicate,
  onAddBranch,
  onRemoveBranch,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onAddBranchNested,
  onRemoveBranchNested,
  onAddChild,
  onRemoveChild,
  onUpdateStep,
}: TreeNodeProps) {
  const { isDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === step.id;
  const [isBranchesExpanded, setIsBranchesExpanded] = useState(true);
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(true);

  // Check if this is a container step with children
  const isContainer = isContainerStep(step);
  const containerChildren = step.children ?? [];
  const childLabel = getContainerChildLabel(step.type);

  // DnD setup
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: step.id,
    data: {
      type: "pipeline-step",
      stepId: step.id,
      step,
      sourcePath: path,
    },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${step.id}`,
    data: {
      type: "step-item",
      stepId: step.id,
      path,
      index,
    },
  });

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];

  // Use memoized computed values from utilities
  const sweepInfo = useMemo(() => computeSweepInfo(step), [step.paramSweeps, step.stepGenerator]);
  const finetuneInfo = useMemo(() => computeFinetuneInfo(step), [step.finetuneConfig]);
  const generatorInfo = useMemo(() => computeGeneratorInfo(step), [step.type, step.generatorKind, step.generatorOptions, step.branches]);
  const displayParams = useMemo(() => getDisplayParams(step, sweepInfo.sweepKeys), [step.params, sweepInfo.sweepKeys]);

  // Determine if this node is foldable
  const isBranchable = isBranchableStep(step);
  const isFoldable = (isBranchable && step.branches && step.branches.length > 0) || (isContainer && containerChildren.length > 0);
  const isExpanded = isBranchable ? isBranchesExpanded : isChildrenExpanded;
  const setIsExpanded = isBranchable ? setIsBranchesExpanded : setIsChildrenExpanded;
  const branchLabel = getBranchLabel(step);
  const foldLabel = getFoldLabel(step, childLabel);

  const nodeContent = (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`
        group flex items-center gap-2 py-1.5 px-2 rounded-lg border transition-all duration-100
        ${isBeingDragged ? "opacity-30" : "opacity-100"}
        ${isSelected
          ? colors.selected
          : `${colors.border} ${colors.bg} ${colors.hover}`
        }
        ${isOver && !isBeingDragged ? "ring-1 ring-primary/50" : ""}
      `}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Expand/Collapse toggle for foldable nodes */}
      {isFoldable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={`p-0.5 rounded hover:bg-muted transition-colors shrink-0 ${colors.text}`}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span className="text-xs">
              {isExpanded ? "Collapse" : "Expand"} {foldLabel}
            </span>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Drag Handle */}
      <NodeDragHandle attributes={attributes} listeners={listeners} />

      {/* Step Icon */}
      <div className={`p-1.5 rounded ${colors.bg} ${colors.text} shrink-0`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Step Info */}
      <NodeHeader
        step={step}
        Icon={Icon}
        colors={colors}
        hasSweeps={sweepInfo.hasSweeps}
        totalVariants={sweepInfo.totalVariants}
        sweepCount={sweepInfo.sweepCount}
        sweepSummary={sweepInfo.sweepSummary}
        displayParams={displayParams}
        hasFinetuning={finetuneInfo.hasFinetuning}
        finetuneTrials={finetuneInfo.finetuneTrials}
        finetuneParamCount={finetuneInfo.finetuneParamCount}
        isContainer={isContainer}
        containerChildren={containerChildren}
        childLabel={childLabel}
        isGenerator={generatorInfo.isGenerator}
        generatorKind={generatorInfo.generatorKind}
        generatorVariantCount={generatorInfo.variantCount}
        generatorOptionCount={generatorInfo.optionCount}
        generatorSelectionSummary={generatorInfo.selectionSummary}
        generatorOptionNames={generatorInfo.optionNames}
      />

      {/* Quick Actions */}
      <NodeActions
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        visible={!isDragging}
      />
    </div>
  );

  return (
    <div className="relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>{nodeContent}</ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={onSelect}>
            <Settings className="h-3.5 w-3.5 mr-2" />
            Configure
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            Duplicate
          </ContextMenuItem>
          {step.type === "model" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={onSelect}
                className="text-purple-500 focus:text-purple-600"
              >
                <Sparkles className="h-3.5 w-3.5 mr-2" />
                {finetuneInfo.hasFinetuning ? "Edit Finetuning" : "Configure Finetuning"}
              </ContextMenuItem>
            </>
          )}
          {isBranchable && onAddBranch && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onAddBranch}>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add {branchLabel}
              </ContextMenuItem>
            </>
          )}
          {isContainer && onAddChild && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => onAddChild(step.id, path)}
                className={colors.text}
              >
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add {childLabel}
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={onRemove}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Render branches as nested tree */}
      {isBranchable && step.branches && isBranchesExpanded && (
        <div className="ml-4 mt-1">
          {step.branches.map((branch, branchIndex) => (
            <BranchNode
              key={branchIndex}
              branch={branch}
              branchIndex={branchIndex}
              parentPath={[...path, step.id]}
              parentStepId={step.id}
              depth={depth + 1}
              canRemove={step.branches!.length > 1}
              onRemoveBranch={
                onRemoveBranchNested
                  ? (bIdx) => onRemoveBranchNested(step.id, bIdx, path)
                  : undefined
              }
              selectedStepId={selectedStepId}
              onSelectStep={onSelectStep}
              onRemoveStep={onRemoveStep}
              onDuplicateStep={onDuplicateStep}
              onAddBranchNested={onAddBranchNested}
              onRemoveBranchNested={onRemoveBranchNested}
              onAddChild={onAddChild}
              onRemoveChild={onRemoveChild}
              isGenerator={step.type === "generator"}
              branchLabel={branchLabel}
            />
          ))}
          {/* Add branch button */}
          {onAddBranch && (
            <button
              onClick={onAddBranch}
              className={`flex items-center gap-1.5 text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors ml-2 mt-1 ${
                step.type === "generator"
                  ? "text-orange-500 hover:text-orange-600"
                  : "text-muted-foreground hover:text-primary"
              }`}
            >
              <Plus className="h-3 w-3" />
              <span>Add {branchLabel.toLowerCase()}</span>
            </button>
          )}
        </div>
      )}

      {/* Render container children */}
      {isContainer && isChildrenExpanded && (
        <div className="ml-4 mt-1">
          <ContainerChildrenNode
            children={containerChildren}
            parentStep={step}
            parentPath={[...path, step.id]}
            depth={depth + 1}
            childLabel={childLabel}
            selectedStepId={selectedStepId}
            onSelectStep={onSelectStep}
            onRemoveChild={onRemoveChild}
            onAddChild={onAddChild}
            colors={colors}
          />
        </div>
      )}
    </div>
  );
}
