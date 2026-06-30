import type { ComponentPropsWithoutRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Copy, Settings, Trash2 } from "lucide-react";
import { motion } from "@/lib/motion";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePipelineDnd } from "./usePipelineDnd";
import { PipelineNodeContent } from "./PipelineNodeContent";
import { getPipelineNodePresentation } from "./PipelineNodePresentation";
import { type PipelineStep } from "./types";

interface PipelineNodeProps {
  step: PipelineStep;
  index: number;
  path: string[]; // Path to this node in the tree
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
  depth?: number;
}

export function PipelineNode({
  step,
  index,
  path,
  isSelected,
  onSelect,
  onRemove,
  onDuplicate,
  onAddBranch,
  onRemoveBranch,
  depth = 0,
}: PipelineNodeProps) {
  const { isDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === step.id;
  const presentation = getPipelineNodePresentation(step);
  const { colors } = presentation;

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
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

  const dragHandleProps = {
    ...attributes,
    ...listeners,
  } as ComponentPropsWithoutRef<"button">;

  const nodeContent = (
    <motion.div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      layout
      initial={{ opacity: 0, scale: 0.95, y: -10 }}
      animate={{
        opacity: isBeingDragged ? 0.3 : 1,
        scale: isBeingDragged ? 0.98 : 1,
        y: 0,
      }}
      exit={{ opacity: 0, scale: 0.95, y: -10 }}
      transition={{
        layout: { duration: 0.2, ease: "easeOut" },
        opacity: { duration: 0.15 },
        scale: { duration: 0.15 },
      }}
      className={`
        group relative rounded-xl border-2 transition-all duration-200 bg-card w-full overflow-hidden
        ${colors.border}
        ${isSelected ? `ring-2 ${colors.active} shadow-lg` : ""}
        ${isOver && !isBeingDragged ? "ring-2 ring-primary/50 border-primary/50" : ""}
        ${!isBeingDragged ? "hover:shadow-md" : ""}
      `}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      style={{
        marginLeft: depth > 0 ? "0" : undefined,
      }}
    >
      <PipelineNodeContent
        step={step}
        index={index}
        path={path}
        depth={depth}
        presentation={presentation}
        dragHandleProps={dragHandleProps}
        isDragging={isDragging}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        onAddBranch={onAddBranch}
        onRemoveBranch={onRemoveBranch}
      />
    </motion.div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {nodeContent}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onSelect}>
          <Settings className="h-4 w-4 mr-2" />
          Configure
        </ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onRemove}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
