import { useState, useCallback, useEffect, useMemo } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  PipelineStep,
  StepType,
  StepOption,
  DragData,
  DropIndicator
} from "../components/pipeline-editor/types";
import { createStepFromOption, cloneStep } from "../components/pipeline-editor/types";

interface UsePipelineEditorOptions {
  initialSteps?: PipelineStep[];
  initialName?: string;
  maxHistorySize?: number;
}

interface UsePipelineEditorReturn {
  // State
  steps: PipelineStep[];
  pipelineName: string;
  selectedStepId: string | null;
  isFavorite: boolean;
  isDirty: boolean;

  // History
  canUndo: boolean;
  canRedo: boolean;

  // Step counts
  stepCounts: Record<StepType, number>;
  totalSteps: number;

  // Actions
  setPipelineName: (name: string) => void;
  setSelectedStepId: (id: string | null) => void;
  setIsFavorite: (favorite: boolean) => void;

  // Step operations
  addStep: (type: StepType, option: StepOption) => void;
  addStepAtPath: (type: StepType, option: StepOption, path: string[], index: number) => void;
  removeStep: (id: string, path?: string[]) => void;
  duplicateStep: (id: string, path?: string[]) => void;
  moveStep: (id: string, direction: "up" | "down", path?: string[]) => void;
  reorderSteps: (activeId: string, overId: string) => void;
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;

  // Branch operations
  addBranch: (stepId: string) => void;
  removeBranch: (stepId: string, branchIndex: number) => void;

  // DnD handlers
  handleDrop: (data: DragData, indicator: DropIndicator) => void;
  handleReorder: (activeId: string, overId: string, data: DragData) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Pipeline
  getSelectedStep: () => PipelineStep | null;
  clearPipeline: () => void;
  loadPipeline: (steps: PipelineStep[], name?: string) => void;
  exportPipeline: () => { name: string; steps: PipelineStep[] };
}

// Helper to find step by path
function getStepsAtPath(steps: PipelineStep[], path: string[]): PipelineStep[] {
  if (path.length === 0) return steps;

  const [stepId, type, indexStr, ...rest] = path;
  const step = steps.find(s => s.id === stepId);

  if (!step) return [];
  if (type === "branch" && step.branches) {
    const branchIndex = parseInt(indexStr, 10);
    if (branchIndex >= 0 && branchIndex < step.branches.length) {
      return getStepsAtPath(step.branches[branchIndex], rest);
    }
  }
  return [];
}

// Helper to update steps at a specific path
function updateStepsAtPath(
  steps: PipelineStep[],
  path: string[],
  updater: (steps: PipelineStep[]) => PipelineStep[]
): PipelineStep[] {
  if (path.length === 0) {
    return updater(steps);
  }

  const [stepId, type, indexStr, ...rest] = path;

  return steps.map(step => {
    if (step.id !== stepId) return step;

    if (type === "branch" && step.branches) {
      const branchIndex = parseInt(indexStr, 10);
      return {
        ...step,
        branches: step.branches.map((branch, idx) =>
          idx === branchIndex
            ? updateStepsAtPath(branch, rest, updater)
            : branch
        ),
      };
    }
    return step;
  });
}

// Count steps recursively
function countStepsRecursive(steps: PipelineStep[]): Record<StepType, number> {
  const counts: Record<StepType, number> = {
    preprocessing: 0,
    splitting: 0,
    model: 0,
    metrics: 0,
    branch: 0,
    merge: 0,
  };

  for (const step of steps) {
    counts[step.type]++;
    if (step.branches) {
      for (const branch of step.branches) {
        const branchCounts = countStepsRecursive(branch);
        for (const type of Object.keys(branchCounts) as StepType[]) {
          counts[type] += branchCounts[type];
        }
      }
    }
  }

  return counts;
}

// Find step by ID recursively
function findStepById(steps: PipelineStep[], id: string): PipelineStep | null {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.branches) {
      for (const branch of step.branches) {
        const found = findStepById(branch, id);
        if (found) return found;
      }
    }
  }
  return null;
}

// Remove step by ID recursively
function removeStepById(steps: PipelineStep[], id: string): PipelineStep[] {
  return steps
    .filter(step => step.id !== id)
    .map(step => ({
      ...step,
      branches: step.branches?.map(branch => removeStepById(branch, id)),
    }));
}

export function usePipelineEditor(
  options: UsePipelineEditorOptions = {}
): UsePipelineEditorReturn {
  const {
    initialSteps = [],
    initialName = "New Pipeline",
    maxHistorySize = 50,
  } = options;

  // Core state
  const [steps, setSteps] = useState<PipelineStep[]>(initialSteps);
  const [pipelineName, setPipelineName] = useState(initialName);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // History state
  const [history, setHistory] = useState<PipelineStep[][]>([initialSteps]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Computed values
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const stepCounts = useMemo(() => countStepsRecursive(steps), [steps]);

  const totalSteps = useMemo(() => {
    return Object.values(stepCounts).reduce((a, b) => a + b, 0);
  }, [stepCounts]);

  // Push to history
  const pushToHistory = useCallback(
    (newSteps: PipelineStep[]) => {
      setHistory((prev) => {
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(newSteps);
        if (newHistory.length > maxHistorySize) {
          newHistory.shift();
          return newHistory;
        }
        return newHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, maxHistorySize - 1));
      setIsDirty(true);
    },
    [historyIndex, maxHistorySize]
  );

  // Undo
  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setSteps(history[newIndex]);
    }
  }, [history, historyIndex]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setSteps(history[newIndex]);
    }
  }, [history, historyIndex]);

  // Add step to root
  const addStep = useCallback(
    (type: StepType, option: StepOption) => {
      const newStep = createStepFromOption(type, option);
      const newSteps = [...steps, newStep];
      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory]
  );

  // Add step at a specific path and index
  const addStepAtPath = useCallback(
    (type: StepType, option: StepOption, path: string[], index: number) => {
      const newStep = createStepFromOption(type, option);

      const newSteps = updateStepsAtPath(steps, path, (targetSteps) => {
        const result = [...targetSteps];
        result.splice(index, 0, newStep);
        return result;
      });

      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory]
  );

  // Remove step (with optional path for nested steps)
  const removeStep = useCallback(
    (id: string, path?: string[]) => {
      let newSteps: PipelineStep[];

      if (path && path.length > 0) {
        newSteps = updateStepsAtPath(steps, path, (targetSteps) =>
          targetSteps.filter(s => s.id !== id)
        );
      } else {
        // Remove from root, but also check nested
        newSteps = removeStepById(steps, id);
      }

      setSteps(newSteps);
      pushToHistory(newSteps);
      if (selectedStepId === id) {
        setSelectedStepId(null);
      }
    },
    [steps, selectedStepId, pushToHistory]
  );

  // Duplicate step
  const duplicateStep = useCallback(
    (id: string, path?: string[]) => {
      const step = findStepById(steps, id);
      if (!step) return;

      const newStep = cloneStep(step);

      if (path && path.length > 0) {
        const newSteps = updateStepsAtPath(steps, path, (targetSteps) => {
          const idx = targetSteps.findIndex(s => s.id === id);
          if (idx === -1) return targetSteps;
          const result = [...targetSteps];
          result.splice(idx + 1, 0, newStep);
          return result;
        });
        setSteps(newSteps);
        pushToHistory(newSteps);
      } else {
        const stepIndex = steps.findIndex(s => s.id === id);
        if (stepIndex === -1) return;

        const newSteps = [
          ...steps.slice(0, stepIndex + 1),
          newStep,
          ...steps.slice(stepIndex + 1),
        ];
        setSteps(newSteps);
        pushToHistory(newSteps);
      }

      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory]
  );

  // Move step up/down
  const moveStep = useCallback(
    (id: string, direction: "up" | "down", path?: string[]) => {
      if (path && path.length > 0) {
        const newSteps = updateStepsAtPath(steps, path, (targetSteps) => {
          const oldIndex = targetSteps.findIndex(s => s.id === id);
          if (oldIndex === -1) return targetSteps;

          const newIndex = direction === "up" ? oldIndex - 1 : oldIndex + 1;
          if (newIndex < 0 || newIndex >= targetSteps.length) return targetSteps;

          return arrayMove(targetSteps, oldIndex, newIndex);
        });
        setSteps(newSteps);
        pushToHistory(newSteps);
      } else {
        const oldIndex = steps.findIndex(s => s.id === id);
        if (oldIndex === -1) return;

        const newIndex = direction === "up" ? oldIndex - 1 : oldIndex + 1;
        if (newIndex < 0 || newIndex >= steps.length) return;

        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory]
  );

  // Reorder steps (simple case - same level)
  const reorderSteps = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;

      const oldIndex = steps.findIndex(s => s.id === activeId);
      const newIndex = steps.findIndex(s => s.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory]
  );

  // Update step properties
  const updateStep = useCallback(
    (id: string, updates: Partial<PipelineStep>) => {
      const updateRecursive = (stepsArray: PipelineStep[]): PipelineStep[] => {
        return stepsArray.map(s => {
          if (s.id === id) {
            return { ...s, ...updates };
          }
          if (s.branches) {
            return {
              ...s,
              branches: s.branches.map(branch => updateRecursive(branch)),
            };
          }
          return s;
        });
      };

      const newSteps = updateRecursive(steps);
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Add a new branch to a branch step
  const addBranch = useCallback(
    (stepId: string) => {
      const newSteps = steps.map(s => {
        if (s.id === stepId && s.type === "branch" && s.branches) {
          return {
            ...s,
            branches: [...s.branches, []],
          };
        }
        return s;
      });
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Remove a branch from a branch step
  const removeBranch = useCallback(
    (stepId: string, branchIndex: number, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          if (s.id === stepId && s.type === "branch" && s.branches && s.branches.length > 1) {
            return {
              ...s,
              branches: s.branches.filter((_, idx) => idx !== branchIndex),
            };
          }
          return s;
        })
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Handle drop from palette or reorder
  const handleDrop = useCallback(
    (data: DragData, indicator: DropIndicator) => {
      if (data.type === "palette-item" && data.stepType && data.option) {
        addStepAtPath(data.stepType, data.option, indicator.path, indicator.index);
      } else if (data.type === "pipeline-step" && data.stepId && data.step) {
        // Moving an existing step
        const newStep = cloneStep(data.step);

        // First remove from old location
        let newSteps = removeStepById(steps, data.stepId);

        // Then add at new location
        newSteps = updateStepsAtPath(newSteps, indicator.path, (targetSteps) => {
          const result = [...targetSteps];
          result.splice(indicator.index, 0, { ...data.step!, id: data.stepId! });
          return result;
        });

        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory, addStepAtPath]
  );

  // Handle reorder within same level
  const handleReorder = useCallback(
    (activeId: string, overId: string, data: DragData) => {
      if (activeId === overId) return;

      // Simple case: both at root level
      const oldIndex = steps.findIndex(s => s.id === activeId);
      const newIndex = steps.findIndex(s => s.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory]
  );

  // Get selected step (recursive search)
  const getSelectedStep = useCallback(
    () => findStepById(steps, selectedStepId || ""),
    [steps, selectedStepId]
  );

  // Clear pipeline
  const clearPipeline = useCallback(() => {
    setSteps([]);
    pushToHistory([]);
    setSelectedStepId(null);
  }, [pushToHistory]);

  // Load pipeline
  const loadPipeline = useCallback(
    (newSteps: PipelineStep[], name?: string) => {
      setSteps(newSteps);
      setHistory([newSteps]);
      setHistoryIndex(0);
      setSelectedStepId(null);
      setIsDirty(false);
      if (name) setPipelineName(name);
    },
    []
  );

  // Export pipeline
  const exportPipeline = useCallback(
    () => ({
      name: pipelineName,
      steps: JSON.parse(JSON.stringify(steps)),
    }),
    [pipelineName, steps]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedStepId) {
        e.preventDefault();
        removeStep(selectedStepId);
      }

      if (e.key === "Escape") {
        setSelectedStepId(null);
      }

      if (e.key === "d" && (e.metaKey || e.ctrlKey) && selectedStepId) {
        e.preventDefault();
        duplicateStep(selectedStepId);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, selectedStepId, removeStep, duplicateStep]);

  return {
    // State
    steps,
    pipelineName,
    selectedStepId,
    isFavorite,
    isDirty,

    // History
    canUndo,
    canRedo,

    // Step counts
    stepCounts,
    totalSteps,

    // Actions
    setPipelineName,
    setSelectedStepId,
    setIsFavorite,

    // Step operations
    addStep,
    addStepAtPath,
    removeStep,
    duplicateStep,
    moveStep,
    reorderSteps,
    updateStep,

    // Branch operations
    addBranch,
    removeBranch,

    // DnD handlers
    handleDrop,
    handleReorder,

    // History
    undo,
    redo,

    // Pipeline
    getSelectedStep,
    clearPipeline,
    loadPipeline,
    exportPipeline,
  };
}
