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
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Waves,
  Shuffle,
  Target,
  GitBranch,
  GitMerge,
  Sparkles,
  Filter,
  Zap,
  BarChart3,
  Plus,
  Copy,
  Trash2,
  Settings,
  ArrowUp,
  ArrowDown,
  Repeat,
  Layers,
  Search,
  Play,
  Save,
  Star,
  Undo2,
  Redo2,
  FileJson,
  Combine,
  LineChart,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  stepOptions,
  type StepType,
  type StepOption,
  type PipelineStep,
} from "./types";

// Icon mapping for step types
const stepTypeIcons: Record<StepType, LucideIcon> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  chart: LineChart,
  comment: MessageSquare,
};

// Color classes for step types
const stepTypeColors: Record<StepType, string> = {
  preprocessing: "text-blue-500",
  y_processing: "text-amber-500",
  splitting: "text-purple-500",
  model: "text-emerald-500",
  generator: "text-orange-500",
  branch: "text-cyan-500",
  merge: "text-pink-500",
  filter: "text-rose-500",
  augmentation: "text-indigo-500",
  sample_augmentation: "text-violet-500",
  feature_augmentation: "text-fuchsia-500",
  sample_filter: "text-red-500",
  concat_transform: "text-teal-500",
  chart: "text-sky-500",
  comment: "text-gray-500",
};

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

type CommandCategory =
  | "step"
  | "navigation"
  | "action"
  | "pipeline"
  | "add-step";

interface CommandAction {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  icon: LucideIcon;
  iconColor?: string;
  keywords?: string[];
  shortcut?: string;
  onSelect: () => void;
  disabled?: boolean;
}

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
  const [searchQuery, setSearchQuery] = useState("");

  // Reset search when closing
  useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  // Build flattened list of all steps for navigation
  const flattenedSteps = useMemo(() => {
    const result: { step: PipelineStep; path: string }[] = [];

    function flatten(stepList: PipelineStep[], pathPrefix: string = "") {
      for (const step of stepList) {
        const path = pathPrefix ? `${pathPrefix} → ${step.name}` : step.name;
        result.push({ step, path });

        if (step.branches) {
          for (let i = 0; i < step.branches.length; i++) {
            const branchLabel = step.generatorKind === "cartesian" ? `Stage ${i + 1}` : `Branch ${i + 1}`;
            flatten(step.branches[i], `${path} → ${branchLabel}`);
          }
        }
      }
    }

    flatten(steps);
    return result;
  }, [steps]);

  // Get selected step for context-aware actions
  const selectedStep = useMemo(() => {
    if (!selectedStepId) return null;
    return flattenedSteps.find(({ step }) => step.id === selectedStepId)?.step ?? null;
  }, [selectedStepId, flattenedSteps]);

  // Build command actions
  const actions = useMemo<CommandAction[]>(() => {
    const result: CommandAction[] = [];

    // === Selected Step Actions ===
    if (selectedStep && selectedStepId) {
      result.push({
        id: "configure-step",
        label: `Configure ${selectedStep.name}`,
        description: "Open configuration panel",
        category: "step",
        icon: Settings,
        iconColor: stepTypeColors[selectedStep.type],
        shortcut: "Enter",
        onSelect: () => {
          onFocusPanel?.("config");
          onOpenChange(false);
        },
      });

      if (onDuplicateStep) {
        result.push({
          id: "duplicate-step",
          label: `Duplicate ${selectedStep.name}`,
          category: "step",
          icon: Copy,
          iconColor: stepTypeColors[selectedStep.type],
          shortcut: "⌘D",
          onSelect: () => {
            onDuplicateStep(selectedStepId);
            onOpenChange(false);
          },
        });
      }

      if (onMoveStep) {
        const stepIndex = steps.findIndex(s => s.id === selectedStepId);
        if (stepIndex > 0) {
          result.push({
            id: "move-step-up",
            label: `Move ${selectedStep.name} Up`,
            category: "step",
            icon: ArrowUp,
            onSelect: () => {
              onMoveStep(selectedStepId, "up");
              onOpenChange(false);
            },
          });
        }
        if (stepIndex < steps.length - 1 && stepIndex >= 0) {
          result.push({
            id: "move-step-down",
            label: `Move ${selectedStep.name} Down`,
            category: "step",
            icon: ArrowDown,
            onSelect: () => {
              onMoveStep(selectedStepId, "down");
              onOpenChange(false);
            },
          });
        }
      }

      // Model-specific actions
      if (selectedStep.type === "model") {
        const hasFinetuning = selectedStep.finetuneConfig?.enabled;
        result.push({
          id: "configure-finetuning",
          label: hasFinetuning ? "Edit Finetuning" : "Enable Finetuning",
          description: "Configure Optuna hyperparameter optimization",
          category: "step",
          icon: Sparkles,
          iconColor: "text-purple-500",
          onSelect: () => {
            onSelectStep(selectedStepId);
            onFocusPanel?.("config");
            onOpenChange(false);
          },
        });
      }

      // Add sweep action for steps with numeric params
      const numericParams = Object.entries(selectedStep.params).filter(
        ([_, v]) => typeof v === "number"
      );
      if (numericParams.length > 0) {
        const hasSweeps = selectedStep.paramSweeps && Object.keys(selectedStep.paramSweeps).length > 0;
        result.push({
          id: "configure-sweep",
          label: hasSweeps ? "Edit Parameter Sweeps" : "Add Parameter Sweep",
          description: "Configure grid search for parameters",
          category: "step",
          icon: Repeat,
          iconColor: "text-orange-500",
          onSelect: () => {
            onSelectStep(selectedStepId);
            onFocusPanel?.("config");
            onOpenChange(false);
          },
        });
      }

      if (onRemoveStep) {
        result.push({
          id: "delete-step",
          label: `Delete ${selectedStep.name}`,
          category: "step",
          icon: Trash2,
          iconColor: "text-destructive",
          shortcut: "Del",
          onSelect: () => {
            onRemoveStep(selectedStepId);
            onOpenChange(false);
          },
        });
      }
    }

    // === Navigation Actions ===
    for (const { step, path } of flattenedSteps) {
      result.push({
        id: `go-to-${step.id}`,
        label: step.name,
        description: path !== step.name ? path : undefined,
        category: "navigation",
        icon: stepTypeIcons[step.type],
        iconColor: stepTypeColors[step.type],
        keywords: [step.name, step.type, path],
        onSelect: () => {
          onSelectStep(step.id);
          onOpenChange(false);
        },
      });
    }

    // === Pipeline Actions ===
    if (onSave) {
      result.push({
        id: "save-pipeline",
        label: "Save Pipeline",
        category: "pipeline",
        icon: Save,
        shortcut: "⌘S",
        onSelect: () => {
          onSave();
          onOpenChange(false);
        },
      });
    }

    if (onRun && steps.length > 0) {
      result.push({
        id: "run-pipeline",
        label: "Run Pipeline",
        description: "Use in experiment",
        category: "pipeline",
        icon: Play,
        iconColor: "text-emerald-500",
        onSelect: () => {
          onRun();
          onOpenChange(false);
        },
      });
    }

    if (onExport) {
      result.push({
        id: "export-json",
        label: "Export as JSON",
        category: "pipeline",
        icon: FileJson,
        onSelect: () => {
          onExport();
          onOpenChange(false);
        },
      });
    }

    if (onToggleFavorite) {
      result.push({
        id: "toggle-favorite",
        label: "Toggle Favorite",
        category: "pipeline",
        icon: Star,
        onSelect: () => {
          onToggleFavorite();
          onOpenChange(false);
        },
      });
    }

    // === Editing Actions ===
    if (onUndo) {
      result.push({
        id: "undo",
        label: "Undo",
        category: "action",
        icon: Undo2,
        shortcut: "⌘Z",
        onSelect: () => {
          onUndo();
          onOpenChange(false);
        },
      });
    }

    if (onRedo) {
      result.push({
        id: "redo",
        label: "Redo",
        category: "action",
        icon: Redo2,
        shortcut: "⌘⇧Z",
        onSelect: () => {
          onRedo();
          onOpenChange(false);
        },
      });
    }

    if (onOpenShortcutsHelp) {
      result.push({
        id: "keyboard-shortcuts",
        label: "Keyboard Shortcuts",
        description: "Show all shortcuts",
        category: "action",
        icon: Settings,
        shortcut: "⌘?",
        onSelect: () => {
          onOpenChange(false);
          // Small delay to avoid conflict with command palette closing
          setTimeout(() => onOpenShortcutsHelp(), 100);
        },
      });
    }

    // === Add Step Actions ===
    // Most common step types for quick access
    const quickAddTypes: StepType[] = ["preprocessing", "model", "splitting"];

    for (const type of quickAddTypes) {
      const options = stepOptions[type];
      // Show top 3 options per type
      for (const option of options.slice(0, 3)) {
        const Icon = stepTypeIcons[type];
        result.push({
          id: `add-${type}-${option.name}`,
          label: `Add ${option.name}`,
          description: option.description,
          category: "add-step",
          icon: Icon,
          iconColor: stepTypeColors[type],
          keywords: [type, option.name, option.description, option.category ?? ""],
          onSelect: () => {
            onAddStep(type, option);
            onOpenChange(false);
          },
        });
      }
    }

    return result;
  }, [
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
  ]);

  // Filter actions based on search query
  const filteredActions = useMemo(() => {
    if (!searchQuery.trim()) {
      return actions;
    }

    const query = searchQuery.toLowerCase();
    return actions.filter((action) => {
      const searchableText = [
        action.label,
        action.description ?? "",
        ...(action.keywords ?? []),
      ].join(" ").toLowerCase();

      return searchableText.includes(query);
    });
  }, [actions, searchQuery]);

  // Group actions by category
  const groupedActions = useMemo(() => {
    const groups: Record<CommandCategory, CommandAction[]> = {
      step: [],
      navigation: [],
      pipeline: [],
      action: [],
      "add-step": [],
    };

    for (const action of filteredActions) {
      groups[action.category].push(action);
    }

    return groups;
  }, [filteredActions]);

  const categoryLabels: Record<CommandCategory, string> = {
    step: "Selected Step",
    navigation: "Go to Step",
    pipeline: "Pipeline",
    action: "Actions",
    "add-step": "Add Step",
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command className="rounded-lg border shadow-md">
        <CommandInput
          placeholder="Type a command or search..."
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList className="max-h-[400px]">
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Selected Step Actions */}
          {groupedActions.step.length > 0 && (
            <CommandGroup heading={categoryLabels.step}>
              {groupedActions.step.map((action) => (
                <CommandPaletteItem key={action.id} action={action} />
              ))}
            </CommandGroup>
          )}

          {/* Pipeline Actions */}
          {groupedActions.pipeline.length > 0 && (
            <>
              {groupedActions.step.length > 0 && <CommandSeparator />}
              <CommandGroup heading={categoryLabels.pipeline}>
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
              <CommandGroup heading={categoryLabels.action}>
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
              <CommandGroup heading={categoryLabels.navigation}>
                {groupedActions.navigation.slice(0, 10).map((action) => (
                  <CommandPaletteItem key={action.id} action={action} />
                ))}
                {groupedActions.navigation.length > 10 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground text-center">
                    + {groupedActions.navigation.length - 10} more steps...
                  </div>
                )}
              </CommandGroup>
            </>
          )}

          {/* Add Step */}
          {groupedActions["add-step"].length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading={categoryLabels["add-step"]}>
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

// Individual command item
function CommandPaletteItem({ action }: { action: CommandAction }) {
  const Icon = action.icon;

  return (
    <CommandItem
      value={action.id}
      onSelect={action.onSelect}
      disabled={action.disabled}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer"
    >
      <Icon className={`h-4 w-4 flex-shrink-0 ${action.iconColor ?? "text-muted-foreground"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate">{action.label}</span>
        </div>
        {action.description && (
          <p className="text-xs text-muted-foreground truncate">{action.description}</p>
        )}
      </div>
      {action.shortcut && (
        <kbd className="ml-auto text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {action.shortcut}
        </kbd>
      )}
    </CommandItem>
  );
}

export default CommandPalette;
