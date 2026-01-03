import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Waves,
  Shuffle,
  Target,
  BarChart3,
  GripVertical,
  Copy,
  Trash2,
  Plus,
  GitBranch,
  GitMerge,
  Settings,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePipelineDnd } from "./PipelineDndContext";
import { stepColors, type PipelineStep, type StepType } from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  metrics: BarChart3,
  branch: GitBranch,
  merge: GitMerge,
};

interface TreeNodeProps {
  step: PipelineStep;
  index: number;
  path: string[];
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
  // For nested recursion
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranchNested?: (stepId: string, path?: string[]) => void;
  onRemoveBranchNested?: (stepId: string, branchIndex: number, path?: string[]) => void;
}

export function TreeNode({
  step,
  index,
  path,
  depth,
  isSelected,
  onSelect,
  onRemove,
  onDuplicate,
  onAddBranch,
  onRemoveBranch,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onAddBranchNested,
  onRemoveBranchNested,
}: TreeNodeProps) {
  const { isDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === step.id;
  const [isBranchesExpanded, setIsBranchesExpanded] = useState(true);

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

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];

  // Format all parameters - let CSS truncate handle overflow
  const paramString = Object.entries(step.params)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const nodeContent = (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`
        group flex items-center gap-2 py-1.5 px-2 rounded-lg border transition-all duration-100
        ${isBeingDragged ? "opacity-30" : "opacity-100"}
        ${isSelected
          ? colors.selected
          : `${colors.border} ${colors.bg} ${colors.hover}`
        }
        ${isOver && !isBeingDragged ? "ring-1 ring-primary/50" : ""}
      `}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted transition-colors touch-none shrink-0"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {/* Step Icon */}
      <div className={`p-1.5 rounded ${colors.bg} ${colors.text} shrink-0`}>
        <Icon className="h-3.5 w-3.5" />
      </div>

      {/* Step Info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm text-foreground truncate">{step.name}</span>
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
            {step.type}
          </Badge>
        </div>
        {paramString && (
          <p className="text-[10px] text-muted-foreground truncate font-mono leading-tight" title={paramString}>
            {paramString}
          </p>
        )}
      </div>

      {/* Quick Actions - positioned absolutely to not affect truncation */}
      {!isDragging && (
        <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
          >
            <Copy className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="relative">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {nodeContent}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-44">
          <ContextMenuItem onClick={onSelect}>
            <Settings className="h-3.5 w-3.5 mr-2" />
            Configure
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            Duplicate
          </ContextMenuItem>
          {step.type === "branch" && onAddBranch && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onAddBranch}>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add Branch
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Render branches as nested tree */}
      {step.type === "branch" && step.branches && (
        <div className="ml-4 mt-1">
          {/* Collapse/expand toggle */}
          <button
            onClick={() => setIsBranchesExpanded(!isBranchesExpanded)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground py-0.5 px-1 rounded hover:bg-muted/50 transition-colors mb-1"
          >
            {isBranchesExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>{step.branches.length} branches</span>
          </button>

          {isBranchesExpanded && (
            <>
              {step.branches.map((branch, branchIndex) => (
                <BranchNode
                  key={branchIndex}
                  branch={branch}
                  branchIndex={branchIndex}
                  parentPath={[...path, step.id]}
                  parentStepId={step.id}
                  depth={depth + 1}
                  canRemove={step.branches!.length > 1}
                  onRemoveBranch={onRemoveBranchNested ? (bIdx) => onRemoveBranchNested(step.id, bIdx, path) : undefined}
                  selectedStepId={selectedStepId}
                  onSelectStep={onSelectStep}
                  onRemoveStep={onRemoveStep}
                  onDuplicateStep={onDuplicateStep}
                  onAddBranchNested={onAddBranchNested}
                  onRemoveBranchNested={onRemoveBranchNested}
                />
              ))}
              {/* Add branch button */}
              {onAddBranch && (
                <button
                  onClick={onAddBranch}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary py-1 px-2 rounded hover:bg-muted/50 transition-colors ml-2 mt-1"
                >
                  <Plus className="h-3 w-3" />
                  <span>Add branch</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Branch node - contains steps within a branch
interface BranchNodeProps {
  branch: PipelineStep[];
  branchIndex: number;
  parentPath: string[];
  parentStepId: string;
  depth: number;
  canRemove: boolean;
  onRemoveBranch?: (branchIndex: number) => void;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranchNested?: (stepId: string, path?: string[]) => void;
  onRemoveBranchNested?: (stepId: string, branchIndex: number, path?: string[]) => void;
}

function BranchNode({
  branch,
  branchIndex,
  parentPath,
  parentStepId,
  depth,
  canRemove,
  onRemoveBranch,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
  onDuplicateStep,
  onAddBranchNested,
  onRemoveBranchNested,
}: BranchNodeProps) {
  const branchPath = [...parentPath, "branch", String(branchIndex)];
  const { dropIndicator } = usePipelineDnd();
  const [isExpanded, setIsExpanded] = useState(true);

  // Drop zone for empty branch or at end
  const { setNodeRef, isOver } = useDroppable({
    id: `branch-${parentPath.join("-")}-${branchIndex}`,
    data: {
      type: "drop-zone",
      path: branchPath,
      index: branch.length,
      position: "inside",
      accepts: true,
    },
  });

  return (
    <div className="relative">
      {/* Branch header */}
      <div className="flex items-center gap-1 py-0.5 text-muted-foreground group/branch">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 hover:text-foreground transition-colors rounded px-0.5 hover:bg-muted/50"
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <GitBranch className="h-3 w-3" />
          <span className="text-[10px] font-medium">Branch {branchIndex + 1}</span>
          {!isExpanded && branch.length > 0 && (
            <span className="text-[9px] text-muted-foreground/70">({branch.length} steps)</span>
          )}
        </button>
        {canRemove && onRemoveBranch && (
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 ml-1 opacity-0 group-hover/branch:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={() => onRemoveBranch(branchIndex)}
          >
            <Trash2 className="h-2.5 w-2.5" />
          </Button>
        )}
      </div>

      {/* Branch content with tree line */}
      {isExpanded && (
        <div className="border-l border-dashed border-muted-foreground/30 ml-1.5 pl-3">
        {/* Initial drop zone in branch */}
        <BranchDropZone
          id={`branch-${parentPath.join("-")}-${branchIndex}-start`}
          path={branchPath}
          index={0}
        />

        {branch.length === 0 ? (
          <div
            ref={setNodeRef}
            className={`
              py-2 px-3 text-xs text-muted-foreground rounded border border-dashed transition-all
              ${isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30"}
            `}
          >
            {isOver ? "Drop here" : "Empty branch - drop steps here"}
          </div>
        ) : (
          branch.map((branchStep, idx) => (
            <div key={branchStep.id}>
              <TreeNode
                step={branchStep}
                index={idx}
                path={branchPath}
                depth={depth}
                isSelected={selectedStepId === branchStep.id}
                onSelect={() => onSelectStep(branchStep.id)}
                onRemove={() => onRemoveStep(branchStep.id, branchPath)}
                onDuplicate={() => onDuplicateStep(branchStep.id, branchPath)}
                onAddBranch={onAddBranchNested ? () => onAddBranchNested(branchStep.id, branchPath) : undefined}
                onRemoveBranch={onRemoveBranchNested ? (bIdx) => onRemoveBranchNested(branchStep.id, bIdx, branchPath) : undefined}
                selectedStepId={selectedStepId}
                onSelectStep={onSelectStep}
                onRemoveStep={onRemoveStep}
                onDuplicateStep={onDuplicateStep}
                onAddBranchNested={onAddBranchNested}
                onRemoveBranchNested={onRemoveBranchNested}
              />
              <BranchDropZone
                id={`branch-${parentPath.join("-")}-${branchIndex}-after-${branchStep.id}`}
                path={branchPath}
                index={idx + 1}
              />
            </div>
          ))
        )}
        </div>
      )}
    </div>
  );
}

// Drop zone within a branch
interface BranchDropZoneProps {
  id: string;
  path: string[];
  index: number;
}

function BranchDropZone({ id, path, index }: BranchDropZoneProps) {
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
