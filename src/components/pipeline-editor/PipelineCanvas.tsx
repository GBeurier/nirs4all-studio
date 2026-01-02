import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Plus, Sparkles, ArrowDown, PlayCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SortableStep } from "./SortableStep";
import type { PipelineStep } from "./types";

interface PipelineCanvasProps {
  steps: PipelineStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string) => void;
  onDuplicateStep: (id: string) => void;
  onMoveStep: (id: string, direction: "up" | "down") => void;
}

export function PipelineCanvas({
  steps,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onMoveStep,
}: PipelineCanvasProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: "pipeline-canvas",
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 p-6 overflow-auto transition-colors relative ${
        isOver ? "bg-primary/5" : ""
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onSelectStep(null);
        }
      }}
    >
      {/* Background Grid Pattern */}
      <div
        className="absolute inset-0 opacity-[0.02] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      />

      {steps.length === 0 ? (
        <motion.div
          className="h-full flex flex-col items-center justify-center text-center"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div
            className={`p-8 rounded-2xl border-2 border-dashed ${
              isOver ? "border-primary bg-primary/10" : "border-border bg-muted/30"
            } max-w-md transition-all duration-200`}
          >
            <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto mb-4">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              Start Building Your Pipeline
            </h3>
            <p className="text-muted-foreground mb-4">
              Drag steps from the component library on the left, or double-click
              to add them. Arrange them in order to create your processing
              workflow.
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Plus className="h-4 w-4" />
              <span>Drop steps here to begin</span>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="max-w-3xl mx-auto relative pl-4 pb-20">
          {/* Start Node */}
          <div className="flex flex-col items-center mb-2">
            <div className="px-4 py-2 rounded-full bg-muted border border-border text-sm font-medium text-muted-foreground flex items-center gap-2">
              <PlayCircle className="h-4 w-4" />
              Input Data
            </div>
            <div className="h-4 w-0.5 bg-border mt-2" />
            <ArrowDown className="h-4 w-4 text-border" />
          </div>

          <SortableContext
            items={steps.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-0">
              {steps.map((step, index) => (
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="relative"
                >
                  <SortableStep
                    step={step}
                    index={index}
                    isSelected={selectedStepId === step.id}
                    onSelect={() => onSelectStep(step.id)}
                    onRemove={() => onRemoveStep(step.id)}
                    onDuplicate={() => onDuplicateStep(step.id)}
                    onMoveUp={() => onMoveStep(step.id, "up")}
                    onMoveDown={() => onMoveStep(step.id, "down")}
                    canMoveUp={index > 0}
                    canMoveDown={index < steps.length - 1}
                  />
                  {/* Connection Line */}
                  {index < steps.length - 1 && (
                    <div className="flex flex-col items-center py-2">
                      <div className="w-0.5 h-4 bg-border" />
                      <ArrowDown className="h-4 w-4 text-border" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </SortableContext>

          {/* Drop Zone Indicator at Bottom */}
          <AnimatePresence>
            {isOver && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="mt-4 flex items-center justify-center p-4 rounded-xl border-2 border-dashed border-primary bg-primary/5 text-primary"
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
