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
import { useTranslation } from "react-i18next";
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
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "./types";
import {
  calculateBranchSummaryStats,
  calculateBranchVariantCount,
  getAddBranchButtonDescriptor,
  getBranchOutputDescriptor,
  getBranchSummaryLabel,
  getBranchVisualClasses,
  getDefaultBranchName,
} from "./branchEnhancementsData";

// Branch metadata interface
export interface BranchMetadata {
  name: string;
  isCollapsed: boolean;
  color?: string;
  description?: string;
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
  const { t } = useTranslation();
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
  const { headerBackground, iconColor } = getBranchVisualClasses(isGenerator);

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1 px-2 rounded-md transition-colors group",
        headerBackground,
        className
      )}
    >
      {/* Collapse toggle */}
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? t("pipelineEditor.branch.header.expand") : t("pipelineEditor.branch.header.collapse")}
        aria-expanded={!isCollapsed}
        className={cn(
          "p-0.5 rounded hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
            aria-label={t("pipelineEditor.branch.header.nameInput")}
            className="h-5 px-1 py-0 text-xs font-medium bg-background"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-primary"
            onClick={handleSave}
            aria-label={t("pipelineEditor.branch.header.confirmRename")}
          >
            <Check className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={handleCancel}
            aria-label={t("pipelineEditor.branch.header.cancelRename")}
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
              {t("pipelineEditor.branch.header.stepCount", { count: stepCount })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span>{t("pipelineEditor.branch.header.stepsTooltip")}</span>
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
              <span>{t("pipelineEditor.branch.header.variantsTooltip")}</span>
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
            className="h-5 w-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            aria-label={t("pipelineEditor.branch.header.actions")}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={handleStartEdit}>
            <Edit2 className="h-3.5 w-3.5 mr-2" />
            {t("pipelineEditor.branch.header.rename")}
          </DropdownMenuItem>
          {onDuplicate && (
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              {t("pipelineEditor.branch.header.duplicate")}
            </DropdownMenuItem>
          )}
          {(onMoveUp || onMoveDown) && <DropdownMenuSeparator />}
          {onMoveUp && (
            <DropdownMenuItem onClick={onMoveUp}>
              <Move className="h-3.5 w-3.5 mr-2 rotate-90" />
              {t("pipelineEditor.branch.header.moveUp")}
            </DropdownMenuItem>
          )}
          {onMoveDown && (
            <DropdownMenuItem onClick={onMoveDown}>
              <Move className="h-3.5 w-3.5 mr-2 -rotate-90" />
              {t("pipelineEditor.branch.header.moveDown")}
            </DropdownMenuItem>
          )}
          {canRemove && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                {t("common.delete")}
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
  const { t } = useTranslation();
  const stats = useMemo(() => {
    return calculateBranchSummaryStats(branches);
  }, [branches]);

  const label = getBranchSummaryLabel(isGenerator, generatorKind, stats.branchCount);

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

      <span>{t("pipelineEditor.branch.summary.totalSteps", { count: stats.totalSteps })}</span>

      {stats.modelCount > 0 && (
        <>
          <span className="text-muted-foreground/50">•</span>
          <div className="flex items-center gap-1">
            <Target className="h-3 w-3 text-emerald-500" />
            <span>{t("pipelineEditor.branch.summary.models", { count: stats.modelCount })}</span>
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
              {t("pipelineEditor.branch.summary.empty", { count: stats.emptyBranches })}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {t("pipelineEditor.branch.summary.emptyTooltip", { count: stats.emptyBranches })}
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

const outputIconByKey = {
  layers: Layers,
  arrowRight: ArrowRight,
  hash: Hash,
} as const;

/**
 * Visual indicator showing what a branch produces as output
 */
export function BranchOutputIndicator({
  branchType,
  branchCount,
  modelCount,
  className,
}: BranchOutputIndicatorProps) {
  const outputDescriptor = getBranchOutputDescriptor(branchType, branchCount, modelCount);
  const Icon = outputIconByKey[outputDescriptor.icon];

  return (
    <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <Icon className={cn("h-3 w-3", outputDescriptor.colorClass)} />
      <span>{outputDescriptor.description}</span>
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
    () => calculateBranchVariantCount(branch),
    [branch]
  );

  const { containerBorderColor } = getBranchVisualClasses(isGenerator);

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
          <div className={cn("border-l-2 border-dashed ml-2 pl-3 mt-1", containerBorderColor)}>
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
  const { label, colorClass } = getAddBranchButtonDescriptor(isGenerator, generatorKind);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-7 text-xs gap-1", colorClass, className)}
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
  const { t } = useTranslation();
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
          {t("pipelineEditor.branch.expandAll")}
        </>
      ) : (
        <>
          <EyeOff className="h-3 w-3 mr-1" />
          {t("pipelineEditor.branch.collapseAll")}
        </>
      )}
    </Button>
  );
}
