/**
 * Enhanced Branch Components
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides enhanced branch visualization and management including:
 * - Collapsible branches with state persistence
 * - Branch naming and renaming
 * - Per-branch variant count badges
 * - Branch output type indicators
 * - Branch summary statistics
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Copy,
  Sparkles,
  Repeat,
  Target,
  Layers,
  GripVertical,
  ArrowRight,
  Hash,
  MoreHorizontal,
  FolderOpen,
  FolderClosed,
  Move,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { type PipelineStep, type StepType, stepColors, calculateStepVariants } from "./types";

// Branch metadata interface
export interface BranchMetadata {
  name: string;
  isCollapsed: boolean;
  color?: string;
  description?: string;
}

// Default branch names
function getDefaultBranchName(type: "branch" | "generator", generatorKind?: string, index?: number): string {
  const idx = (index ?? 0) + 1;
  if (type === "generator") {
    if (generatorKind === "cartesian") {
      return `Stage ${idx}`;
    }
    return `Option ${idx}`;
  }
  return `Branch ${idx}`;
}

interface EnhancedBranchHeaderProps {
  branchIndex: number;
  branchName?: string;
  stepCount: number;
  variantCount: number;
  isCollapsed: boolean;
  isGenerator: boolean;
  generatorKind?: string;
  canRemove: boolean;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  className?: string;
}

/**
 * Enhanced branch header with naming, collapse, and actions
 */
export function EnhancedBranchHeader({
  branchIndex,
  branchName,
  stepCount,
  variantCount,
  isCollapsed,
  isGenerator,
  generatorKind,
  canRemove,
  onToggleCollapse,
  onRename,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  className,
}: EnhancedBranchHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultName = getDefaultBranchName(
    isGenerator ? "generator" : "branch",
    generatorKind,
    branchIndex
  );
  const displayName = branchName || defaultName;

  const handleStartEdit = useCallback(() => {
    setEditValue(displayName);
    setIsEditing(true);
  }, [displayName]);

  const handleSave = useCallback(() => {
    const newName = editValue.trim();
    if (newName && newName !== defaultName) {
      onRename(newName);
    } else {
      onRename(""); // Reset to default
    }
    setIsEditing(false);
  }, [editValue, defaultName, onRename]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const BranchIcon = isGenerator ? Sparkles : GitBranch;
  const CollapseIcon = isCollapsed ? FolderClosed : FolderOpen;
  const borderColor = isGenerator ? "border-orange-400/50" : "border-cyan-500/50";
  const iconColor = isGenerator ? "text-orange-400" : "text-cyan-500";
  const bgColor = isGenerator ? "bg-orange-500/5" : "bg-cyan-500/5";

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1 px-2 rounded-md transition-colors group",
        bgColor,
        className
      )}
    >
      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapse}
        className={cn(
          "p-0.5 rounded hover:bg-muted/50 transition-colors",
          iconColor
        )}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Branch icon */}
      <BranchIcon className={cn("h-3.5 w-3.5", iconColor)} />

      {/* Name - editable or display */}
      {isEditing ? (
        <div className="flex items-center gap-1 flex-1">
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            className="h-5 px-1 py-0 text-xs font-medium bg-background"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-primary"
            onClick={handleSave}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={handleCancel}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <button
          onClick={handleStartEdit}
          className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-primary transition-colors"
        >
          <span>{displayName}</span>
          <Edit2 className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
        </button>
      )}

      {/* Stats badges */}
      <div className="flex items-center gap-1 ml-auto">
        {/* Step count */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="secondary" className="text-[10px] px-1 h-4 tabular-nums">
              {stepCount} {stepCount === 1 ? "step" : "steps"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>Steps in this branch</span>
          </TooltipContent>
        </Tooltip>

        {/* Variant count */}
        {variantCount > 1 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge className="text-[10px] px-1 h-4 tabular-nums bg-orange-500 hover:bg-orange-500">
                <Repeat className="h-2.5 w-2.5 mr-0.5" />
                {variantCount}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Variants in this branch</span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Actions dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={handleStartEdit}>
            <Edit2 className="h-3.5 w-3.5 mr-2" />
            Rename
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
          )}
          {(onMoveUp || onMoveDown) && <DropdownMenuSeparator />}
          {onMoveUp && (
            <DropdownMenuItem onClick={onMoveUp}>
              <Move className="h-3.5 w-3.5 mr-2 rotate-90" />
              Move Up
            </DropdownMenuItem>
          )}
          {onMoveDown && (
            <DropdownMenuItem onClick={onMoveDown}>
              <Move className="h-3.5 w-3.5 mr-2 -rotate-90" />
              Move Down
            </DropdownMenuItem>
          )}
          {canRemove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface BranchSummaryProps {
  branches: PipelineStep[][];
  isGenerator: boolean;
  generatorKind?: string;
  className?: string;
}

/**
 * Summary statistics for all branches in a step
 */
export function BranchSummary({
  branches,
  isGenerator,
  generatorKind,
  className,
}: BranchSummaryProps) {
  const stats = useMemo(() => {
    const totalSteps = branches.reduce((sum, b) => sum + b.length, 0);
    const totalVariants = branches.reduce(
      (sum, b) => sum + b.reduce((s, step) => s * calculateStepVariants(step), 1),
      0
    );
    const modelCount = branches.reduce(
      (sum, b) => sum + b.filter((s) => s.type === "model").length,
      0
    );
    const emptyBranches = branches.filter((b) => b.length === 0).length;

    return {
      branchCount: branches.length,
      totalSteps,
      totalVariants,
      modelCount,
      emptyBranches,
    };
  }, [branches]);

  const label = isGenerator
    ? generatorKind === "cartesian"
      ? "stages"
      : "options"
    : "branches";

  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <div className="flex items-center gap-1">
        {isGenerator ? (
          <Sparkles className="h-3 w-3 text-orange-400" />
        ) : (
          <GitBranch className="h-3 w-3 text-cyan-500" />
        )}
        <span>
          {stats.branchCount} {label}
        </span>
      </div>

      <span className="text-muted-foreground/50">•</span>

      <span>{stats.totalSteps} total steps</span>

      {stats.modelCount > 0 && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-emerald-500" />
            <span>{stats.modelCount} models</span>
          </div>
        </>
      )}

      {stats.totalVariants > 1 && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <Badge className="text-[10px] px-1 h-4 bg-orange-500 hover:bg-orange-500">
            <Repeat className="h-2.5 w-2.5 mr-0.5" />
            {stats.totalVariants}
          </Badge>
        </>
      )}

      {stats.emptyBranches > 0 && (
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="outline" className="text-[10px] px-1 h-4 border-yellow-500/50 text-yellow-500">
              {stats.emptyBranches} empty
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {stats.emptyBranches} {stats.emptyBranches === 1 ? "branch is" : "branches are"} empty
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

interface BranchOutputIndicatorProps {
  branchType: "parallel" | "or" | "cartesian";
  branchCount: number;
  modelCount: number;
  className?: string;
}

/**
 * Visual indicator showing what a branch produces as output
 */
export function BranchOutputIndicator({
  branchType,
  branchCount,
  modelCount,
  className,
}: BranchOutputIndicatorProps) {
  const getOutputDescription = () => {
    switch (branchType) {
      case "parallel":
        return modelCount > 0
          ? `${modelCount} parallel predictions → merge`
          : `${branchCount} parallel processings`;
      case "or":
        return `1 of ${branchCount} alternatives`;
      case "cartesian":
        return `${branchCount} stage combinations`;
    }
  };

  const Icon = branchType === "parallel" ? Layers : branchType === "or" ? ArrowRight : Hash;
  const color =
    branchType === "parallel" ? "text-cyan-500" : branchType === "or" ? "text-orange-500" : "text-orange-500";

  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Icon className={cn("h-3 w-3", color)} />
      <span>{getOutputDescription()}</span>
    </div>
  );
}

interface CollapsibleBranchContainerProps {
  branchIndex: number;
  branch: PipelineStep[];
  branchName?: string;
  isGenerator: boolean;
  generatorKind?: string;
  canRemove: boolean;
  defaultCollapsed?: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Collapsible container for a single branch
 */
export function CollapsibleBranchContainer({
  branchIndex,
  branch,
  branchName,
  isGenerator,
  generatorKind,
  canRemove,
  defaultCollapsed = false,
  onRename,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  children,
  className,
}: CollapsibleBranchContainerProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const variantCount = useMemo(
    () => branch.reduce((acc, step) => acc * calculateStepVariants(step), 1),
    [branch]
  );

  const borderColor = isGenerator ? "border-orange-400/30" : "border-cyan-500/30";

  return (
    <div className={cn("relative", className)}>
      <EnhancedBranchHeader
        branchIndex={branchIndex}
        branchName={branchName}
        stepCount={branch.length}
        variantCount={variantCount}
        isCollapsed={isCollapsed}
        isGenerator={isGenerator}
        generatorKind={generatorKind}
        canRemove={canRemove}
        onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
        onRename={onRename}
        onRemove={onRemove}
        onDuplicate={onDuplicate}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
      />

      {/* Collapsible content with tree line */}
      <Collapsible open={!isCollapsed}>
        <CollapsibleContent>
          <div className={cn("border-l-2 border-dashed ml-2 pl-3 mt-1", borderColor)}>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface AddBranchButtonProps {
  isGenerator: boolean;
  generatorKind?: string;
  onClick: () => void;
  className?: string;
}

/**
 * Button to add a new branch
 */
export function AddBranchButton({
  isGenerator,
  generatorKind,
  onClick,
  className,
}: AddBranchButtonProps) {
  const label = isGenerator
    ? generatorKind === "cartesian"
      ? "Add Stage"
      : "Add Option"
    : "Add Branch";

  const color = isGenerator
    ? "text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
    : "text-cyan-500 hover:text-cyan-600 hover:bg-cyan-500/10";

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-7 text-xs gap-1", color, className)}
      onClick={onClick}
    >
      <Plus className="h-3 w-3" />
      {label}
    </Button>
  );
}

interface CollapseAllButtonProps {
  isAllCollapsed: boolean;
  onToggleAll: () => void;
  className?: string;
}

/**
 * Button to collapse/expand all branches
 */
export function CollapseAllButton({
  isAllCollapsed,
  onToggleAll,
  className,
}: CollapseAllButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-6 px-2 text-xs text-muted-foreground", className)}
      onClick={onToggleAll}
    >
      {isAllCollapsed ? (
        <>
          <Eye className="h-3 w-3 mr-1" />
          Expand All
        </>
      ) : (
        <>
          <EyeOff className="h-3 w-3 mr-1" />
          Collapse All
        </>
      )}
    </Button>
  );
}
