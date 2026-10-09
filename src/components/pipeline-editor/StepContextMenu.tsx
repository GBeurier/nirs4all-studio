/**
 * StepContextMenu - Right-click context menu for pipeline steps
 *
 * Provides context-aware actions for:
 * - Duplicating and deleting steps
 * - Adding to OR generators
 * - Wrapping in branches
 * - Adding parameter sweeps
 * - Configuring finetuning (for models)
 * - Enabling/disabling steps
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Copy,
  Trash2,
  Sparkles,
  GitBranch,
  Repeat,
  Settings,
  Power,
  PowerOff,
  ChevronRight,
  Plus,
  Layers,
  LayoutGrid,
  Target,
  Sliders,
  ArrowUp,
  ArrowDown,
  Scissors,
  Clipboard,
  Edit3,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuCheckboxItem,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { PipelineStep, StepType, StepOption } from "./types";
import { getStepColor, stepColors } from "./stepPresentation";
import { useStepMetadataCatalog } from "./shared/stepMetadata";

interface StepContextMenuProps {
  /** The step this menu is for */
  step: PipelineStep;
  /** Children to wrap (the step element) */
  children: React.ReactNode;
  /** Callback when duplicate is clicked */
  onDuplicate?: () => void;
  /** Callback when delete is clicked */
  onDelete?: () => void;
  /** Callback when move up is clicked */
  onMoveUp?: () => void;
  /** Callback when move down is clicked */
  onMoveDown?: () => void;
  /** Callback when enable/disable is toggled */
  onToggleEnabled?: () => void;
  /** Callback when "Add to OR Generator" is clicked */
  onAddToOrGenerator?: () => void;
  /** Callback when "Wrap in Branch" is clicked */
  onWrapInBranch?: () => void;
  /** Callback when "Add Parameter Sweep" is clicked */
  onAddSweep?: (paramKey: string) => void;
  /** Callback when "Configure Finetuning" is clicked (models only) */
  onConfigureFinetuning?: () => void;
  /** Callback when "Edit Parameters" is clicked */
  onEditParams?: () => void;
  /** Callback when "Insert Before" is clicked */
  onInsertBefore?: (type: StepType, option: StepOption) => void;
  /** Callback when "Insert After" is clicked */
  onInsertAfter?: (type: StepType, option: StepOption) => void;
  /** Whether to disable certain actions */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** Additional class names */
  className?: string;
}

export function StepContextMenu({
  step,
  children,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onAddToOrGenerator,
  onWrapInBranch,
  onAddSweep,
  onConfigureFinetuning,
  onEditParams,
  onInsertBefore,
  onInsertAfter,
  canMoveUp = true,
  canMoveDown = true,
  className,
}: StepContextMenuProps) {
  const { t } = useTranslation();
  const isModel = step.type === "model";
  const isPreprocessing = step.type === "preprocessing";
  const isSplitting = step.type === "splitting";
  const isEnabled = step.enabled !== false;
  const hasParams = Object.keys(step.params).length > 0;
  const hasSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;
  const { getStepOptions } = useStepMetadataCatalog();

  // Get available parameters for sweep menu
  const sweepableParams = useMemo(() => {
    return Object.entries(step.params)
      .filter(([key, value]) => typeof value === "number")
      .map(([key]) => key);
  }, [step.params]);

  // Get insert options (limited set for quick access)
  const quickInsertOptions = useMemo(() => {
    const preprocessing = getStepOptions("preprocessing").slice(0, 5);
    const models = getStepOptions("model").slice(0, 3);
    return { preprocessing, models };
  }, [getStepOptions]);

  const colors = getStepColor(step);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className={className}>
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56 bg-popover">
        {/* Header */}
        <ContextMenuLabel className="flex items-center gap-2">
          <span className={colors.text}>{step.name}</span>
          <span className="text-xs text-muted-foreground">
            ({t(`pipelineEditor.config.panel.stepType.${step.type}`)})
          </span>
        </ContextMenuLabel>

        <ContextMenuSeparator />

        {/* Basic actions */}
        {onEditParams && (
          <ContextMenuItem onClick={onEditParams}>
            <Edit3 className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.editParams")}
          </ContextMenuItem>
        )}

        {onDuplicate && (
          <ContextMenuItem onClick={onDuplicate}>
            <Copy className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.duplicate")}
            <ContextMenuShortcut>⌘D</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        {onDelete && (
          <ContextMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.delete")}
            <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* Enable/Disable */}
        {onToggleEnabled && (
          <ContextMenuCheckboxItem
            checked={isEnabled}
            onCheckedChange={onToggleEnabled}
          >
            {isEnabled ? (
              <>
                <Power className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.enabled")}
              </>
            ) : (
              <>
                <PowerOff className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.disabled")}
              </>
            )}
          </ContextMenuCheckboxItem>
        )}

        {/* Move actions */}
        {(onMoveUp || onMoveDown) && (
          <>
            <ContextMenuSeparator />
            {onMoveUp && (
              <ContextMenuItem onClick={onMoveUp} disabled={!canMoveUp}>
                <ArrowUp className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.moveUp")}
              </ContextMenuItem>
            )}
            {onMoveDown && (
              <ContextMenuItem onClick={onMoveDown} disabled={!canMoveDown}>
                <ArrowDown className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.moveDown")}
              </ContextMenuItem>
            )}
          </>
        )}

        <ContextMenuSeparator />

        {/* Generator/Branch options */}
        {onAddToOrGenerator && (
          <ContextMenuItem onClick={onAddToOrGenerator}>
            <Sparkles className="h-4 w-4 mr-2 text-orange-500" />
            {t("pipelineEditor.stepMenu.addToOrGenerator")}
          </ContextMenuItem>
        )}

        {onWrapInBranch && (
          <ContextMenuItem onClick={onWrapInBranch}>
            <GitBranch className="h-4 w-4 mr-2 text-cyan-500" />
            {t("pipelineEditor.stepMenu.wrapInBranch")}
          </ContextMenuItem>
        )}

        {/* Sweep options (for steps with numeric params) */}
        {hasParams && onAddSweep && sweepableParams.length > 0 && (
          <>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Repeat className="h-4 w-4 mr-2 text-orange-500" />
                {t("pipelineEditor.stepMenu.addParamSweep")}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="bg-popover">
                {sweepableParams.map((param) => {
                  const hasSweep = step.paramSweeps?.[param];
                  return (
                    <ContextMenuItem
                      key={param}
                      onClick={() => onAddSweep(param)}
                      className={hasSweep ? "text-orange-500" : ""}
                    >
                      <Repeat className="h-3.5 w-3.5 mr-2" />
                      {param.replace(/_/g, " ")}
                      {hasSweep && (
                        <span className="ml-auto text-xs opacity-60">{t("pipelineEditor.stepMenu.sweepActive")}</span>
                      )}
                    </ContextMenuItem>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
          </>
        )}

        {/* Model-specific: Finetuning */}
        {isModel && onConfigureFinetuning && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onConfigureFinetuning}>
              <Sliders className="h-4 w-4 mr-2 text-purple-500" />
              {t("pipelineEditor.stepMenu.configureFinetuning")}
              <ContextMenuShortcut>⌘F</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}

        {/* Insert options */}
        {(onInsertBefore || onInsertAfter) && (
          <>
            <ContextMenuSeparator />

            {onInsertBefore && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("pipelineEditor.stepMenu.insertBefore")}
                  <ChevronRight className="h-4 w-4 ml-auto" />
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="bg-popover w-48">
                  <ContextMenuLabel className="text-xs">
                    {t("pipelineEditor.stepMenu.groupPreprocessing")}
                  </ContextMenuLabel>
                  {quickInsertOptions.preprocessing.map((opt) => (
                    <ContextMenuItem
                      key={opt.name}
                      onClick={() => onInsertBefore("preprocessing", opt)}
                    >
                      <span className={stepColors.preprocessing.text}>
                        {opt.name}
                      </span>
                    </ContextMenuItem>
                  ))}
                  <ContextMenuSeparator />
                  <ContextMenuLabel className="text-xs">{t("pipelineEditor.stepMenu.groupModels")}</ContextMenuLabel>
                  {quickInsertOptions.models.map((opt) => (
                    <ContextMenuItem
                      key={opt.name}
                      onClick={() => onInsertBefore("model", opt)}
                    >
                      <span className={stepColors.model.text}>{opt.name}</span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}

            {onInsertAfter && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Plus className="h-4 w-4 mr-2" />
                  {t("pipelineEditor.stepMenu.insertAfter")}
                  <ChevronRight className="h-4 w-4 ml-auto" />
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="bg-popover w-48">
                  <ContextMenuLabel className="text-xs">
                    {t("pipelineEditor.stepMenu.groupPreprocessing")}
                  </ContextMenuLabel>
                  {quickInsertOptions.preprocessing.map((opt) => (
                    <ContextMenuItem
                      key={opt.name}
                      onClick={() => onInsertAfter("preprocessing", opt)}
                    >
                      <span className={stepColors.preprocessing.text}>
                        {opt.name}
                      </span>
                    </ContextMenuItem>
                  ))}
                  <ContextMenuSeparator />
                  <ContextMenuLabel className="text-xs">{t("pipelineEditor.stepMenu.groupModels")}</ContextMenuLabel>
                  {quickInsertOptions.models.map((opt) => (
                    <ContextMenuItem
                      key={opt.name}
                      onClick={() => onInsertAfter("model", opt)}
                    >
                      <span className={stepColors.model.text}>{opt.name}</span>
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * GeneratorContextMenu - Context menu for generator steps (OR/Cartesian)
 */
interface GeneratorContextMenuProps {
  step: PipelineStep;
  children: React.ReactNode;
  onAddOption?: () => void;
  onAddStage?: () => void;
  onConvertType?: (type: "or" | "cartesian") => void;
  onUnwrap?: () => void;
  onDelete?: () => void;
  className?: string;
}

export function GeneratorContextMenu({
  step,
  children,
  onAddOption,
  onAddStage,
  onConvertType,
  onUnwrap,
  onDelete,
  className,
}: GeneratorContextMenuProps) {
  const { t } = useTranslation();
  const isOr = step.generatorKind === "or";
  const isCartesian = step.generatorKind === "cartesian";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className={className}>
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48 bg-popover">
        <ContextMenuLabel>
          {isOr ? t("pipelineEditor.stepMenu.generator.or") : isCartesian ? t("pipelineEditor.stepMenu.generator.cartesian") : t("pipelineEditor.stepMenu.generator.generic")}
        </ContextMenuLabel>

        <ContextMenuSeparator />

        {isOr && onAddOption && (
          <ContextMenuItem onClick={onAddOption}>
            <Plus className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.generator.addOption")}
          </ContextMenuItem>
        )}

        {isCartesian && onAddStage && (
          <ContextMenuItem onClick={onAddStage}>
            <Layers className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.generator.addStage")}
          </ContextMenuItem>
        )}

        {onConvertType && (
          <>
            <ContextMenuSeparator />
            {!isOr && (
              <ContextMenuItem onClick={() => onConvertType("or")}>
                <Sparkles className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.convertToOr")}
              </ContextMenuItem>
            )}
            {!isCartesian && (
              <ContextMenuItem onClick={() => onConvertType("cartesian")}>
                <LayoutGrid className="h-4 w-4 mr-2" />
                {t("pipelineEditor.stepMenu.generator.convertToCartesian")}
              </ContextMenuItem>
            )}
          </>
        )}

        {onUnwrap && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onUnwrap}>
              <Scissors className="h-4 w-4 mr-2" />
              {t("pipelineEditor.stepMenu.generator.unwrap")}
            </ContextMenuItem>
          </>
        )}

        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              {t("pipelineEditor.stepMenu.generator.delete")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * BranchContextMenu - Context menu for branch steps
 */
interface BranchContextMenuProps {
  step: PipelineStep;
  branchIndex?: number;
  children: React.ReactNode;
  onAddBranch?: () => void;
  onRemoveBranch?: () => void;
  onDuplicateBranch?: () => void;
  onConvertToGenerator?: () => void;
  onDelete?: () => void;
  canRemoveBranch?: boolean;
  className?: string;
}

export function BranchContextMenu({
  step,
  branchIndex,
  children,
  onAddBranch,
  onRemoveBranch,
  onDuplicateBranch,
  onConvertToGenerator,
  onDelete,
  canRemoveBranch = true,
  className,
}: BranchContextMenuProps) {
  const { t } = useTranslation();
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild className={className}>
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent className="w-48 bg-popover">
        <ContextMenuLabel>
          {branchIndex !== undefined ? t("pipelineEditor.stepMenu.branch.title", { index: branchIndex + 1 }) : t("pipelineEditor.stepMenu.branch.parallel")}
        </ContextMenuLabel>

        <ContextMenuSeparator />

        {onAddBranch && (
          <ContextMenuItem onClick={onAddBranch}>
            <Plus className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.branch.add")}
          </ContextMenuItem>
        )}

        {branchIndex !== undefined && onDuplicateBranch && (
          <ContextMenuItem onClick={onDuplicateBranch}>
            <Copy className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.branch.duplicate")}
          </ContextMenuItem>
        )}

        {branchIndex !== undefined && onRemoveBranch && (
          <ContextMenuItem
            onClick={onRemoveBranch}
            disabled={!canRemoveBranch}
            className={canRemoveBranch ? "text-destructive" : ""}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            {t("pipelineEditor.stepMenu.branch.remove")}
          </ContextMenuItem>
        )}

        {onConvertToGenerator && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onConvertToGenerator}>
              <Sparkles className="h-4 w-4 mr-2 text-orange-500" />
              {t("pipelineEditor.stepMenu.convertToOr")}
            </ContextMenuItem>
          </>
        )}

        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              {t("pipelineEditor.stepMenu.branch.deleteStep")}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
