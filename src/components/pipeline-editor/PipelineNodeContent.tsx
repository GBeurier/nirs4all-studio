import type { ComponentPropsWithoutRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  GripVertical,
  Copy,
  Trash2,
  Plus,
  GitBranch,
  Repeat,
  Sparkles,
  Layers,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getPipelineNodeIcon,
  type PipelineNodePresentation,
} from "./PipelineNodePresentation";
import { getStepColor } from "./stepPresentation";
import { type PipelineStep } from "./types";

interface PipelineNodeContentProps {
  step: PipelineStep;
  index: number;
  path: string[];
  depth: number;
  presentation: PipelineNodePresentation;
  dragHandleProps: ComponentPropsWithoutRef<"button">;
  isDragging: boolean;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
}

export function PipelineNodeContent({
  step,
  index,
  path,
  depth,
  presentation,
  dragHandleProps,
  isDragging,
  onRemove,
  onDuplicate,
  onAddBranch,
  onRemoveBranch,
}: PipelineNodeContentProps) {
  const {
    Icon,
    colors,
    hasSweeps,
    totalVariants,
    sweepCount,
    sweepSummary,
    displayParams,
    allParamsDisplay,
    generatorBranchLabel,
  } = presentation;

  return (
    <>
      <div className="flex items-center gap-2 p-3 w-full overflow-hidden">
        <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-card border-2 border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shadow-sm z-10">
          {index + 1}
        </div>

        <button
          {...dragHandleProps}
          className="cursor-grab active:cursor-grabbing p-1 -m-0.5 rounded hover:bg-muted/80 transition-colors touch-none focus:outline-none focus:ring-2 focus:ring-primary/50 shrink-0"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className={`p-2 rounded-lg bg-gradient-to-br ${colors.gradient} ${colors.text} shrink-0`}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm text-foreground truncate">{step.name}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 capitalize shrink-0">
              {step.type}
            </Badge>
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
                      <div>Params: {step.finetuneConfig.model_params.map((param) => param.name).join(", ") || "none"}</div>
                    </div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {step.type === "augmentation" && step.branches?.[0] && (
              <Badge className="text-[10px] px-1.5 py-0 bg-indigo-500 hover:bg-indigo-500 shrink-0">
                <Layers className="h-2.5 w-2.5 mr-0.5" />
                {step.branches[0].length} transforms
              </Badge>
            )}
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
          {hasSweeps ? (
            <p className="text-xs text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap">
              {displayParams && <span>{displayParams}</span>}
              {displayParams && sweepCount > 0 && <span className="mx-1">•</span>}
              <span className="text-orange-500">{sweepCount} sweep{sweepCount !== 1 ? "s" : ""}</span>
            </p>
          ) : (
            displayParams && (
              <p className="text-xs text-muted-foreground font-mono overflow-hidden text-ellipsis whitespace-nowrap" title={allParamsDisplay}>
                {allParamsDisplay}
              </p>
            )
          )}
          {step.customName && (
            <p className="text-xs text-emerald-500 font-medium">
              as "{step.customName}"
            </p>
          )}
        </div>

        {!isDragging && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-card pl-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(event) => {
                event.stopPropagation();
                onDuplicate();
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {step.subType === "branch" && step.branches && (
        <BranchesContainer
          step={step}
          path={path}
          depth={depth}
          onAddBranch={onAddBranch}
          onRemoveBranch={onRemoveBranch}
          branchLabel="Branch"
        />
      )}

      {step.subType === "generator" && step.branches && (
        <BranchesContainer
          step={step}
          path={path}
          depth={depth}
          onAddBranch={onAddBranch}
          onRemoveBranch={onRemoveBranch}
          branchLabel={generatorBranchLabel}
          isGenerator
        />
      )}

      {step.type === "augmentation" && step.branches?.[0] && step.branches[0].length > 0 && (
        <NestedStepsDisplay
          steps={step.branches[0]}
          label="Transformers"
          colorClass="text-indigo-500"
          borderClass="border-indigo-500/30"
        />
      )}

      {step.type === "filter" && step.branches?.[0] && step.branches[0].length > 0 && (
        <NestedStepsDisplay
          steps={step.branches[0]}
          label="Filters"
          colorClass="text-rose-500"
          borderClass="border-rose-500/30"
        />
      )}
    </>
  );
}

function formatParamEntry([key, value]: [string, unknown]) {
  return `${key}=${value}`;
}

interface BranchesContainerProps {
  step: PipelineStep;
  path: string[];
  depth: number;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
  branchLabel?: string;
  isGenerator?: boolean;
}

function BranchesContainer({
  step,
  path,
  depth,
  onAddBranch,
  onRemoveBranch,
  branchLabel = "Branch",
  isGenerator = false,
}: BranchesContainerProps) {
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

function BranchDropZone({
  branchIndex,
  branch,
  parentPath,
  depth,
  onRemoveBranch,
  canRemove,
  branchLabel = "Branch",
  isGenerator = false,
}: BranchDropZoneProps) {
  const branchPath = [...parentPath, "branch", String(branchIndex)];

  const { setNodeRef, isOver } = useDroppable({
    id: `branch-${parentPath.join("-")}-${branchIndex}`,
    data: {
      type: "drop-zone",
      path: branchPath,
      index: branch.length,
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

function BranchStepPreview({ step, index }: { step: PipelineStep; index: number }) {
  const Icon = getPipelineNodeIcon(step);
  const colors = getStepColor(step);

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${colors.border} ${colors.bg}`}>
      <span className="text-[10px] font-mono text-muted-foreground w-3">{index + 1}</span>
      <Icon className={`h-3 w-3 ${colors.text}`} />
      <span className="text-xs font-medium truncate">{step.name}</span>
      {Object.keys(step.params).length > 0 && (
        <span className="text-[10px] text-muted-foreground font-mono truncate ml-auto">
          {Object.entries(step.params).slice(0, 2).map(formatParamEntry).join(", ")}
        </span>
      )}
    </div>
  );
}

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
