import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type {
  PipelineStep,
  StepType,
  StepOption,
  DragData,
  DropIndicator
} from "../components/pipeline-editor/types";
import { createStepFromOption, cloneStep } from "../components/pipeline-editor/types";
import { importFromNirs4all, exportToNirs4all as exportToNirs4allFormat } from "../utils/pipelineConverter";

// Storage key for persisting pipeline editor state
const STORAGE_KEY_PREFIX = "nirs4all_pipeline_editor_";

// Pipeline-level configuration
export interface PipelineConfig {
  /** Global random seed for reproducibility */
  seed?: number;
  /** Verbose level for training output */
  verbose?: number;
  /** Export model after training */
  exportModel?: boolean;
}

interface PersistedPipelineState {
  steps: PipelineStep[];
  pipelineName: string;
  isFavorite: boolean;
  lastModified: number;
  config?: PipelineConfig;
}

function getPersistenceKey(pipelineId: string): string {
  return `${STORAGE_KEY_PREFIX}${pipelineId}`;
}

function loadPersistedState(pipelineId: string): PersistedPipelineState | null {
  try {
    const key = getPersistenceKey(pipelineId);
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn("Failed to load persisted pipeline state:", e);
  }
  return null;
}

function savePersistedState(pipelineId: string, state: PersistedPipelineState): void {
  try {
    const key = getPersistenceKey(pipelineId);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (e) {
    console.warn("Failed to persist pipeline state:", e);
  }
}

function clearPersistedState(pipelineId: string): void {
  try {
    const key = getPersistenceKey(pipelineId);
    localStorage.removeItem(key);
  } catch (e) {
    console.warn("Failed to clear persisted pipeline state:", e);
  }
}

interface UsePipelineEditorOptions {
  initialSteps?: PipelineStep[];
  initialName?: string;
  initialConfig?: PipelineConfig;
  maxHistorySize?: number;
  pipelineId?: string; // Unique ID for persistence
  persistState?: boolean; // Enable/disable persistence (default: true)
}

interface UsePipelineEditorReturn {
  // State
  steps: PipelineStep[];
  pipelineName: string;
  pipelineConfig: PipelineConfig;
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
  setPipelineConfig: (config: Partial<PipelineConfig>) => void;
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
  addBranch: (stepId: string, path?: string[]) => void;
  removeBranch: (stepId: string, branchIndex: number, path?: string[]) => void;

  // Container children operations (for sample_augmentation, feature_augmentation, etc.)
  addChild: (stepId: string, path?: string[]) => void;
  removeChild: (stepId: string, childId: string, path?: string[]) => void;
  updateChild: (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => void;

  // DnD handlers
  handleDrop: (data: DragData, indicator: DropIndicator) => void;
  handleReorder: (activeId: string, overId: string, data: DragData) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Pipeline
  getSelectedStep: () => PipelineStep | null;
  clearPipeline: () => void;
  loadPipeline: (steps: PipelineStep[], name?: string, config?: PipelineConfig) => void;
  exportPipeline: () => { name: string; steps: PipelineStep[]; config: PipelineConfig };

  // nirs4all format
  loadFromNirs4all: (pipeline: unknown) => void;
  exportToNirs4all: () => unknown[];

  // Persistence
  clearPersistedData: () => void;
}

// Helper to find step by path (supports branches and children)
function getStepsAtPath(steps: PipelineStep[], path: string[]): PipelineStep[] {
  if (path.length === 0) return steps;

  const [stepId, type, ...rest] = path;
  const step = steps.find(s => s.id === stepId);

  if (!step) return [];

  if (type === "branch" && step.branches) {
    const [indexStr, ...branchRest] = rest;
    const branchIndex = parseInt(indexStr, 10);
    if (branchIndex >= 0 && branchIndex < step.branches.length) {
      return getStepsAtPath(step.branches[branchIndex], branchRest);
    }
  }

  if (type === "children" && step.children) {
    return getStepsAtPath(step.children, rest);
  }

  return [];
}

// Container step types that use children (not branches)
const CHILDREN_CONTAINER_TYPES: StepType[] = [
  "sample_augmentation",
  "feature_augmentation",
  "sample_filter",
  "concat_transform",
];

// Helper to update steps at a specific path (supports branches and children)
function updateStepsAtPath(
  steps: PipelineStep[],
  path: string[],
  updater: (steps: PipelineStep[]) => PipelineStep[]
): PipelineStep[] {
  if (path.length === 0) {
    return updater(steps);
  }

  const [stepId, type, ...rest] = path;

  return steps.map(step => {
    if (step.id !== stepId) return step;

    if (type === "branch" && step.branches) {
      const [indexStr, ...branchRest] = rest;
      const branchIndex = parseInt(indexStr, 10);
      return {
        ...step,
        branches: step.branches.map((branch, idx) =>
          idx === branchIndex
            ? updateStepsAtPath(branch, branchRest, updater)
            : branch
        ),
      };
    }

    if (type === "children") {
      // For children, we update the children array directly
      // Initialize children array if it doesn't exist for container types
      const currentChildren = step.children ?? (CHILDREN_CONTAINER_TYPES.includes(step.type) ? [] : undefined);
      if (currentChildren !== undefined) {
        return {
          ...step,
          children: updateStepsAtPath(currentChildren, rest, updater),
        };
      }
    }

    return step;
  });
}

// Count steps recursively
function countStepsRecursive(steps: PipelineStep[]): Record<StepType, number> {
  const counts: Record<StepType, number> = {
    preprocessing: 0,
    y_processing: 0,
    splitting: 0,
    model: 0,
    generator: 0,
    branch: 0,
    merge: 0,
    filter: 0,
    augmentation: 0,
    sample_augmentation: 0,
    feature_augmentation: 0,
    sample_filter: 0,
    concat_transform: 0,
    sequential: 0,
    chart: 0,
    comment: 0,
  };

  for (const step of steps) {
    if (counts[step.type] !== undefined) {
      counts[step.type]++;
    }
    if (step.branches) {
      for (const branch of step.branches) {
        const branchCounts = countStepsRecursive(branch);
        for (const type of Object.keys(branchCounts) as StepType[]) {
          counts[type] += branchCounts[type];
        }
      }
    }
    // Also count children for container steps
    if (step.children) {
      const childCounts = countStepsRecursive(step.children);
      for (const type of Object.keys(childCounts) as StepType[]) {
        counts[type] += childCounts[type];
      }
    }
  }

  return counts;
}

// Find step by ID recursively (including children of container steps)
function findStepById(steps: PipelineStep[], id: string): PipelineStep | null {
  for (const step of steps) {
    if (step.id === id) return step;
    // Search in branches
    if (step.branches) {
      for (const branch of step.branches) {
        const found = findStepById(branch, id);
        if (found) return found;
      }
    }
    // Search in children (for container steps like sample_augmentation, feature_augmentation, etc.)
    if (step.children) {
      const found = findStepById(step.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Remove step by ID recursively (including from children)
function removeStepById(steps: PipelineStep[], id: string): PipelineStep[] {
  return steps
    .filter(step => step.id !== id)
    .map(step => ({
      ...step,
      branches: step.branches?.map(branch => removeStepById(branch, id)),
      children: step.children ? removeStepById(step.children, id) : undefined,
    }));
}

export function usePipelineEditor(
  options: UsePipelineEditorOptions = {}
): UsePipelineEditorReturn {
  const {
    initialSteps = [],
    initialName = "New Pipeline",
    initialConfig = {},
    maxHistorySize = 50,
    pipelineId = "default",
    persistState = true,
  } = options;

  // Load persisted state on initial render
  const persistedState = useMemo(() => {
    if (!persistState) return null;
    return loadPersistedState(pipelineId);
  }, [pipelineId, persistState]);

  // Determine initial values (prefer persisted over provided)
  const resolvedInitialSteps = persistedState?.steps ?? initialSteps;
  const resolvedInitialName = persistedState?.pipelineName ?? initialName;
  const resolvedInitialFavorite = persistedState?.isFavorite ?? false;
  const resolvedInitialConfig = persistedState?.config ?? initialConfig;

  // Core state
  const [steps, setSteps] = useState<PipelineStep[]>(resolvedInitialSteps);
  const [pipelineName, setPipelineNameState] = useState(resolvedInitialName);
  const [pipelineConfig, setPipelineConfigState] = useState<PipelineConfig>(resolvedInitialConfig);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isFavorite, setIsFavoriteState] = useState(resolvedInitialFavorite);
  const [isDirty, setIsDirty] = useState(false);

  // History state
  const [history, setHistory] = useState<PipelineStep[][]>([resolvedInitialSteps]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Track if this is the initial mount to avoid saving on load
  const isInitialMount = useRef(true);

  // Persist state whenever it changes
  useEffect(() => {
    if (!persistState) return;

    // Skip saving on initial mount to avoid overwriting with potentially stale data
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const state: PersistedPipelineState = {
      steps,
      pipelineName,
      isFavorite,
      lastModified: Date.now(),
      config: pipelineConfig,
    };
    savePersistedState(pipelineId, state);
  }, [steps, pipelineName, isFavorite, pipelineConfig, pipelineId, persistState]);

  // Wrapper for setPipelineName that also persists
  const setPipelineName = useCallback((name: string) => {
    setPipelineNameState(name);
    setIsDirty(true);
  }, []);

  // Wrapper for setIsFavorite that also persists
  const setIsFavorite = useCallback((favorite: boolean) => {
    setIsFavoriteState(favorite);
  }, []);

  // Wrapper for setPipelineConfig
  const setPipelineConfig = useCallback((config: PipelineConfig) => {
    setPipelineConfigState(config);
    setIsDirty(true);
  }, []);

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

  // Update step properties (recursively searches in branches and children)
  const updateStep = useCallback(
    (id: string, updates: Partial<PipelineStep>) => {
      const updateRecursive = (stepsArray: PipelineStep[]): PipelineStep[] => {
        return stepsArray.map(s => {
          if (s.id === id) {
            return { ...s, ...updates };
          }
          let updated = s;
          if (s.branches) {
            updated = {
              ...updated,
              branches: s.branches.map(branch => updateRecursive(branch)),
            };
          }
          if (s.children) {
            updated = {
              ...updated,
              children: updateRecursive(s.children),
            };
          }
          return updated;
        });
      };

      const newSteps = updateRecursive(steps);
      setSteps(newSteps);
      pushToHistory(newSteps);
    },
    [steps, pushToHistory]
  );

  // Add a new branch to a branch step (supports nested paths)
  const addBranch = useCallback(
    (stepId: string, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          // Support both branch and generator step types (both have branches)
          if (s.id === stepId && (s.type === "branch" || s.type === "generator") && s.branches) {
            return {
              ...s,
              branches: [...s.branches, []],
              // Also add branch metadata for new branch
              branchMetadata: [...(s.branchMetadata || []), {}],
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

  // Remove a branch from a branch or generator step
  const removeBranch = useCallback(
    (stepId: string, branchIndex: number, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          // Support both branch and generator step types (both have branches)
          if (s.id === stepId && (s.type === "branch" || s.type === "generator") && s.branches && s.branches.length > 1) {
            return {
              ...s,
              branches: s.branches.filter((_, idx) => idx !== branchIndex),
              // Also update branch metadata if present
              branchMetadata: s.branchMetadata?.filter((_, idx) => idx !== branchIndex),
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

  // Add a child to a container step (sample_augmentation, feature_augmentation, etc.)
  const addChild = useCallback(
    (stepId: string, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          if (s.id === stepId) {
            // Determine child type based on container type
            const childType = s.type === "sample_filter" ? "filter" : "preprocessing";
            const newChild: PipelineStep = {
              id: `child-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: childType,
              name: childType === "filter" ? "ThresholdFilter" : "SNV",
              params: {},
            };
            return {
              ...s,
              children: [...(s.children || []), newChild],
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

  // Remove a child from a container step
  const removeChild = useCallback(
    (stepId: string, childId: string, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          if (s.id === stepId && s.children) {
            return {
              ...s,
              children: s.children.filter((c) => c.id !== childId),
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

  // Update a child in a container step
  const updateChild = useCallback(
    (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => {
      const newSteps = updateStepsAtPath(steps, path || [], (targetSteps) =>
        targetSteps.map((s) => {
          if (s.id === stepId && s.children) {
            return {
              ...s,
              children: s.children.map((c) =>
                c.id === childId ? { ...c, ...updates } : c
              ),
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
    [setPipelineName]
  );

  // Export pipeline
  const exportPipeline = useCallback(
    () => ({
      name: pipelineName,
      steps: JSON.parse(JSON.stringify(steps)),
      config: pipelineConfig,
    }),
    [pipelineName, steps, pipelineConfig]
  );

  // Load from nirs4all canonical format
  const loadFromNirs4all = useCallback(
    (pipeline: unknown) => {
      try {
        // Handle both pipeline object and array
        const pipelineData = Array.isArray(pipeline)
          ? { pipeline }
          : pipeline as { name?: string; description?: string; pipeline: unknown[] };

        const newSteps = importFromNirs4all(pipelineData as Parameters<typeof importFromNirs4all>[0]);
        setSteps(newSteps);
        setHistory([newSteps]);
        setHistoryIndex(0);
        setSelectedStepId(null);
        setIsDirty(false);

        if ('name' in pipelineData && pipelineData.name) {
          setPipelineName(pipelineData.name);
        }
      } catch (e) {
        console.error("Failed to load nirs4all pipeline:", e);
        throw e;
      }
    },
    [setPipelineName]
  );

  // Export to nirs4all canonical format
  const exportToNirs4all = useCallback(
    () => {
      const result = exportToNirs4allFormat(steps);
      return Array.isArray(result) ? result : result.pipeline;
    },
    [steps]
  );

  // Clear persisted data
  const clearPersistedData = useCallback(() => {
    if (persistState) {
      clearPersistedState(pipelineId);
    }
  }, [pipelineId, persistState]);

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
    pipelineConfig,
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
    setPipelineConfig,
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

    // Container children operations
    addChild,
    removeChild,
    updateChild,

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

    // nirs4all format
    loadFromNirs4all,
    exportToNirs4all,

    // Persistence
    clearPersistedData,
  };
}
