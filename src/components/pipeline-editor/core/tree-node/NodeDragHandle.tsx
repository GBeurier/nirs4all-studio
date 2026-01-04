/**
 * NodeDragHandle - Drag handle for tree node items
 *
 * Extracted from TreeNode for cleaner component structure.
 * Provides consistent drag handle styling and accessibility.
 */

import { GripVertical } from "lucide-react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";

interface NodeDragHandleProps {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  className?: string;
}

/**
 * Reusable drag handle component
 */
export function NodeDragHandle({ attributes, listeners, className = "" }: NodeDragHandleProps) {
  return (
    <button
      {...attributes}
      {...listeners}
      className={`cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted transition-colors touch-none shrink-0 ${className}`}
      aria-label="Drag to reorder"
    >
      <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}
