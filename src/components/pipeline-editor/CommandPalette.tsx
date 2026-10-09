/**
 * CommandPalette Component
 *
 * A quick-action command palette for the Pipeline Editor inspired by VS Code.
 * Provides fast access to:
 * - Adding steps from the palette
 * - Navigating to steps
 * - Quick actions (duplicate, delete, configure)
 * - Enabling sweeps/finetuning
 *
 * Activated with Cmd+K (or Ctrl+K on Windows/Linux)
 *
 * Part of Phase 5: UX Polish
 *
 * The command read-models (build/filter/group) live in commandPaletteData.ts
 * and the shared types in commandPalette.types.ts so this file stays focused on
 * orchestration + state + rendering. See docs/ARCHITECTURE_BOUNDARIES.md.
 */

import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  type StepType,
  type StepOption,
  type PipelineStep,
} from "./types";
import { useStepMetadataCatalog } from "./shared/stepMetadata";
import { CommandPaletteItem } from "./CommandPaletteItem";
import {
  buildCommandActions,
  categoryLabelKeys,
  filterCommandActions,
  findSelectedStep,
  flattenSteps,
  groupCommandActions,
} from "./commandPaletteData";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  // Pipeline state
  steps: PipelineStep[];
  selectedStepId: string | null;

  // Step actions
  onAddStep: (type: StepType, option: StepOption) => void;
  onSelectStep: (id: string) => void;
  onDuplicateStep?: (id: string) => void;
  onRemoveStep?: (id: string) => void;
  onMoveStep?: (id: string, direction: "up" | "down") => void;

  // Pipeline actions
  onSave?: () => void;
  onRun?: () => void;
  onExport?: () => void;
  onToggleFavorite?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;

  // Navigation
  onOpenShortcutsHelp?: () => void;
  onFocusPanel?: (panel: "palette" | "tree" | "config") => void;
}

/** Max navigation entries rendered before the "+ N more" hint. */
const MAX_NAVIGATION_ITEMS = 10;

export function CommandPalette({
  open,
  onOpenChange,
  steps,
  selectedStepId,
  onAddStep,
  onSelectStep,
  onDuplicateStep,
  onRemoveStep,
  onMoveStep,
  onSave,
  onRun,
  onExport,
  onToggleFavorite,
  onUndo,
  onRedo,
  onOpenShortcutsHelp,
  onFocusPanel,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const { getStepOptions } = useStepMetadataCatalog();

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  // Build flattened list of all steps for navigation
  const flattenedSteps = useMemo(() => flattenSteps(steps), [steps]);

  // Get selected step for context-aware actions
  const selectedStep = useMemo(
    () => findSelectedStep(flattenedSteps, selectedStepId),
    [selectedStepId, flattenedSteps],
  );

  // Build command actions
  const actions = useMemo(
    () =>
      buildCommandActions({
        steps,
        flattenedSteps,
        selectedStep,
        selectedStepId,
        getStepOptions,
        handlers: {
          onAddStep,
          onSelectStep,
          onDuplicateStep,
          onRemoveStep,
          onMoveStep,
          onSave,
          onRun,
          onExport,
          onToggleFavorite,
          onUndo,
          onRedo,
          onOpenShortcutsHelp,
          onFocusPanel,
          onOpenChange,
        },
      }),
    [
      selectedStep,
      selectedStepId,
      steps,
      flattenedSteps,
      onAddStep,
      onSelectStep,
      onDuplicateStep,
      onRemoveStep,
      onMoveStep,
      onSave,
      onRun,
      onExport,
      onToggleFavorite,
      onUndo,
      onRedo,
      onOpenShortcutsHelp,
      onFocusPanel,
      onOpenChange,
      getStepOptions,
    ],
  );

  // Filter actions based on search query
  const filteredActions = useMemo(
    () => filterCommandActions(actions, searchQuery),
    [actions, searchQuery],
  );

  // Group actions by category
  const groupedActions = useMemo(
    () => groupCommandActions(filteredActions),
    [filteredActions],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command className="rounded-lg border shadow-md">
        <CommandInput
          placeholder={t("pipelineEditor.commands.placeholder")}
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>{t("pipelineEditor.commands.empty")}</CommandEmpty>

          {/* Selected Step Actions */}
          {groupedActions.step.length > 0 && (
            <CommandGroup heading={t(categoryLabelKeys.step)}>
              {groupedActions.step.map((action) => (
                <CommandPaletteItem key={action.id} action={action} />
              ))}
            </CommandGroup>
          )}

          {/* Pipeline Actions */}
          {groupedActions.pipeline.length > 0 && (
            <>
              {groupedActions.step.length > 0 && <CommandSeparator />}
              <CommandGroup heading={t(categoryLabelKeys.pipeline)}>
                {groupedActions.pipeline.map((action) => (
                  <CommandPaletteItem key={action.id} action={action} />
                ))}
              </CommandGroup>
            </>
          )}

          {/* Other Actions */}
          {groupedActions.action.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t(categoryLabelKeys.action)}>
                {groupedActions.action.map((action) => (
                  <CommandPaletteItem key={action.id} action={action} />
                ))}
              </CommandGroup>
            </>
          )}

          {/* Navigation */}
          {groupedActions.navigation.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t(categoryLabelKeys.navigation)}>
                {groupedActions.navigation.slice(0, MAX_NAVIGATION_ITEMS).map((action) => (
                  <CommandPaletteItem key={action.id} action={action} />
                ))}
                {groupedActions.navigation.length > MAX_NAVIGATION_ITEMS && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
                    {t("pipelineEditor.commands.moreSteps", { count: groupedActions.navigation.length - MAX_NAVIGATION_ITEMS })}
                  </div>
                )}
              </CommandGroup>
            </>
          )}

          {/* Add Step */}
          {groupedActions["add-step"].length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={t(categoryLabelKeys["add-step"])}>
                {groupedActions["add-step"].map((action) => (
                  <CommandPaletteItem key={action.id} action={action} />
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export default CommandPalette;
