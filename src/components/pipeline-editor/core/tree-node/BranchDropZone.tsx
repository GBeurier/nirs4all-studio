/**
 * BranchDropZone - Drop zone within a branch for DnD
 *
 * Provides visual feedback when dragging steps into branches.
 */

import { useDroppable } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { usePipelineDnd } from "../../PipelineDndContext";
import type { BranchDropZoneProps } from "./types";

/**
 * Drop zone component for branch insertion points
 */
export function BranchDropZone({ id, path, index }: BranchDropZoneProps) {
  const { dropIndicator } = usePipelineDnd();

  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: "drop-zone",
      path,
      index,
      position: "before",
      accepts: true,
    },
  });

  const isActive =
    dropIndicator?.path.length === path.length &&
    dropIndicator?.path.every((p, i) => p === path[i]) &&
    dropIndicator?.index === index;

  const showIndicator = isOver || isActive;

  return (
    <div
      ref={setNodeRef}
      className={`transition-all duration-100 ${showIndicator ? "py-0.5" : "h-0.5"}`}
    >
      {showIndicator && (
        <div className="h-8 rounded-lg border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center gap-1">
          <Plus className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-medium text-primary">Drop here</span>
        </div>
      )}
    </div>
  );
}
