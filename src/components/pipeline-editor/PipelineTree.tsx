import { useDroppable } from "@dnd-kit/core";
import { Plus, Sparkles, PlayCircle, Flag } from "lucide-react";
import { usePipelineDnd } from "./PipelineDndContext";
import { TreeNode } from "./TreeNode";
import type { PipelineStep } from "./types";

interface PipelineTreeProps {
  steps: PipelineStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranch?: (stepId: string, path?: string[]) => void;
  onRemoveBranch?: (stepId: string, branchIndex: number, path?: string[]) => void;
  // For container step child management
  onAddChild?: (stepId: string, path?: string[]) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
}

export function PipelineTree({
  steps,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onAddBranch,
  onRemoveBranch,
  onAddChild,
  onRemoveChild,
}: PipelineTreeProps) {
  const { isDragging } = usePipelineDnd();

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
      className={`h-full flex flex-col transition-colors relative ${isDragging ? "bg-muted/20" : ""}`}
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
        <div className="flex-1 p-4">
          <EmptyCanvasState isOver={isOverInitial} setDropRef={setInitialRef} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
        <div className="max-w-2xl mx-auto relative">
          {/* Start marker */}
          <div className="flex items-center gap-2 mb-1 ml-1">
            <PlayCircle className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Input</span>
          </div>

          {/* Tree structure */}
          <div className="border-l-2 border-border ml-[6px] pl-4">
            {/* Initial drop zone */}
            <DropZone id="drop-before-0" path={[]} index={0} />

            {/* Render each step as a tree node */}
            {steps.map((step, index) => (
              <div key={step.id}>
                <TreeNode
                  step={step}
                  index={index}
                  path={[]}
                  depth={0}
                  isSelected={selectedStepId === step.id}
                  onSelect={() => onSelectStep(step.id)}
                  onRemove={() => onRemoveStep(step.id, [])}
                  onDuplicate={() => onDuplicateStep(step.id, [])}
                  onAddBranch={onAddBranch ? () => onAddBranch(step.id, []) : undefined}
                  onRemoveBranch={onRemoveBranch ? (branchIdx: number) => onRemoveBranch(step.id, branchIdx, []) : undefined}
                  selectedStepId={selectedStepId}
                  onSelectStep={onSelectStep}
                  onRemoveStep={onRemoveStep}
                  onDuplicateStep={onDuplicateStep}
                  onAddBranchNested={onAddBranch}
                  onRemoveBranchNested={onRemoveBranch}
                  onAddChild={onAddChild}
                  onRemoveChild={onRemoveChild}
                />
                <DropZone id={`drop-after-${step.id}`} path={[]} index={index + 1} />
              </div>
            ))}
          </div>

          {/* End marker */}
          <div className="flex items-center gap-2 mt-1 ml-1">
            <Flag className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium text-primary">Output</span>
          </div>
        </div>
        </div>
      )}
    </div>
  );
}

// Empty state component
function EmptyCanvasState({
  isOver,
  setDropRef,
}: {
  isOver: boolean;
  setDropRef: (node: HTMLElement | null) => void;
}) {
  return (
    <div
      ref={setDropRef}
      className="h-full flex flex-col items-center justify-center text-center"
    >
      <div
        className={`
          p-8 rounded-xl border-2 border-dashed max-w-sm transition-all duration-200
          ${isOver ? "border-primary bg-primary/5 scale-[1.02]" : "border-border bg-muted/20"}
        `}
      >
        <div
          className={`p-3 rounded-full w-fit mx-auto mb-3 transition-colors ${
            isOver ? "bg-primary/20" : "bg-primary/10"
          }`}
        >
          <Sparkles className={`h-6 w-6 ${isOver ? "text-primary" : "text-primary/70"}`} />
        </div>
        <h3 className="text-base font-semibold text-foreground mb-1">
          {isOver ? "Release to add" : "Build Your Pipeline"}
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          {isOver ? "Drop here to begin" : "Drag steps from the left panel"}
        </p>
        {!isOver && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5" />
            <span>Drop steps here</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Drop zone between steps
interface DropZoneProps {
  id: string;
  path: string[];
  index: number;
}

function DropZone({ id, path, index }: DropZoneProps) {
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

  const isActive = dropIndicator?.path.length === path.length &&
    dropIndicator?.path.every((p, i) => p === path[i]) &&
    dropIndicator?.index === index;

  const showIndicator = isOver || isActive;

  return (
    <div
      ref={setNodeRef}
      className={`
        transition-all duration-100
        ${showIndicator ? "py-1" : "h-1 my-0"}
      `}
    >
      {showIndicator && (
        <div className="h-9 rounded-lg border-2 border-dashed border-primary bg-primary/5 flex items-center justify-center gap-1.5">
          <Plus className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-medium text-primary">Drop here</span>
        </div>
      )}
    </div>
  );
}
