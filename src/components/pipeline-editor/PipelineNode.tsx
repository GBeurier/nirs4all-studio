import { useDraggable, useDroppable } from "@dnd-kit/core";
import { motion } from "framer-motion";
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
  Repeat,
  Sparkles,
  Grid3X3,
  Filter,
  Layers,
  BarChart,
  Sliders,
  Combine,
  LineChart,
  MessageSquare,
  Zap,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePipelineDnd } from "./PipelineDndContext";
import {
  stepColors,
  type PipelineStep,
  type StepType,
  calculateStepVariants,
  formatSweepDisplay,
} from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Layers,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  sequential: Layers,
  chart: LineChart,
  comment: MessageSquare,
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

  // Check for parameter sweeps or step generators
  const hasParamSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;
  const hasStepGenerator = !!step.stepGenerator;
  const hasSweeps = hasParamSweeps || hasStepGenerator;
  const totalVariants = calculateStepVariants(step);
  const sweepCount = (step.paramSweeps ? Object.keys(step.paramSweeps).length : 0) + (hasStepGenerator ? 1 : 0);

  // Format parameters for display - show limited params when there are sweeps
  const paramEntries = Object.entries(step.params);
  const sweepKeys = step.paramSweeps ? Object.keys(step.paramSweeps) : [];

  // Show non-swept params first, then indicate sweeps
  const displayParams = paramEntries
    .filter(([k]) => !sweepKeys.includes(k))
    .slice(0, 2) // Limit displayed params
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  // Sweep summary for tooltip
  const sweepSummaryParts: string[] = [];
  if (step.stepGenerator) {
    const gen = step.stepGenerator;
    const paramName = gen.param || "value";
    if (gen.type === "_range_" && Array.isArray(gen.values)) {
      const [start, end, rangeStep = 1] = gen.values as number[];
      sweepSummaryParts.push(`${paramName}: range(${start}, ${end}, ${rangeStep})`);
    } else if (gen.type === "_log_range_" && Array.isArray(gen.values)) {
      const [start, end, count = 5] = gen.values as number[];
      sweepSummaryParts.push(`${paramName}: log_range(${start}, ${end}, ${count})`);
    } else if (gen.type === "_or_" && Array.isArray(gen.values)) {
      const choices = gen.values.slice(0, 3).map(String).join(", ");
      const suffix = gen.values.length > 3 ? `, ... (${gen.values.length} total)` : "";
      sweepSummaryParts.push(`${paramName}: [${choices}${suffix}]`);
    }
  }
  sweepKeys.forEach(k => {
    const sweep = step.paramSweeps![k];
    sweepSummaryParts.push(`${k}: ${formatSweepDisplay(sweep)}`);
  });
  const sweepSummary = sweepSummaryParts.join("\n");

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
        group relative rounded-xl border-2 transition-all duration-200 bg-card w-full overflow-hidden
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
      <div className="flex items-center gap-2 p-3 w-full overflow-hidden">
        {/* Step Number Badge */}
        <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-card border-2 border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm z-10">
          {index + 1}
        </div>

        {/* Drag Handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -m-0.5 rounded hover:bg-muted/80 transition-colors touch-none focus:outline-none focus:ring-2 focus:ring-primary/50 shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        {/* Step Icon */}
        <div className={`p-2 rounded-lg bg-gradient-to-br ${colors.gradient} ${colors.text} shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>

        {/* Step Info */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-foreground truncate">{step.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize shrink-0">
              {step.type}
            </Badge>
            {/* Sweep indicator badge */}
            {hasSweeps && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="text-[10px] px-1.5 py-0 bg-orange-500 hover:bg-orange-500 shrink-0 cursor-help">
                    <Repeat className="h-2.5 w-2.5 mr-0.5" />
                    {totalVariants}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[250px]">
                  <div className="text-xs">
                    <div className="font-semibold mb-1">Parameter Sweeps ({sweepCount})</div>
                    <pre className="text-muted-foreground whitespace-pre-wrap">{sweepSummary}</pre>
                    <div className="mt-1 text-orange-400">{totalVariants} total variants</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Finetuning indicator badge */}
            {step.finetuneConfig?.enabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="text-[10px] px-1.5 py-0 bg-purple-500 hover:bg-purple-500 shrink-0 cursor-help">
                    <Sliders className="h-2.5 w-2.5 mr-0.5" />
                    Tune
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[280px]">
                  <div className="text-xs">
                    <div className="font-semibold mb-1">Finetuning Enabled</div>
                    <div className="text-muted-foreground space-y-0.5">
                      <div>Trials: {step.finetuneConfig.n_trials}</div>
                      <div>Approach: {step.finetuneConfig.approach}</div>
                      <div>Params: {step.finetuneConfig.model_params.map(p => p.name).join(", ") || "none"}</div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {/* Augmentation count badge */}
            {step.type === "augmentation" && step.branches?.[0] && (
              <Badge className="text-[10px] px-1.5 py-0 bg-indigo-500 hover:bg-indigo-500 shrink-0">
                <Layers className="h-2.5 w-2.5 mr-0.5" />
                {step.branches[0].length} transforms
              </Badge>
            )}
            {/* Generator options badge */}
            {step.generatorOptions && (step.generatorOptions.pick || step.generatorOptions.count) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge className="text-[10px] px-1.5 py-0 bg-cyan-500 hover:bg-cyan-500 shrink-0 cursor-help">
                    pick={Array.isArray(step.generatorOptions.pick) ? step.generatorOptions.pick.join("-") : step.generatorOptions.pick}
                    {step.generatorOptions.count && ` ×${step.generatorOptions.count}`}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <div className="text-xs">
                    Generator: pick {JSON.stringify(step.generatorOptions.pick)} options
                    {step.generatorOptions.count && `, generate ${step.generatorOptions.count} variants`}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {/* Show params or sweep summary */}
          {hasSweeps ? (
            <p className="text-xs text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap">
              {displayParams && <span>{displayParams}</span>}
              {displayParams && sweepCount > 0 && <span className="mx-1">•</span>}
              <span className="text-orange-500">{sweepCount} sweep{sweepCount !== 1 ? "s" : ""}</span>
            </p>
          ) : (
            displayParams && (
              <p className="text-xs text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(", ")}>
                {Object.entries(step.params).map(([k, v]) => `${k}=${v}`).join(", ")}
              </p>
            )
          )}
          {/* Custom name display */}
          {step.customName && (
            <p className="text-xs text-emerald-500 font-medium">
              as "{step.customName}"
            </p>
          )}
        </div>

        {/* Quick Actions - Absolutely positioned to not affect text truncation */}
        {!isDragging && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card pl-1">
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
          branchLabel="Branch"
        />
      )}

      {/* Generator options (for generator type steps - similar to branches) */}
      {step.type === "generator" && step.branches && (
        <BranchesContainer
          step={step}
          path={path}
          depth={depth}
          onAddBranch={onAddBranch}
          onRemoveBranch={onRemoveBranch}
          branchLabel={step.generatorKind === "cartesian" ? "Stage" : "Option"}
          isGenerator
        />
      )}

      {/* Augmentation transformers (for augmentation steps with nested content) */}
      {step.type === "augmentation" && step.branches?.[0] && step.branches[0].length > 0 && (
        <NestedStepsDisplay
          steps={step.branches[0]}
          label="Transformers"
          colorClass="text-indigo-500"
          borderClass="border-indigo-500/30"
        />
      )}

      {/* Filter steps (for filter steps with nested content) */}
      {step.type === "filter" && step.branches?.[0] && step.branches[0].length > 0 && (
        <NestedStepsDisplay
          steps={step.branches[0]}
          label="Filters"
          colorClass="text-rose-500"
          borderClass="border-rose-500/30"
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
  branchLabel?: string;
  isGenerator?: boolean;
}

function BranchesContainer({ step, path, depth, onAddBranch, onRemoveBranch, branchLabel = "Branch", isGenerator = false }: BranchesContainerProps) {
  if (!step.branches) return null;

  const borderColor = isGenerator ? "border-orange-500/30" : "border-muted-foreground/30";

  return (
    <div className={`pl-6 pb-3 pt-1 border-l-2 border-dashed ${borderColor} ml-6`}>
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
            branchLabel={branchLabel}
            isGenerator={isGenerator}
          />
        ))}

        {/* Add branch button */}
        {onAddBranch && (
          <button
            onClick={onAddBranch}
            className={`w-full h-8 rounded-lg border-2 border-dashed hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 text-muted-foreground hover:text-primary text-xs ${isGenerator ? "border-orange-500/30" : "border-muted-foreground/30"}`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="font-medium">Add {branchLabel}</span>
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
  branchLabel?: string;
  isGenerator?: boolean;
}

function BranchDropZone({ branchIndex, branch, parentPath, depth, onRemoveBranch, canRemove, branchLabel = "Branch", isGenerator = false }: BranchDropZoneProps) {
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

  const IconComponent = isGenerator ? Sparkles : GitBranch;
  const borderColorIdle = isGenerator ? "border-orange-500/20" : "border-muted-foreground/20";
  const bgColorIdle = isGenerator ? "bg-orange-500/5" : "bg-muted/10";

  return (
    <div
      ref={setNodeRef}
      className={`
        w-full rounded-lg border-2 p-2 transition-all
        ${isOver
          ? "border-primary bg-primary/10 border-solid"
          : `border-dashed ${borderColorIdle} ${bgColorIdle}`
        }
      `}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-xs font-medium flex items-center gap-1 ${isGenerator ? "text-orange-500" : "text-muted-foreground"}`}>
          <IconComponent className="h-3 w-3" />
          {branchLabel} {branchIndex + 1}
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
      {/* Show params summary for nested steps */}
      {Object.keys(step.params).length > 0 && (
        <span className="text-[10px] text-muted-foreground font-mono truncate ml-auto">
          {Object.entries(step.params).slice(0, 2).map(([k, v]) => `${k}=${v}`).join(", ")}
        </span>
      )}
    </div>
  );
}

// Display for nested steps in augmentation/filter containers (read-only preview)
interface NestedStepsDisplayProps {
  steps: PipelineStep[];
  label: string;
  colorClass: string;
  borderClass: string;
}

function NestedStepsDisplay({ steps, label, colorClass, borderClass }: NestedStepsDisplayProps) {
  return (
    <div className={`pl-6 pb-3 pt-1 border-l-2 border-dashed ${borderClass} ml-6`}>
      <div className="space-y-1">
        <span className={`text-xs font-medium ${colorClass}`}>
          {label} ({steps.length})
        </span>
        {steps.map((nestedStep, idx) => (
          <BranchStepPreview
            key={nestedStep.id}
            step={nestedStep}
            index={idx}
          />
        ))}
      </div>
    </div>
  );
}
