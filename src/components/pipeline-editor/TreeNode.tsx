import { useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  Waves,
  Shuffle,
  Target,
  GripVertical,
  Copy,
  Trash2,
  Plus,
  GitBranch,
  GitMerge,
  Settings,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Repeat,
  Filter,
  Zap,
  BarChart3,
  Layers,
  FlaskConical,
  Combine,
  LineChart,
  MessageSquare,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePipelineDnd } from "./PipelineDndContext";
import {
  stepColors,
  CONTAINER_STEP_TYPES,
  type PipelineStep,
  type StepType,
  calculateStepVariants,
  formatSweepDisplay,
} from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Layers,
  feature_augmentation: FlaskConical,
  sample_filter: Filter,
  concat_transform: Combine,
  chart: LineChart,
  comment: MessageSquare,
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
  // For container children (sample_augmentation, feature_augmentation, etc.)
  onAddChild?: (stepId: string, path?: string[]) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  onUpdateStep?: (stepId: string, updates: Partial<PipelineStep>, path?: string[]) => void;
}

// Check if a step type has children (not branches)
function hasChildren(step: PipelineStep): boolean {
  const containerTypes: StepType[] = ["sample_augmentation", "feature_augmentation", "sample_filter", "concat_transform"];
  return containerTypes.includes(step.type) && (step.children?.length ?? 0) > 0;
}

// Get container label based on step type
function getContainerChildLabel(stepType: StepType): string {
  switch (stepType) {
    case "sample_augmentation": return "transformer";
    case "feature_augmentation": return "transform";
    case "sample_filter": return "filter";
    case "concat_transform": return "transform";
    default: return "child";
  }
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
  onAddChild,
  onRemoveChild,
  onUpdateStep,
}: TreeNodeProps) {
  const { isDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === step.id;
  const [isBranchesExpanded, setIsBranchesExpanded] = useState(true);
  const [isChildrenExpanded, setIsChildrenExpanded] = useState(true);

  // Check if this is a container step with children
  const isContainer = ["sample_augmentation", "feature_augmentation", "sample_filter", "concat_transform"].includes(step.type);
  const containerChildren = step.children ?? [];
  const childLabel = getContainerChildLabel(step.type);

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

  // Check for parameter sweeps
  const hasSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;
  const totalVariants = calculateStepVariants(step);
  const sweepCount = step.paramSweeps ? Object.keys(step.paramSweeps).length : 0;
  const sweepKeys = step.paramSweeps ? Object.keys(step.paramSweeps) : [];

  // Check for finetuning
  const hasFinetuning = step.finetuneConfig?.enabled;
  const finetuneTrials = step.finetuneConfig?.n_trials ?? 0;
  const finetuneParamCount = step.finetuneConfig?.model_params?.length ?? 0;

  // Format parameters - prioritize non-swept params
  const paramEntries = Object.entries(step.params);
  const displayParams = paramEntries
    .filter(([k]) => !sweepKeys.includes(k))
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  // Sweep summary for tooltip
  const sweepSummary = sweepKeys.map(k => {
    const sweep = step.paramSweeps![k];
    return `${k}: ${formatSweepDisplay(sweep)}`;
  }).join("\n");

  // Determine if this node is foldable (has branches or children)
  const isFoldable = ((step.type === "branch" || step.type === "generator") && step.branches && step.branches.length > 0) || (isContainer && containerChildren.length > 0);
  // Use appropriate expand state for the step type
  const isExpanded = (step.type === "branch" || step.type === "generator") ? isBranchesExpanded : isChildrenExpanded;
  const setIsExpanded = (step.type === "branch" || step.type === "generator") ? setIsBranchesExpanded : setIsChildrenExpanded;

  // Get fold label for tooltip
  const getFoldLabel = () => {
    if (step.type === "branch" || step.type === "generator") {
      const count = step.branches?.length ?? 0;
      const label = step.type === "generator"
        ? (step.generatorKind === "cartesian" ? "stages" : "options")
        : "branches";
      return `${count} ${label}`;
    }
    if (isContainer) {
      return `${containerChildren.length} ${childLabel}${containerChildren.length !== 1 ? "s" : ""}`;
    }
    return "";
  };

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
      {/* Expand/Collapse toggle for foldable nodes */}
      {isFoldable && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              className={`p-0.5 rounded hover:bg-muted transition-colors shrink-0 ${colors.text}`}
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <span className="text-xs">{isExpanded ? "Collapse" : "Expand"} {getFoldLabel()}</span>
          </TooltipContent>
        </Tooltip>
      )}

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
          {/* Sweep indicator */}
          {hasSweeps && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="text-[9px] px-1 py-0 h-4 bg-orange-500 hover:bg-orange-500 shrink-0 cursor-help">
                  <Repeat className="h-2.5 w-2.5 mr-0.5" />
                  {totalVariants}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                <div className="text-xs">
                  <div className="font-semibold mb-1">Sweeps ({sweepCount})</div>
                  <pre className="text-muted-foreground whitespace-pre-wrap">{sweepSummary}</pre>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Finetuning indicator */}
          {hasFinetuning && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="text-[9px] px-1 py-0 h-4 bg-purple-500 hover:bg-purple-500 shrink-0 cursor-help">
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                  {finetuneTrials}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                <div className="text-xs">
                  <div className="font-semibold mb-1">Optuna Finetuning</div>
                  <p className="text-muted-foreground">
                    {finetuneTrials} trials, {finetuneParamCount} parameter{finetuneParamCount !== 1 ? "s" : ""}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
          {/* Container children indicator */}
          {isContainer && containerChildren.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className={`text-[9px] px-1 py-0 h-4 shrink-0 cursor-help ${colors.text} bg-opacity-20`} style={{ backgroundColor: 'currentColor', opacity: 0.2 }}>
                  <Package className="h-2.5 w-2.5 mr-0.5" />
                  {containerChildren.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px]">
                <div className="text-xs">
                  <div className="font-semibold mb-1">{containerChildren.length} {childLabel}{containerChildren.length !== 1 ? "s" : ""}</div>
                  <p className="text-muted-foreground">
                    {containerChildren.map(c => c.name).join(", ")}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {/* Show params or sweep summary */}
        {hasSweeps ? (
          <p className="text-[10px] text-muted-foreground truncate font-mono leading-tight">
            {displayParams && <span>{displayParams}</span>}
            {displayParams && sweepCount > 0 && <span className="mx-1">•</span>}
            <span className="text-orange-500">{sweepCount} sweep{sweepCount !== 1 ? "s" : ""}</span>
          </p>
        ) : (
          displayParams && (
            <p className="text-[10px] text-muted-foreground truncate font-mono leading-tight" title={Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(", ")}>
              {Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(", ")}
            </p>
          )
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
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={onSelect}>
            <Settings className="h-3.5 w-3.5 mr-2" />
            Configure
          </ContextMenuItem>
          <ContextMenuItem onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5 mr-2" />
            Duplicate
          </ContextMenuItem>
          {step.type === "model" && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={onSelect}
                className="text-purple-500 focus:text-purple-600"
              >
                <Sparkles className="h-3.5 w-3.5 mr-2" />
                {hasFinetuning ? "Edit Finetuning" : "Configure Finetuning"}
              </ContextMenuItem>
            </>
          )}
          {(step.type === "branch" || step.type === "generator") && onAddBranch && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onAddBranch}>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add {step.type === "generator"
                  ? (step.generatorKind === "cartesian" ? "Stage" : "Option")
                  : "Branch"}
              </ContextMenuItem>
            </>
          )}
          {isContainer && onAddChild && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onAddChild(step.id, path)} className={colors.text}>
                <Plus className="h-3.5 w-3.5 mr-2" />
                Add {childLabel}
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
      {(step.type === "branch" || step.type === "generator") && step.branches && isBranchesExpanded && (
        <div className="ml-4 mt-1">
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
              onAddChild={onAddChild}
              onRemoveChild={onRemoveChild}
              isGenerator={step.type === "generator"}
              branchLabel={step.type === "generator"
                ? (step.generatorKind === "cartesian" ? "Stage" : "Option")
                : "Branch"}
            />
          ))}
          {/* Add branch button */}
          {onAddBranch && (
            <button
              onClick={onAddBranch}
              className={`flex items-center gap-1.5 text-xs py-1 px-2 rounded hover:bg-muted/50 transition-colors ml-2 mt-1 ${step.type === "generator" ? "text-orange-500 hover:text-orange-600" : "text-muted-foreground hover:text-primary"}`}
            >
              <Plus className="h-3 w-3" />
              <span>Add {step.type === "generator"
                ? (step.generatorKind === "cartesian" ? "stage" : "option")
                : "branch"}</span>
            </button>
          )}
        </div>
      )}

      {/* Render container children (sample_augmentation, feature_augmentation, etc.) */}
      {isContainer && isChildrenExpanded && (
        <div className="ml-4 mt-1">
          <ContainerChildrenNode
            children={containerChildren}
            parentStep={step}
            parentPath={[...path, step.id]}
            depth={depth + 1}
            childLabel={childLabel}
            selectedStepId={selectedStepId}
            onSelectStep={onSelectStep}
            onRemoveChild={onRemoveChild}
            onAddChild={onAddChild}
            colors={colors}
          />
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
  // Container children operations
  onAddChild?: (stepId: string, path?: string[]) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  isGenerator?: boolean;
  branchLabel?: string;
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
          <span className="text-[10px] font-medium">{branchLabel} {branchIndex + 1}</span>
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
                onAddBranch={onAddBranchNested ? () => onAddBranchNested(branchStep.id, branchPath) : undefined}
                onRemoveBranch={onRemoveBranchNested ? (bIdx) => onRemoveBranchNested(branchStep.id, bIdx, branchPath) : undefined}
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

// Container children node - renders children of container steps (sample_augmentation, feature_augmentation, etc.)
interface ContainerChildrenNodeProps {
  children: PipelineStep[];
  parentStep: PipelineStep;
  parentPath: string[];
  depth: number;
  childLabel: string;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  onAddChild?: (stepId: string, path?: string[]) => void;
  colors: { bg: string; border: string; text: string };
}

function ContainerChildrenNode({
  children,
  parentStep,
  parentPath,
  depth,
  childLabel,
  selectedStepId,
  onSelectStep,
  onRemoveChild,
  onAddChild,
  colors,
}: ContainerChildrenNodeProps) {
  const { dropIndicator } = usePipelineDnd();
  const childrenPath = [...parentPath, "children"];

  // Drop zone for adding new children at end
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `container-${parentStep.id}-children`,
    data: {
      type: "container-drop-zone",
      path: childrenPath,
      parentStepId: parentStep.id,
      index: children.length,
      position: "inside",
      accepts: ["preprocessing", "y_processing", "filter", "augmentation"],
    },
  });

  return (
    <div className={`border-l border-dashed ${colors.border} ml-1.5 pl-3`}>
      {children.length === 0 ? (
        <div
          ref={setDropRef}
          className={`
            py-2 px-3 text-xs text-muted-foreground rounded border border-dashed transition-all cursor-pointer
            ${isOver ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30"}
          `}
          onClick={() => onAddChild?.(parentStep.id, parentPath)}
        >
          {isOver ? "Drop transformer here" : `No ${childLabel}s - click to add or drop here`}
        </div>
      ) : (
        <div className="space-y-1">
          {children.map((child, idx) => (
            <ContainerChildItem
              key={child.id}
              child={child}
              index={idx}
              parentStep={parentStep}
              parentPath={parentPath}
              childLabel={childLabel}
              isSelected={selectedStepId === child.id}
              onSelect={() => onSelectStep(child.id)}
              onRemove={() => onRemoveChild?.(parentStep.id, child.id, parentPath)}
              colors={colors}
            />
          ))}
          {/* Drop zone at the end - only visible when dragging over */}
          <div
            ref={setDropRef}
            className={`
              rounded border border-dashed transition-all flex items-center justify-center
              ${isOver ? "h-8 border-primary bg-primary/10" : "h-1 border-transparent"}
            `}
          >
            {isOver && (
              <>
                <Plus className="h-3 w-3 text-primary mr-1" />
                <span className="text-[10px] text-primary">Drop {childLabel}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Individual child item within a container
interface ContainerChildItemProps {
  child: PipelineStep;
  index: number;
  parentStep: PipelineStep;
  parentPath: string[];
  childLabel: string;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  colors: { bg: string; border: string; text: string };
}

function ContainerChildItem({
  child,
  index,
  parentStep,
  parentPath,
  childLabel,
  isSelected,
  onSelect,
  onRemove,
  colors,
}: ContainerChildItemProps) {
  const Icon = stepIcons[child.type] || Waves;
  const childColors = stepColors[child.type] || colors;
  const { isDragging: globalIsDragging, activeId } = usePipelineDnd();
  const isBeingDragged = activeId === child.id;

  // Make this child item draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
  } = useDraggable({
    id: child.id,
    data: {
      type: "pipeline-step",
      stepId: child.id,
      step: child,
      sourcePath: [...parentPath, "children"],
      isContainerChild: true,
      parentStepId: parentStep.id,
    },
  });

  // Format child parameters
  const paramEntries = Object.entries(child.params);
  const displayParams = paramEntries
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return (
    <div
      ref={setDragRef}
      className={`
        group flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-all
        ${isBeingDragged ? "opacity-30" : "opacity-100"}
        ${isSelected
          ? `${childColors.bg} ${childColors.border} border ring-1 ${childColors.active || 'ring-primary'}`
          : "hover:bg-muted/50 border border-transparent"
        }
      `}
      onClick={onSelect}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-0.5 rounded hover:bg-muted transition-colors touch-none shrink-0 opacity-50 group-hover:opacity-100"
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </button>

      {/* Child icon */}
      <Icon className={`h-3 w-3 flex-shrink-0 ${childColors.text}`} />

      {/* Child info */}
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate">{child.name || child.type}</span>
        {displayParams && (
          <span className="text-muted-foreground ml-1 truncate">({displayParams})</span>
        )}
      </div>

      {/* Remove button - now always visible on hover */}
      {!globalIsDragging && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
