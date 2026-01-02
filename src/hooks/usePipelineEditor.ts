import { useState, useCallback, useEffect, useMemo } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { PipelineStep, StepType, StepOption } from "../components/pipeline-editor/types";

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
  removeStep: (id: string) => void;
  duplicateStep: (id: string) => void;
  moveStep: (id: string, direction: "up" | "down") => void;
  reorderSteps: (activeId: string, overId: string) => void;
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Pipeline
  getSelectedStep: () => PipelineStep | null;
  clearPipeline: () => void;
  loadPipeline: (steps: PipelineStep[], name?: string) => void;
  exportPipeline: () => { name: string; steps: PipelineStep[] };
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

  const stepCounts = useMemo(() => ({
    preprocessing: steps.filter((s) => s.type === "preprocessing").length,
    splitting: steps.filter((s) => s.type === "splitting").length,
    model: steps.filter((s) => s.type === "model").length,
    metrics: steps.filter((s) => s.type === "metrics").length,
    branch: steps.filter((s) => s.type === "branch").length,
    merge: steps.filter((s) => s.type === "merge").length,
  }), [steps]);

  const totalSteps = steps.length;

  // Push to history
  const pushToHistory = useCallback(
    (newSteps: PipelineStep[]) => {
      setHistory((prev) => {
        // Remove any future history when making a new change
        const newHistory = prev.slice(0, historyIndex + 1);
        newHistory.push(newSteps);
        // Limit history size
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

  // Add step
  const addStep = useCallback(
    (type: StepType, option: StepOption) => {
      const newStep: PipelineStep = {
        id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type,
        name: option.name,
        params: { ...option.defaultParams },
        branches: option.defaultBranches ? JSON.parse(JSON.stringify(option.defaultBranches)) : undefined,
      };
      const newSteps = [...steps, newStep];
      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory]
  );

  // Remove step
  const removeStep = useCallback(
    (id: string) => {
      const newSteps = steps.filter((s) => s.id !== id);
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
    (id: string) => {
      const stepIndex = steps.findIndex((s) => s.id === id);
      if (stepIndex === -1) return;

      const step = steps[stepIndex];
      const newStep: PipelineStep = {
        ...step,
        id: `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        params: { ...step.params },
      };

      const newSteps = [
        ...steps.slice(0, stepIndex + 1),
        newStep,
        ...steps.slice(stepIndex + 1),
      ];
      setSteps(newSteps);
      pushToHistory(newSteps);
      setSelectedStepId(newStep.id);
    },
    [steps, pushToHistory]
  );

  // Move step up/down
  const moveStep = useCallback(
    (id: string, direction: "up" | "down") => {
      const oldIndex = steps.findIndex((s) => s.id === id);
      if (oldIndex === -1) return;

      const newIndex = direction === "up" ? oldIndex - 1 : oldIndex + 1;
      if (newIndex < 0 || newIndex >= steps.length) return;

      const newSteps = arrayMove(steps, oldIndex, newIndex);
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Reorder steps (drag and drop)
  const reorderSteps = useCallback(
    (activeId: string, overId: string) => {
      if (activeId === overId) return;

      const oldIndex = steps.findIndex((s) => s.id === activeId);
      const newIndex = steps.findIndex((s) => s.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const newSteps = arrayMove(steps, oldIndex, newIndex);
        setSteps(newSteps);
        pushToHistory(newSteps);
      }
    },
    [steps, pushToHistory]
  );

  // Update step
  const updateStep = useCallback(
    (id: string, updates: Partial<PipelineStep>) => {
      const newSteps = steps.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      );
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Get selected step
  const getSelectedStep = useCallback(
    () => steps.find((s) => s.id === selectedStepId) || null,
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
      steps: steps.map((s) => ({ ...s })),
    }),
    [pipelineName, steps]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea
      const activeElement = document.activeElement;
      if (
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Undo: Ctrl+Z
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.key === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }

      // Delete selected step: Delete or Backspace
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStepId) {
        e.preventDefault();
        removeStep(selectedStepId);
      }

      // Escape to deselect
      if (e.key === "Escape") {
        setSelectedStepId(null);
      }

      // D to duplicate selected step
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
    removeStep,
    duplicateStep,
    moveStep,
    reorderSteps,
    updateStep,

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
