import { createContext, useContext } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import type { DragData, DropIndicator } from "./types";

export interface PipelineDndContextValue {
  activeData: DragData | null;
  dropIndicator: DropIndicator | null;
  isDragging: boolean;
  activeId: UniqueIdentifier | null;
}

export const PipelineDndContext = createContext<PipelineDndContextValue | null>(null);

export function usePipelineDnd() {
  const context = useContext(PipelineDndContext);
  if (!context) {
    throw new Error("usePipelineDnd must be used within PipelineDndProvider");
  }
  return context;
}
