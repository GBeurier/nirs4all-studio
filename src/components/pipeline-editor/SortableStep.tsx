import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Waves,
  Shuffle,
  Target,
  BarChart3,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Copy,
  Trash2,
  MoreVertical,
  GitBranch,
  GitMerge,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { stepColors, type PipelineStep, type StepType } from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  metrics: BarChart3,
  branch: GitBranch,
  merge: GitMerge,
};

interface SortableStepProps {
  step: PipelineStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export function SortableStep({
  step,
  index,
  isSelected,
  onSelect,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: SortableStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];

  // Format parameters for display
  const paramDisplay = Object.entries(step.params)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  const hasMoreParams = Object.keys(step.params).length > 3;

  const stepContent = (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex flex-col gap-2 p-4 rounded-xl border-2 transition-all duration-200 bg-card ${colors.border} ${
        isDragging
          ? "opacity-50 shadow-2xl scale-105 z-50"
          : isSelected
          ? `ring-2 ${colors.active} shadow-lg`
          : "hover:shadow-md hover:scale-[1.01]"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-3">
        {/* Step Number */}
        <div className="absolute -left-3 top-6 -translate-y-1/2 w-6 h-6 rounded-full bg-card border-2 border-border flex items-center justify-center text-xs font-bold text-muted-foreground shadow-sm">
          {index + 1}
        </div>

        {/* Drag Handle */}
        <div
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -m-1 rounded hover:bg-muted/50 touch-none"
        >
          <GripVertical className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Step Icon */}
        <div className={`p-2 rounded-lg bg-background/50 ${colors.text}`}>
          <Icon className="h-5 w-5" />
        </div>

        {/* Step Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">{step.name}</span>
            <Badge variant="secondary" className="text-xs capitalize">
              {step.type}
            </Badge>
          </div>
          {Object.keys(step.params).length > 0 && (
            <p className="text-sm text-muted-foreground mt-1 truncate">
              {paramDisplay}
              {hasMoreParams && ", ..."}
            </p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onMoveUp();
            }}
            disabled={!canMoveUp}
          >
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onMoveDown();
            }}
            disabled={!canMoveDown}
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              <DropdownMenuItem onClick={onSelect}>Configure</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
                <ChevronUp className="h-4 w-4 mr-2" />
                Move Up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
                <ChevronDown className="h-4 w-4 mr-2" />
                Move Down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onRemove}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Branches Visualization (Read-only for now) */}
      {step.branches && step.branches.length > 0 && (
        <div className="mt-2 pl-4 border-l-2 border-dashed border-border space-y-2">
          {step.branches.map((branch, bIndex) => (
            <div key={bIndex} className="bg-muted/30 rounded-lg p-2">
              <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <GitBranch className="h-3 w-3" />
                Branch {bIndex + 1}
              </div>
              {branch.length === 0 ? (
                <div className="text-xs text-muted-foreground italic p-2 text-center border border-dashed rounded">
                  Empty branch
                </div>
              ) : (
                <div className="space-y-2">
                  {branch.map((branchStep, sIndex) => (
                    <div
                      key={branchStep.id}
                      className="flex items-center gap-2 p-2 rounded bg-card border text-xs"
                    >
                      <span className="font-mono text-muted-foreground">
                        {sIndex + 1}
                      </span>
                      <span className="font-medium">{branchStep.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{stepContent}</ContextMenuTrigger>
      <ContextMenuContent className="bg-popover w-48">
        <ContextMenuItem onClick={onSelect}>Configure</ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate}>
          <Copy className="h-4 w-4 mr-2" />
          Duplicate
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
          <ChevronUp className="h-4 w-4 mr-2" />
          Move Up
        </ContextMenuItem>
        <ContextMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
          <ChevronDown className="h-4 w-4 mr-2" />
          Move Down
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onRemove}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
