import { useDroppable } from "@dnd-kit/core";
import { Plus, Sparkles, ArrowDown, PlayCircle, Flag } from "lucide-react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import { PipelineNode } from "./PipelineNode";
import { usePipelineDnd } from "./PipelineDndContext";
import type { PipelineStep } from "./types";

interface PipelineCanvasProps {
  steps: PipelineStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onMoveStep: (id: string, direction: "up" | "down", path?: string[]) => void;
  onAddBranch?: (stepId: string) => void;
  onRemoveBranch?: (stepId: string, branchIndex: number) => void;
}

export function PipelineCanvas({
  steps,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onMoveStep,
  onAddBranch,
  onRemoveBranch,
}: PipelineCanvasProps) {
  const { isDragging, dropIndicator } = usePipelineDnd();

  // Main canvas drop zone
  const { setNodeRef: setCanvasRef, isOver: isOverCanvas } = useDroppable({
    id: "pipeline-canvas",
    data: {
      type: "drop-zone",
      path: [],
      index: steps.length,
      position: "after",
      accepts: true,
    },
  });

  // Initial drop zone (when canvas is empty or at the top)
  const { setNodeRef: setInitialRef, isOver: isOverInitial } = useDroppable({
    id: "pipeline-initial-drop",
    data: {
      type: "drop-zone",
      path: [],
      index: 0,
      position: "before",
      accepts: true,
    },
  });

  return (
    <div
      ref={setCanvasRef}
      className={`
        flex-1 p-6 overflow-auto transition-colors relative
        ${isDragging ? "bg-muted/30" : ""}
      `}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onSelectStep(null);
        }
      }}
    >
      {/* Background Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "32px 32px",
        }}
      />

      {steps.length === 0 ? (
        <EmptyCanvasState
          isOver={isOverCanvas || isOverInitial}
          setDropRef={setInitialRef}
        />
      ) : (
        <div className="max-w-3xl mx-auto relative pl-6 pb-20">
          {/* Start Node */}
          <motion.div
            className="flex flex-col items-center mb-2"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="px-3 py-1.5 rounded-full bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 border border-emerald-500/30 text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 shadow-sm">
              <PlayCircle className="h-3.5 w-3.5" />
              Input Data
            </div>
          </motion.div>

          {/* Initial drop zone */}
          <DropZoneIndicator
            id="drop-before-0"
            path={[]}
            index={0}
            isActive={dropIndicator?.path.length === 0 && dropIndicator?.index === 0}
          />

          {/* Pipeline Steps */}
          <LayoutGroup>
            <div className="space-y-0">
              {steps.map((step, index) => (
                <motion.div
                  key={step.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20, scale: 0.95 }}
                  transition={{ duration: 0.2, delay: index * 0.02 }}
                  className="relative"
                >
                  {/* Connection Line Before */}
                  <ConnectionLine />

                  <PipelineNode
                    step={step}
                    index={index}
                    path={[]}
                    isSelected={selectedStepId === step.id}
                    onSelect={() => onSelectStep(step.id)}
                    onRemove={() => onRemoveStep(step.id)}
                    onDuplicate={() => onDuplicateStep(step.id)}
                    onMoveUp={() => onMoveStep(step.id, "up")}
                    onMoveDown={() => onMoveStep(step.id, "down")}
                    canMoveUp={index > 0}
                    canMoveDown={index < steps.length - 1}
                    onAddBranch={onAddBranch ? () => onAddBranch(step.id) : undefined}
                    onRemoveBranch={onRemoveBranch ? (branchIdx) => onRemoveBranch(step.id, branchIdx) : undefined}
                  />

                  {/* Drop zone after each step */}
                  <DropZoneIndicator
                    id={`drop-after-${step.id}`}
                    path={[]}
                    index={index + 1}
                    isActive={dropIndicator?.path.length === 0 && dropIndicator?.index === index + 1}
                  />
                </motion.div>
              ))}
            </div>
          </LayoutGroup>

          {/* End Node */}
          <motion.div
            className="flex flex-col items-center mt-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <ConnectionLine />
            <div className="px-3 py-1.5 rounded-full bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/30 text-xs font-medium text-primary flex items-center gap-1.5 shadow-sm">
              <Flag className="h-3.5 w-3.5" />
              Output
            </div>
          </motion.div>

          {/* Floating drop indicator when dragging */}
          <AnimatePresence>
            {isDragging && isOverCanvas && !dropIndicator && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-6 flex items-center justify-center p-6 rounded-xl border-2 border-dashed border-primary bg-primary/5 text-primary"
              >
                <Plus className="h-5 w-5 mr-2" />
                <span className="font-medium">Drop here to add step</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// Empty state component
function EmptyCanvasState({
  isOver,
  setDropRef
}: {
  isOver: boolean;
  setDropRef: (node: HTMLElement | null) => void;
}) {
  return (
    <motion.div
      ref={setDropRef}
      className="h-full flex flex-col items-center justify-center text-center"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className={`
          p-10 rounded-2xl border-2 border-dashed max-w-md transition-all duration-300
          ${isOver
            ? "border-primary bg-primary/10 scale-105 shadow-lg shadow-primary/10"
            : "border-border bg-muted/30"
          }
        `}
        animate={isOver ? { scale: 1.02 } : { scale: 1 }}
      >
        <motion.div
          className={`p-4 rounded-full w-fit mx-auto mb-4 transition-colors ${
            isOver ? "bg-primary/20" : "bg-primary/10"
          }`}
          animate={isOver ? { rotate: [0, -10, 10, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <Sparkles className={`h-8 w-8 ${isOver ? "text-primary" : "text-primary/70"}`} />
        </motion.div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {isOver ? "Release to add step" : "Start Building Your Pipeline"}
        </h3>
        <p className="text-muted-foreground mb-4">
          {isOver
            ? "Drop your component here to begin"
            : "Drag steps from the component library on the left, or double-click to add them."
          }
        </p>
        {!isOver && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Plus className="h-4 w-4" />
            <span>Drop steps here to begin</span>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// Connection line between steps
function ConnectionLine() {
  return (
    <div className="flex flex-col items-center">
      <div className="w-0.5 h-1.5 bg-gradient-to-b from-border to-border/50" />
      <ArrowDown className="h-3 w-3 text-border" />
    </div>
  );
}

// Drop zone indicator that shows between steps
interface DropZoneIndicatorProps {
  id: string;
  path: string[];
  index: number;
  isActive: boolean;
}

function DropZoneIndicator({ id, path, index, isActive }: DropZoneIndicatorProps) {
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

  const showIndicator = isOver || isActive;

  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{ minHeight: showIndicator ? 40 : 2 }}
    >
      <AnimatePresence>
        {showIndicator && (
          <motion.div
            initial={{ opacity: 0, scaleX: 0.8 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0.8 }}
            transition={{ duration: 0.1, ease: "easeOut" }}
            className="w-full h-10 rounded-lg border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center"
          >
            <Plus className="h-4 w-4 text-primary" />
            <span className="ml-1.5 text-xs font-medium text-primary">Drop here</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
