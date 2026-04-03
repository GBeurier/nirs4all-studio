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
  const childrenPath = [...parentPath, "children"];

  const { setNodeRef: setEmptyDropRef, isOver: isOverEmpty } = useDroppable({
    id: `container-${parentStep.id}-children-empty`,
    data: {
      type: "container-drop-zone",
      path: childrenPath,
      parentStepId: parentStep.id,
      index: 0,
      position: "inside",
      accepts: ["preprocessing", "y_processing", "filter", "augmentation"],
    },
  });

  return (
    <div className={`border-l border-dashed ${colors.border} ml-1.5 pl-3`}>
      {children.length === 0 ? (
        <div
          ref={setEmptyDropRef}
          className={`
            py-2 px-3 text-xs text-muted-foreground rounded border border-dashed transition-all cursor-pointer
            ${isOverEmpty ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30"}
          `}
          onClick={() => onAddChild?.(parentStep.id, parentPath)}
        >
          {isOverEmpty
            ? "Drop transformer here"
            : `No ${childLabel}s - click to add or drop here`}
        </div>
      ) : (
        <div className="space-y-1">
          <ContainerInsertDropZone
            id={`container-${parentStep.id}-before-0`}
            path={childrenPath}
            index={0}
            childLabel={childLabel}
          />
          {children.map((child, idx) => (
            <div key={child.id}>
              <ContainerChildItem
                child={child}
                index={idx}
                parentStep={parentStep}
                parentPath={parentPath}
                path={childrenPath}
                isSelected={selectedStepId === child.id}
                onSelect={() => onSelectStep(child.id)}
                onRemove={() => onRemoveChild?.(parentStep.id, child.id, parentPath)}
              />
              <ContainerInsertDropZone
                id={`container-${parentStep.id}-after-${child.id}`}
                path={childrenPath}
                index={idx + 1}
                childLabel={childLabel}
              />
            </div>
          ))}
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
  path,
  isSelected,
  onSelect,
  onRemove,
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

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-child-${child.id}`,
    data: {
      type: "step-item",
      stepId: child.id,
      path,
      index,
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
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`
        group flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-all
        ${isBeingDragged ? "opacity-30" : "opacity-100"}
        ${
          isSelected
            ? `${childColors.bg} ${childColors.border} border ring-1 ${childColors.active || "ring-primary"}`
            : "hover:bg-muted/50 border border-transparent"
        }
        ${isOver && !isBeingDragged ? "ring-1 ring-primary/50 border-primary/40" : ""}
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

function ContainerInsertDropZone({
  id,
  path,
  index,
  childLabel,
}: {
  id: string;
  path: string[];
  index: number;
  childLabel: string;
}) {
  const { dropIndicator } = usePipelineDnd();
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: "container-drop-zone",
      path,
      index,
      position: "before",
      accepts: ["preprocessing", "y_processing", "filter", "augmentation"],
    },
  });

  const isActive =
    dropIndicator?.path.length === path.length &&
    dropIndicator.path.every((segment, segmentIndex) => segment === path[segmentIndex]) &&
    dropIndicator.index === index;

  const showIndicator = isOver || isActive;

  return (
    <div
      ref={setNodeRef}
      className={`transition-all duration-100 ${showIndicator ? "py-0.5" : "h-1.5"}`}
    >
      {showIndicator && (
        <div className="h-8 rounded-lg border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center gap-1">
          <Plus className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-medium text-primary">Drop {childLabel}</span>
        </div>
      )}
    </div>
  );
}
