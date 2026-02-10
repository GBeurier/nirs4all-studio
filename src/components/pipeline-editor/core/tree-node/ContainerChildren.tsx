/**
 * ContainerChildren - Renders children of container steps
 *
 * For sample_augmentation, feature_augmentation, sample_filter, concat_transform
 * step types that can have nested child steps.
 */

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Plus, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineDnd } from "../../PipelineDndContext";
import { getStepColor } from "../../types";
import type { ContainerChildrenNodeProps, ContainerChildItemProps } from "./types";
import { getStepIcon } from "./utils";

/**
 * Container children node - renders children of container steps
 */
export function ContainerChildrenNode({
  children,
  parentStep,
  parentPath,
  depth,
  childLabel,
  selectedStepId,
  onSelectStep,
  onRemoveChild,
  onAddChild,
  colors,
}: ContainerChildrenNodeProps) {
  const { dropIndicator } = usePipelineDnd();
  const childrenPath = [...parentPath, "children"];

  // Drop zone for adding new children at end
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `container-${parentStep.id}-children`,
    data: {
      type: "container-drop-zone",
      path: childrenPath,
      parentStepId: parentStep.id,
      index: children.length,
      position: "inside",
      accepts: ["preprocessing", "y_processing", "filter", "augmentation"],
    },
  });

  return (
    <div className={`border-l border-dashed ${colors.border} ml-1.5 pl-3`}>
      {children.length === 0 ? (
        <div
          ref={setDropRef}
          className={`
            py-2 px-3 text-xs text-muted-foreground rounded border border-dashed transition-all cursor-pointer
            ${isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30"}
          `}
          onClick={() => onAddChild?.(parentStep.id, parentPath)}
        >
          {isOver
            ? "Drop transformer here"
            : `No ${childLabel}s - click to add or drop here`}
        </div>
      ) : (
        <div className="space-y-1">
          {children.map((child, idx) => (
            <ContainerChildItem
              key={child.id}
              child={child}
              index={idx}
              parentStep={parentStep}
              parentPath={parentPath}
              childLabel={childLabel}
              isSelected={selectedStepId === child.id}
              onSelect={() => onSelectStep(child.id)}
              onRemove={() => onRemoveChild?.(parentStep.id, child.id, parentPath)}
              colors={colors}
            />
          ))}
          {/* Drop zone at the end - only visible when dragging over */}
          <div
            ref={setDropRef}
            className={`
              rounded border border-dashed transition-all flex items-center justify-center
              ${isOver ? "h-8 border-primary bg-primary/10" : "h-1 border-transparent"}
            `}
          >
            {isOver && (
              <>
                <Plus className="h-3 w-3 text-primary mr-1" />
                <span className="text-[10px] text-primary">Drop {childLabel}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Individual child item within a container
 */
export function ContainerChildItem({
  child,
  index,
  parentStep,
  parentPath,
  childLabel,
  isSelected,
  onSelect,
  onRemove,
  colors,
}: ContainerChildItemProps) {
  const Icon = getStepIcon(child);
  const childColors = getStepColor(child);
  const { isDragging: globalIsDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === child.id;

  // Make this child item draggable
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({
    id: child.id,
    data: {
      type: "pipeline-step",
      stepId: child.id,
      step: child,
      sourcePath: [...parentPath, "children"],
      isContainerChild: true,
      parentStepId: parentStep.id,
    },
  });

  // Format child parameters
  const paramEntries = Object.entries(child.params);
  const displayParams = paramEntries
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return (
    <div
      ref={setDragRef}
      className={`
        group flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-all
        ${isBeingDragged ? "opacity-30" : "opacity-100"}
        ${
          isSelected
            ? `${childColors.bg} ${childColors.border} border ring-1 ${childColors.active || "ring-primary"}`
            : "hover:bg-muted/50 border border-transparent"
        }
      `}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted transition-colors touch-none shrink-0 opacity-50 group-hover:opacity-100"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </button>

      {/* Child icon */}
      <Icon className={`h-3 w-3 flex-shrink-0 ${childColors.text}`} />

      {/* Child info */}
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate">{child.name || child.type}</span>
        {displayParams && (
          <span className="text-muted-foreground ml-1 truncate">
            ({displayParams})
          </span>
        )}
      </div>

      {/* Remove button - visible on hover */}
      {!globalIsDragging && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
