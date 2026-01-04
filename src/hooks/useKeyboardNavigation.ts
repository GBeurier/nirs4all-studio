/**
 * useKeyboardNavigation Hook
 *
 * Provides comprehensive keyboard navigation for the Pipeline Editor:
 * - Arrow key navigation between steps (↑/↓)
 * - Navigation into/out of branches (←/→)
 * - Tab cycling between panels (Palette → Tree → Config)
 * - Quick actions via keyboard shortcuts
 *
 * Part of Phase 5: UX Polish
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PipelineStep } from "../components/pipeline-editor/types";

export type PanelFocus = "palette" | "tree" | "config";

export interface NavigationState {
  selectedStepId: string | null;
  focusedPanel: PanelFocus;
  isCommandPaletteOpen: boolean;
  isShortcutsHelpOpen: boolean;
}

export interface KeyboardNavigationOptions {
  steps: PipelineStep[];
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onDuplicateStep?: (id: string) => void;
  onRemoveStep?: (id: string) => void;
  onAddBranch?: (stepId: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  initialFocusedPanel?: PanelFocus;
}

export interface KeyboardNavigationReturn {
  // State
  focusedPanel: PanelFocus;
  isCommandPaletteOpen: boolean;
  isShortcutsHelpOpen: boolean;

  // Panel focus actions
  setFocusedPanel: (panel: PanelFocus) => void;
  focusNextPanel: () => void;
  focusPreviousPanel: () => void;

  // Step navigation
  navigateToPreviousStep: () => void;
  navigateToNextStep: () => void;
  navigateIntoStep: () => void;
  navigateOutOfStep: () => void;

  // Command palette
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Shortcuts help
  openShortcutsHelp: () => void;
  closeShortcutsHelp: () => void;
  toggleShortcutsHelp: () => void;

  // Ref for focus management
  panelRefs: {
    palette: React.RefObject<HTMLDivElement | null>;
    tree: React.RefObject<HTMLDivElement | null>;
    config: React.RefObject<HTMLDivElement | null>;
  };
}

// Flatten steps to get navigation order (including nested steps in branches)
function flattenSteps(steps: PipelineStep[], parentPath: string[] = []): { step: PipelineStep; path: string[] }[] {
  const result: { step: PipelineStep; path: string[] }[] = [];

  for (const step of steps) {
    const currentPath = [...parentPath, step.id];
    result.push({ step, path: currentPath });

    // Add nested steps from branches
    if (step.branches) {
      for (let branchIdx = 0; branchIdx < step.branches.length; branchIdx++) {
        const branchPath = [...currentPath, "branch", String(branchIdx)];
        const branchSteps = flattenSteps(step.branches[branchIdx], branchPath);
        result.push(...branchSteps);
      }
    }
  }

  return result;
}

// Find the parent step that contains a given step (for navigation out)
function findParentStep(steps: PipelineStep[], stepId: string): PipelineStep | null {
  for (const step of steps) {
    if (step.branches) {
      for (const branch of step.branches) {
        const foundInBranch = branch.find(s => s.id === stepId);
        if (foundInBranch) {
          return step;
        }
        // Recurse into nested branches
        const nestedParent = findParentStep(branch, stepId);
        if (nestedParent) {
          return nestedParent;
        }
      }
    }
  }
  return null;
}

// Find the first child step in a branch step
function getFirstChildStep(step: PipelineStep): PipelineStep | null {
  if (step.branches && step.branches.length > 0) {
    const firstBranch = step.branches[0];
    if (firstBranch.length > 0) {
      return firstBranch[0];
    }
  }
  return null;
}

const PANEL_ORDER: PanelFocus[] = ["palette", "tree", "config"];

export function useKeyboardNavigation(
  options: KeyboardNavigationOptions
): KeyboardNavigationReturn {
  const {
    steps,
    selectedStepId,
    onSelectStep,
    onDuplicateStep,
    onRemoveStep,
    onAddBranch,
    onUndo,
    onRedo,
    initialFocusedPanel = "tree",
  } = options;

  const [focusedPanel, setFocusedPanel] = useState<PanelFocus>(initialFocusedPanel);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);

  const paletteRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const configRef = useRef<HTMLDivElement>(null);

  const panelRefs = {
    palette: paletteRef,
    tree: treeRef,
    config: configRef,
  };

  // Flatten steps for sequential navigation
  const flattenedSteps = flattenSteps(steps);

  // Get current step index in flattened list
  const getCurrentStepIndex = useCallback(() => {
    if (!selectedStepId) return -1;
    return flattenedSteps.findIndex(({ step }) => step.id === selectedStepId);
  }, [selectedStepId, flattenedSteps]);

  // Panel focus actions
  const focusNextPanel = useCallback(() => {
    const currentIndex = PANEL_ORDER.indexOf(focusedPanel);
    const nextIndex = (currentIndex + 1) % PANEL_ORDER.length;
    const nextPanel = PANEL_ORDER[nextIndex];
    setFocusedPanel(nextPanel);

    // Focus the panel element
    const ref = panelRefs[nextPanel];
    if (ref.current) {
      ref.current.focus();
    }
  }, [focusedPanel, panelRefs]);

  const focusPreviousPanel = useCallback(() => {
    const currentIndex = PANEL_ORDER.indexOf(focusedPanel);
    const prevIndex = (currentIndex - 1 + PANEL_ORDER.length) % PANEL_ORDER.length;
    const prevPanel = PANEL_ORDER[prevIndex];
    setFocusedPanel(prevPanel);

    // Focus the panel element
    const ref = panelRefs[prevPanel];
    if (ref.current) {
      ref.current.focus();
    }
  }, [focusedPanel, panelRefs]);

  // Step navigation
  const navigateToPreviousStep = useCallback(() => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex > 0) {
      const prevStep = flattenedSteps[currentIndex - 1];
      onSelectStep(prevStep.step.id);
    } else if (currentIndex === -1 && flattenedSteps.length > 0) {
      // No selection, select last step
      const lastStep = flattenedSteps[flattenedSteps.length - 1];
      onSelectStep(lastStep.step.id);
    }
  }, [getCurrentStepIndex, flattenedSteps, onSelectStep]);

  const navigateToNextStep = useCallback(() => {
    const currentIndex = getCurrentStepIndex();
    if (currentIndex < flattenedSteps.length - 1) {
      const nextStep = flattenedSteps[currentIndex + 1];
      onSelectStep(nextStep.step.id);
    } else if (currentIndex === -1 && flattenedSteps.length > 0) {
      // No selection, select first step
      const firstStep = flattenedSteps[0];
      onSelectStep(firstStep.step.id);
    }
  }, [getCurrentStepIndex, flattenedSteps, onSelectStep]);

  // Navigate into a step (enter branch)
  const navigateIntoStep = useCallback(() => {
    if (!selectedStepId) return;

    const currentItem = flattenedSteps.find(({ step }) => step.id === selectedStepId);
    if (!currentItem) return;

    const { step } = currentItem;

    // If step has branches, navigate into first child
    if (step.type === "branch" || step.type === "generator") {
      const firstChild = getFirstChildStep(step);
      if (firstChild) {
        onSelectStep(firstChild.id);
      }
    }
  }, [selectedStepId, flattenedSteps, onSelectStep]);

  // Navigate out of a step (exit branch to parent)
  const navigateOutOfStep = useCallback(() => {
    if (!selectedStepId) return;

    const parent = findParentStep(steps, selectedStepId);
    if (parent) {
      onSelectStep(parent.id);
    }
  }, [selectedStepId, steps, onSelectStep]);

  // Command palette controls
  const openCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true);
  }, []);

  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false);
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(prev => !prev);
  }, []);

  // Shortcuts help controls
  const openShortcutsHelp = useCallback(() => {
    setIsShortcutsHelpOpen(true);
  }, []);

  const closeShortcutsHelp = useCallback(() => {
    setIsShortcutsHelpOpen(false);
  }, []);

  const toggleShortcutsHelp = useCallback(() => {
    setIsShortcutsHelpOpen(prev => !prev);
  }, []);

  // Global keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if inside input/textarea (unless it's a dialog/command palette)
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.getAttribute("role") === "textbox";

      // Allow Command Palette shortcut even in inputs
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      // Allow Shortcuts Help shortcut
      if ((e.metaKey || e.ctrlKey) && e.key === "?") {
        e.preventDefault();
        toggleShortcutsHelp();
        return;
      }

      // Skip other shortcuts if in input
      if (isInputFocused) return;

      // Command palette open - close on Escape
      if (isCommandPaletteOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeCommandPalette();
        }
        return;
      }

      // Shortcuts help open - close on Escape
      if (isShortcutsHelpOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          closeShortcutsHelp();
        }
        return;
      }

      // Navigation shortcuts
      switch (e.key) {
        // Arrow navigation for steps
        case "ArrowUp":
          if (focusedPanel === "tree") {
            e.preventDefault();
            navigateToPreviousStep();
          }
          break;

        case "ArrowDown":
          if (focusedPanel === "tree") {
            e.preventDefault();
            navigateToNextStep();
          }
          break;

        case "ArrowRight":
          if (focusedPanel === "tree" && selectedStepId) {
            e.preventDefault();
            navigateIntoStep();
          }
          break;

        case "ArrowLeft":
          if (focusedPanel === "tree" && selectedStepId) {
            e.preventDefault();
            navigateOutOfStep();
          }
          break;

        // Tab cycling between panels
        case "Tab":
          if (e.shiftKey) {
            e.preventDefault();
            focusPreviousPanel();
          } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            // Only cycle panels if no other modifiers
            // Allow default Tab behavior within forms
            const isInDialog = !!document.querySelector("[role='dialog']:focus-within");
            if (!isInDialog && focusedPanel !== "config") {
              // Don't override Tab in config panel (form navigation)
              e.preventDefault();
              focusNextPanel();
            }
          }
          break;

        // Escape to deselect
        case "Escape":
          if (selectedStepId) {
            e.preventDefault();
            onSelectStep(null);
          }
          break;

        // Enter to configure selected step (switch to config panel)
        case "Enter":
          if (focusedPanel === "tree" && selectedStepId) {
            e.preventDefault();
            setFocusedPanel("config");
            if (configRef.current) {
              configRef.current.focus();
            }
          }
          break;

        // Space to toggle step enabled/disabled (future feature)
        case " ":
          if (focusedPanel === "tree" && selectedStepId) {
            // Placeholder for toggle step enabled
            // Currently just prevents scroll
            e.preventDefault();
          }
          break;

        // Duplicate shortcut (Ctrl+D is handled in usePipelineEditor)
        case "d":
          if ((e.metaKey || e.ctrlKey) && selectedStepId && onDuplicateStep) {
            e.preventDefault();
            onDuplicateStep(selectedStepId);
          }
          break;

        // Add branch shortcut (Ctrl+B)
        case "b":
          if ((e.metaKey || e.ctrlKey) && selectedStepId && onAddBranch) {
            e.preventDefault();
            onAddBranch(selectedStepId);
          }
          break;

        // Undo/Redo (these are also in usePipelineEditor but we expose them here for command palette)
        case "z":
          if ((e.metaKey || e.ctrlKey) && !e.shiftKey && onUndo) {
            e.preventDefault();
            onUndo();
          } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && onRedo) {
            e.preventDefault();
            onRedo();
          }
          break;

        case "y":
          if ((e.metaKey || e.ctrlKey) && onRedo) {
            e.preventDefault();
            onRedo();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedPanel,
    isCommandPaletteOpen,
    isShortcutsHelpOpen,
    selectedStepId,
    navigateToPreviousStep,
    navigateToNextStep,
    navigateIntoStep,
    navigateOutOfStep,
    focusNextPanel,
    focusPreviousPanel,
    toggleCommandPalette,
    toggleShortcutsHelp,
    closeCommandPalette,
    closeShortcutsHelp,
    onSelectStep,
    onDuplicateStep,
    onAddBranch,
    onUndo,
    onRedo,
  ]);

  return {
    // State
    focusedPanel,
    isCommandPaletteOpen,
    isShortcutsHelpOpen,

    // Panel focus actions
    setFocusedPanel,
    focusNextPanel,
    focusPreviousPanel,

    // Step navigation
    navigateToPreviousStep,
    navigateToNextStep,
    navigateIntoStep,
    navigateOutOfStep,

    // Command palette
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,

    // Shortcuts help
    openShortcutsHelp,
    closeShortcutsHelp,
    toggleShortcutsHelp,

    // Refs
    panelRefs,
  };
}

// Keyboard shortcut definitions for display
export interface KeyboardShortcut {
  key: string;
  modifiers?: ("ctrl" | "meta" | "shift" | "alt")[];
  description: string;
  category: "navigation" | "editing" | "actions" | "panels";
}

export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  // Navigation
  { key: "↑", description: "Select previous step", category: "navigation" },
  { key: "↓", description: "Select next step", category: "navigation" },
  { key: "→", description: "Navigate into branch", category: "navigation" },
  { key: "←", description: "Navigate out of branch", category: "navigation" },
  { key: "Enter", description: "Configure selected step", category: "navigation" },
  { key: "Escape", description: "Deselect / Close dialogs", category: "navigation" },

  // Panels
  { key: "Tab", description: "Cycle to next panel", category: "panels" },
  { key: "Tab", modifiers: ["shift"], description: "Cycle to previous panel", category: "panels" },
  { key: "K", modifiers: ["ctrl"], description: "Open command palette", category: "panels" },
  { key: "?", modifiers: ["ctrl"], description: "Show keyboard shortcuts", category: "panels" },

  // Editing
  { key: "D", modifiers: ["ctrl"], description: "Duplicate selected step", category: "editing" },
  { key: "Delete", description: "Delete selected step", category: "editing" },
  { key: "Backspace", description: "Delete selected step", category: "editing" },
  { key: "B", modifiers: ["ctrl"], description: "Add branch to selected step", category: "editing" },

  // Actions
  { key: "Z", modifiers: ["ctrl"], description: "Undo", category: "actions" },
  { key: "Z", modifiers: ["ctrl", "shift"], description: "Redo", category: "actions" },
  { key: "Y", modifiers: ["ctrl"], description: "Redo", category: "actions" },
  { key: "S", modifiers: ["ctrl"], description: "Save pipeline", category: "actions" },
];

// Format shortcut for display
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.modifiers?.includes("ctrl")) {
    parts.push("⌘/Ctrl");
  }
  if (shortcut.modifiers?.includes("shift")) {
    parts.push("⇧");
  }
  if (shortcut.modifiers?.includes("alt")) {
    parts.push("⌥/Alt");
  }

  parts.push(shortcut.key);

  return parts.join(" + ");
}
