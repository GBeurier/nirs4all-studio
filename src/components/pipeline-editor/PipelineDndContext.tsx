import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragMoveEvent,
  DragEndEvent,
  DragOverEvent,
  closestCenter,
  pointerWithin,
  rectIntersection,
  CollisionDetection,
  UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { motion, AnimatePresence } from "framer-motion";
import {
  Waves,
  Shuffle,
  Target,
  Sparkles,
  GitBranch,
  GitMerge,
} from "lucide-react";
import type { PipelineStep, StepType, StepOption, DragData, DropIndicator } from "./types";
import { stepColors } from "./types";

// Icons for step types
const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
};

interface PipelineDndContextValue {
  activeData: DragData | null;
  dropIndicator: DropIndicator | null;
  isDragging: boolean;
  activeId: UniqueIdentifier | null;
}

const PipelineDndContext = createContext<PipelineDndContextValue | null>(null);

export function usePipelineDnd() {
  const context = useContext(PipelineDndContext);
  if (!context) {
    throw new Error("usePipelineDnd must be used within PipelineDndProvider");
  }
  return context;
}

interface PipelineDndProviderProps {
  children: ReactNode;
  onDrop: (data: DragData, indicator: DropIndicator) => void;
  onReorder: (activeId: string, overId: string, activeData: DragData) => void;
}

// Custom collision detection that prioritizes drop zones
const customCollisionDetection: CollisionDetection = (args) => {
  // First check for pointer within (more precise for nested structures)
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  // Fall back to rect intersection
  const rectCollisions = rectIntersection(args);
  if (rectCollisions.length > 0) {
    return rectCollisions;
  }

  // Finally try closest center
  return closestCenter(args);
};

export function PipelineDndProvider({ children, onDrop, onReorder }: PipelineDndProviderProps) {
  const [activeData, setActiveData] = useState<DragData | null>(null);
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);

  // Configure sensors with proper activation constraints
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Small distance for snappy feel
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const data = active.data.current as DragData;
    setActiveData(data);
    setActiveId(active.id);

    // Add dragging class to body for global cursor
    document.body.classList.add("dragging");
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    // Could be used for custom cursor position tracking
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;

    if (!over) {
      setDropIndicator(null);
      return;
    }

    const overData = over.data.current as {
      type: string;
      path?: string[];
      index?: number;
      position?: "before" | "after" | "inside";
      accepts?: boolean;
    };

    if (overData?.type === "drop-zone" && overData.accepts !== false) {
      setDropIndicator({
        path: overData.path || [],
        index: overData.index ?? 0,
        position: overData.position || "after",
      });
    } else if (overData?.type === "step-item") {
      // Dropping on a step - figure out before/after based on position
      setDropIndicator({
        path: overData.path || [],
        index: overData.index ?? 0,
        position: "after",
      });
    } else {
      setDropIndicator(null);
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    document.body.classList.remove("dragging");

    const data = active.data.current as DragData;

    if (over && data) {
      const overData = over.data.current as {
        type: string;
        path?: string[];
        index?: number;
        stepId?: string;
        position?: "before" | "after" | "inside";
      };

      if (overData?.type === "drop-zone") {
        // Dropping into a drop zone
        const indicator: DropIndicator = {
          path: overData.path || [],
          index: overData.index ?? 0,
          position: overData.position || "after",
        };
        onDrop(data, indicator);
      } else if (overData?.type === "step-item" && data.type === "pipeline-step") {
        // Reordering within the pipeline
        if (data.stepId && overData.stepId && data.stepId !== overData.stepId) {
          onReorder(data.stepId, overData.stepId, data);
        }
      }
    }

    setActiveData(null);
    setDropIndicator(null);
    setActiveId(null);
  }, [onDrop, onReorder]);

  const handleDragCancel = useCallback(() => {
    document.body.classList.remove("dragging");
    setActiveData(null);
    setDropIndicator(null);
    setActiveId(null);
  }, []);

  const contextValue = useMemo<PipelineDndContextValue>(() => ({
    activeData,
    dropIndicator,
    isDragging: activeData !== null,
    activeId,
  }), [activeData, dropIndicator, activeId]);

  return (
    <PipelineDndContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}

        {/* Drag Overlay - The ghost that follows the cursor */}
        <DragOverlay dropAnimation={null}>
          <AnimatePresence>
            {activeData && (
              <DragOverlayContent data={activeData} />
            )}
          </AnimatePresence>
        </DragOverlay>
      </DndContext>
    </PipelineDndContext.Provider>
  );
}

// The visual representation of the dragged item
function DragOverlayContent({ data }: { data: DragData }) {
  if (data.type === "palette-item" && data.stepType && data.option) {
    const Icon = stepIcons[data.stepType];
    const colors = stepColors[data.stepType];

    return (
      <motion.div
        initial={{ scale: 1, opacity: 0.9 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`
          flex items-center gap-2 p-3 rounded-lg border-2 shadow-xl
          bg-card cursor-grabbing
          ${colors.border} ${colors.bg}
        `}
      >
        <div className={`p-1.5 rounded ${colors.bg} ${colors.text}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="font-medium text-sm text-foreground">{data.option.name}</p>
          <p className="text-xs text-muted-foreground">{data.option.description}</p>
        </div>
      </motion.div>
    );
  }

  if (data.type === "pipeline-step" && data.step) {
    const Icon = stepIcons[data.step.type];
    const colors = stepColors[data.step.type];

    return (
      <motion.div
        initial={{ scale: 1, opacity: 0.9 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`
          flex items-center gap-2 p-3 rounded-lg border-2 shadow-xl
          bg-card cursor-grabbing
          ${colors.border} ring-1 ring-primary/30
        `}
        style={{ minWidth: "200px" }}
      >
        <div className={`p-1.5 rounded ${colors.bg} ${colors.text}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-foreground">{data.step.name}</p>
          <p className="text-xs text-muted-foreground capitalize">{data.step.type}</p>
        </div>
      </motion.div>
    );
  }

  return null;
}
