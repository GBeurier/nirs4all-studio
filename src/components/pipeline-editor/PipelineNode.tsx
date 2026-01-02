import { useDraggable, useDroppable } from "@dnd-kit/core";
import { motion } from "framer-motion";
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
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onAddBranch,
  onRemoveBranch,
  depth = 0,
}: PipelineNodeProps) {
  const { isDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === step.id;

  // Make this node draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
  } = useDraggable({
    id: step.id,
    data: {
      type: "pipeline-step",
      stepId: step.id,
      step,
      sourcePath: path,
    },
  });

  // Make this node a drop target (for reordering)
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

  // Format parameters for display
  const paramEntries = Object.entries(step.params).slice(0, 3);
  const hasMoreParams = Object.keys(step.params).length > 3;

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
        group relative rounded-xl border-2 transition-all duration-200 bg-card
        ${colors.border}
        ${isSelected ? `ring-2 ${colors.active} shadow-lg` : ""}
        ${isOver && !isBeingDragged ? "ring-2 ring-primary/50 border-primary/50" : ""}
        ${!isBeingDragged ? "hover:shadow-md" : ""}
      `}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        marginLeft: depth > 0 ? "0" : undefined,
      }}
    >
      {/* Main Content */}
      <div className="flex items-center gap-2 p-3">
        {/* Step Number Badge */}
        <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-card border-2 border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm z-10">
          {index + 1}
        </div>

        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -m-0.5 rounded hover:bg-muted/80 transition-colors touch-none focus:outline-none focus:ring-2 focus:ring-primary/50"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Step Icon */}
        <div className={`p-2 rounded-lg bg-gradient-to-br ${colors.gradient} ${colors.text}`}>
          <Icon className="h-4 w-4" />
        </div>

        {/* Step Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-foreground">{step.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize">
              {step.type}
            </Badge>
          </div>
          {paramEntries.length > 0 && (
            <p className="text-xs text-muted-foreground truncate font-mono">
              {paramEntries.map(([k, v]) => `${k}=${v}`).join(", ")}
              {hasMoreParams && " ..."}
            </p>
          )}
        </div>

        {/* Quick Actions - Only show when not dragging */}
        {!isDragging && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Branches (for branch type steps) */}
      {step.type === "branch" && step.branches && (
        <BranchesContainer
          step={step}
          path={path}
          depth={depth}
          onAddBranch={onAddBranch}
          onRemoveBranch={onRemoveBranch}
        />
      )}
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

// Branches container for branch-type steps
interface BranchesContainerProps {
  step: PipelineStep;
  path: string[];
  depth: number;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
}

function BranchesContainer({ step, path, depth, onAddBranch, onRemoveBranch }: BranchesContainerProps) {
  if (!step.branches) return null;

  return (
    <div className="pl-6 pb-3 pt-1 border-l-2 border-dashed border-muted-foreground/30 ml-6">
      <div className="space-y-2">
        {step.branches.map((branch, branchIndex) => (
          <BranchDropZone
            key={branchIndex}
            branchIndex={branchIndex}
            branch={branch}
            parentPath={[...path, step.id]}
            depth={depth + 1}
            onRemoveBranch={onRemoveBranch}
            canRemove={step.branches!.length > 2}
          />
        ))}

        {/* Add branch button */}
        {onAddBranch && (
          <button
            onClick={onAddBranch}
            className="w-full h-8 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 text-muted-foreground hover:text-primary text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="font-medium">Add Branch</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Individual branch drop zone
interface BranchDropZoneProps {
  branchIndex: number;
  branch: PipelineStep[];
  parentPath: string[];
  depth: number;
  onRemoveBranch?: (branchIndex: number) => void;
  canRemove: boolean;
}

function BranchDropZone({ branchIndex, branch, parentPath, depth, onRemoveBranch, canRemove }: BranchDropZoneProps) {
  const branchPath = [...parentPath, "branch", String(branchIndex)];

  const { setNodeRef, isOver } = useDroppable({
    id: `branch-${parentPath.join("-")}-${branchIndex}`,
    data: {
      type: "drop-zone",
      path: branchPath,
      index: branch.length, // Drop at end of branch
      position: "inside" as const,
      accepts: true,
    },
  });

  return (
    <div
      ref={setNodeRef}
      className={`
        w-full rounded-lg border-2 p-2 transition-all
        ${isOver
          ? "border-primary bg-primary/10 border-solid"
          : "border-dashed border-muted-foreground/20 bg-muted/10"
        }
      `}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <GitBranch className="h-3 w-3" />
          Branch {branchIndex + 1}
        </span>
        {canRemove && onRemoveBranch && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={() => onRemoveBranch(branchIndex)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      {branch.length === 0 ? (
        <div className="h-8 flex items-center justify-center text-xs text-muted-foreground">
          Drop steps here
        </div>
      ) : (
        <div className="space-y-1">
          {branch.map((branchStep, idx) => (
            <BranchStepPreview
              key={branchStep.id}
              step={branchStep}
              index={idx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Compact preview of a step in a branch
function BranchStepPreview({ step, index }: { step: PipelineStep; index: number }) {
  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${colors.border} ${colors.bg}`}>
      <span className="text-[10px] font-mono text-muted-foreground w-3">{index + 1}</span>
      <Icon className={`h-3 w-3 ${colors.text}`} />
      <span className="text-xs font-medium truncate">{step.name}</span>
    </div>
  );
}
