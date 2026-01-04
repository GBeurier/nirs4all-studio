/**
 * BranchNode - Renders a branch with its nested steps
 *
 * Contains steps within a branch with proper nesting and DnD support.
 */

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { ChevronRight, ChevronDown, Sparkles, GitBranch, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePipelineDnd } from "../../PipelineDndContext";
import { BranchDropZone } from "./BranchDropZone";
import type { BranchNodeProps } from "./types";

// Import TreeNode lazily to avoid circular deps at module level
// It's used for recursive rendering
import { TreeNode } from "./TreeNode";

/**
 * Branch node - contains steps within a branch
 */
export function BranchNode({
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
  onAddChild,
  onRemoveChild,
  isGenerator = false,
  branchLabel = "Branch",
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

  const BranchIcon = isGenerator ? Sparkles : GitBranch;
  const borderColor = isGenerator ? "border-orange-400/50" : "border-muted-foreground/30";
  const iconColor = isGenerator ? "text-orange-400" : "";

  return (
    <div className="relative">
      {/* Branch header */}
      <div className="flex items-center gap-1 py-0.5 text-muted-foreground group/branch">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center gap-1 hover:text-foreground transition-colors rounded px-0.5 hover:bg-muted/50 ${iconColor}`}
        >
          {isExpanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          <BranchIcon className="h-3 w-3" />
          <span className="text-[10px] font-medium">
            {branchLabel} {branchIndex + 1}
          </span>
          {!isExpanded && branch.length > 0 && (
            <span className="text-[9px] text-muted-foreground/70">
              ({branch.length} steps)
            </span>
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
        <div className={`border-l border-dashed ${borderColor} ml-1.5 pl-3`}>
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
                ${isOver ? "border-primary bg-primary/10 text-primary" : isGenerator ? "border-orange-400/30" : "border-muted-foreground/30"}
              `}
            >
              {isOver ? "Drop here" : `Empty ${branchLabel.toLowerCase()} - drop steps here`}
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
                  onAddBranch={
                    onAddBranchNested
                      ? () => onAddBranchNested(branchStep.id, branchPath)
                      : undefined
                  }
                  onRemoveBranch={
                    onRemoveBranchNested
                      ? (bIdx) => onRemoveBranchNested(branchStep.id, bIdx, branchPath)
                      : undefined
                  }
                  selectedStepId={selectedStepId}
                  onSelectStep={onSelectStep}
                  onRemoveStep={onRemoveStep}
                  onDuplicateStep={onDuplicateStep}
                  onAddBranchNested={onAddBranchNested}
                  onRemoveBranchNested={onRemoveBranchNested}
                  onAddChild={onAddChild}
                  onRemoveChild={onRemoveChild}
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
