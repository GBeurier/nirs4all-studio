/**
 * CommandPalette pure read-model helpers.
 *
 * Everything in this module is framework-free (no JSX, no React state): it
 * turns pipeline state + handlers into the flat/filtered/grouped command
 * read-models the component renders. Compartmentalised so the construction of
 * commands stays separate from the rendering of groups/items, ready for future
 * backend-aware palettes (dag-ml operators, compute options, WASM).
 */

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
  Copy,
  Trash2,
  Settings,
  ArrowUp,
  ArrowDown,
  Repeat,
  Layers,
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
import type { LegacyStepType, StepOption, StepType, PipelineStep } from "./types";
import type {
  CommandAction,
  CommandCategory,
  FlattenedStep,
} from "./commandPalette.types";

/** Icon mapping for step types. */
export const stepTypeIcons: Record<LegacyStepType, LucideIcon> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  flow: GitBranch,
  utility: Sparkles,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  sequential: Layers,
  chart: LineChart,
  comment: MessageSquare,
};

/** Color classes for step types. */
export const stepTypeColors: Record<LegacyStepType, string> = {
  preprocessing: "text-blue-500",
  y_processing: "text-amber-500",
  splitting: "text-purple-500",
  model: "text-emerald-500",
  flow: "text-cyan-500",
  utility: "text-orange-500",
  generator: "text-orange-500",
  branch: "text-cyan-500",
  merge: "text-pink-500",
  filter: "text-rose-500",
  augmentation: "text-indigo-500",
  sample_augmentation: "text-violet-500",
  feature_augmentation: "text-fuchsia-500",
  sample_filter: "text-red-500",
  concat_transform: "text-teal-500",
  sequential: "text-slate-500",
  chart: "text-sky-500",
  comment: "text-gray-500",
};

/** Human-readable headings per command category. */
export const categoryLabels: Record<CommandCategory, string> = {
  step: "Selected Step",
  navigation: "Go to Step",
  pipeline: "Pipeline",
  action: "Actions",
  "add-step": "Add Step",
};

/** Label used for a generated/branch child when flattening for navigation. */
function branchLabel(step: PipelineStep, index: number): string {
  if (step.generatorKind === "cartesian") return `Stage ${index + 1}`;
  if (step.generatorKind === "grid" || step.generatorKind === "zip") return `Param ${index + 1}`;
  if (step.generatorKind === "chain") return `Config ${index + 1}`;
  if (step.subType === "generator") return `Option ${index + 1}`;
  return `Branch ${index + 1}`;
}

/** Flatten the (possibly nested) step tree into navigation entries. */
export function flattenSteps(steps: PipelineStep[]): FlattenedStep[] {
  const result: FlattenedStep[] = [];

  function flatten(stepList: PipelineStep[], pathPrefix: string = "") {
    for (const step of stepList) {
      const path = pathPrefix ? `${pathPrefix} → ${step.name}` : step.name;
      result.push({ step, path });

      if (step.branches) {
        for (let i = 0; i < step.branches.length; i++) {
          flatten(step.branches[i], `${path} → ${branchLabel(step, i)}`);
        }
      }
    }
  }

  flatten(steps);
  return result;
}

/** Resolve the currently-selected step from the flattened list. */
export function findSelectedStep(
  flattenedSteps: FlattenedStep[],
  selectedStepId: string | null,
): PipelineStep | null {
  if (!selectedStepId) return null;
  return flattenedSteps.find(({ step }) => step.id === selectedStepId)?.step ?? null;
}

/** Filter commands by a free-text query against label/description/keywords. */
export function filterCommandActions(
  actions: CommandAction[],
  searchQuery: string,
): CommandAction[] {
  if (!searchQuery.trim()) return actions;

  const query = searchQuery.toLowerCase();
  return actions.filter((action) => {
    const searchableText = [
      action.label,
      action.description ?? "",
      ...(action.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(query);
  });
}

/** Bucket commands into their categories, preserving insertion order. */
export function groupCommandActions(
  actions: CommandAction[],
): Record<CommandCategory, CommandAction[]> {
  const groups: Record<CommandCategory, CommandAction[]> = {
    step: [],
    navigation: [],
    pipeline: [],
    action: [],
    "add-step": [],
  };

  for (const action of actions) {
    groups[action.category].push(action);
  }

  return groups;
}

/** Step types offered for quick "Add Step" commands. */
const QUICK_ADD_TYPES: StepType[] = ["preprocessing", "model", "splitting"];

/** Max quick-add options surfaced per step type. */
const QUICK_ADD_OPTIONS_PER_TYPE = 3;

/** Handlers the command builder wires into each command's onSelect. */
export interface CommandActionHandlers {
  onAddStep: (type: StepType, option: StepOption) => void;
  onSelectStep: (id: string) => void;
  onDuplicateStep?: (id: string) => void;
  onRemoveStep?: (id: string) => void;
  onMoveStep?: (id: string, direction: "up" | "down") => void;
  onSave?: () => void;
  onRun?: () => void;
  onExport?: () => void;
  onToggleFavorite?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenShortcutsHelp?: () => void;
  onFocusPanel?: (panel: "palette" | "tree" | "config") => void;
  onOpenChange: (open: boolean) => void;
}

/** Inputs needed to build the full command list (pure state + handlers). */
export interface BuildCommandActionsParams {
  steps: PipelineStep[];
  flattenedSteps: FlattenedStep[];
  selectedStep: PipelineStep | null;
  selectedStepId: string | null;
  getStepOptions: (type: StepType) => StepOption[];
  handlers: CommandActionHandlers;
}

/**
 * Build the full, ordered command list from pipeline state + handlers.
 *
 * Order is meaningful: groupCommandActions preserves it within each category,
 * and the renderer relies on it for the navigation truncation.
 */
export function buildCommandActions({
  steps,
  flattenedSteps,
  selectedStep,
  selectedStepId,
  getStepOptions,
  handlers,
}: BuildCommandActionsParams): CommandAction[] {
  const {
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
  } = handlers;

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
      const stepIndex = steps.findIndex((s) => s.id === selectedStepId);
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
      ([_, v]) => typeof v === "number",
    );
    if (numericParams.length > 0) {
      const hasSweeps =
        selectedStep.paramSweeps && Object.keys(selectedStep.paramSweeps).length > 0;
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
  for (const type of QUICK_ADD_TYPES) {
    const options = getStepOptions(type);
    for (const option of options.slice(0, QUICK_ADD_OPTIONS_PER_TYPE)) {
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
}
