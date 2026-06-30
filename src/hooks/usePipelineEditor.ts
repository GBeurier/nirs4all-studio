import { useState, useCallback, useMemo } from "react";
import type {
  PipelineStep,
  LegacyStepType,
  StepType,
  StepOption,
  DragData,
  DropIndicator
} from "../components/pipeline-editor/types";
import { migrateStep } from "../components/pipeline-editor/types";
import { exportToNirs4all as exportToNirs4allFormat } from "../utils/pipelineCanonicalConversion";
import { hydrateEditorPipelineSteps } from "../utils/pipelineEditorHydration";
import {
  countPipelineStepsRecursive,
  findPipelineStepById,
} from "@/lib/pipelineGraphReducer";
import {
  legacyStepsToEditorGraphDocument,
  type EditorGraphDocument,
} from "@/lib/editorGraphDocument";
import {
  clearPipelineEditorPersistedState,
  hasPersistedPipelineEditorState,
  migratePipelineEditorDraftKey,
  STORAGE_KEY_PREFIX,
  type PipelineConfig,
  type PersistedPipelineState,
} from "@/lib/pipelineEditorPersistence";
import { usePipelineEditorHistory } from "./usePipelineEditorHistory";
import {
  usePipelineEditorInitialState,
  usePipelineEditorPersistence,
} from "./usePipelineEditorPersistence";
import { usePipelineEditorShortcuts } from "./usePipelineEditorShortcuts";
import { usePipelineEditorStepOperations } from "./usePipelineEditorStepOperations";

export {
  STORAGE_KEY_PREFIX,
  clearPipelineEditorPersistedState as clearPersistedState,
  hasPersistedPipelineEditorState as hasPersistedPipelineState,
  migratePipelineEditorDraftKey as migrateDraftKey,
};
export type { PersistedPipelineState, PipelineConfig };

interface UsePipelineEditorOptions {
  initialSteps?: PipelineStep[];
  initialName?: string;
  initialConfig?: PipelineConfig;
  maxHistorySize?: number;
  pipelineId?: string; // Unique ID for persistence
  persistState?: boolean; // Enable/disable persistence (default: true)
  allowPersistedState?: boolean; // Whether persisted state should seed initial state
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
  stepCounts: Record<LegacyStepType, number>;
  totalSteps: number;

  // Derived graph document (stable handoff/read model seam for dag-ml/pipeline schema work)
  editorGraphDocument: EditorGraphDocument;

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
  exportToNirs4all: () => unknown[];

  // Persistence
  clearPersistedData: () => void;
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
    allowPersistedState = true,
  } = options;

  const {
    steps: resolvedInitialSteps,
    pipelineName: resolvedInitialName,
    isFavorite: resolvedInitialFavorite,
    pipelineConfig: resolvedInitialConfig,
  } = usePipelineEditorInitialState({
    initialSteps,
    initialName,
    initialConfig,
    pipelineId,
    persistState,
    allowPersistedState,
  });

  // Core state
  const [steps, setSteps] = useState<PipelineStep[]>(resolvedInitialSteps);
  const [pipelineName, setPipelineNameState] = useState(resolvedInitialName);
  const [pipelineConfig, setPipelineConfigState] = useState<PipelineConfig>(resolvedInitialConfig);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isFavorite, setIsFavoriteState] = useState(resolvedInitialFavorite);
  const [isDirty, setIsDirty] = useState(false);

  const { clearPersistedData } = usePipelineEditorPersistence({
    pipelineId,
    persistState,
    steps,
    pipelineName,
    pipelineConfig,
    isFavorite,
    isDirty,
  });

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

  const {
    canUndo,
    canRedo,
    pushToHistory,
    resetHistory,
    undo,
    redo,
  } = usePipelineEditorHistory({
    initialSteps: resolvedInitialSteps,
    maxHistorySize,
    setSteps,
    setIsDirty,
  });

  // Computed values
  const stepCounts = useMemo(() => countPipelineStepsRecursive(steps), [steps]);

  const totalSteps = useMemo(() => {
    return Object.values(stepCounts).reduce((a, b) => a + b, 0);
  }, [stepCounts]);

  // Derived, read-only graph document at the editor boundary. Future dag-ml /
  // pipeline schema work consumes this rather than re-deriving from raw steps;
  // legacy `steps` remains the editable source of truth.
  const editorGraphDocument = useMemo(
    () => legacyStepsToEditorGraphDocument(steps, { id: pipelineId, name: pipelineName }),
    [steps, pipelineId, pipelineName]
  );

  const {
    addStep,
    addStepAtPath,
    removeStep,
    duplicateStep,
    moveStep,
    reorderSteps,
    updateStep,
    addBranch,
    removeBranch,
    addChild,
    removeChild,
    updateChild,
    handleDrop,
    handleReorder,
  } = usePipelineEditorStepOperations({
    steps,
    selectedStepId,
    setSteps,
    setSelectedStepId,
    pushToHistory,
  });

  // Get selected step (recursive search)
  const getSelectedStep = useCallback(
    () => findPipelineStepById(steps, selectedStepId || ""),
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
    (newSteps: PipelineStep[], name?: string, config?: PipelineConfig) => {
      const migrated = hydrateEditorPipelineSteps(newSteps.map(migrateStep));
      setSteps(migrated);
      resetHistory(migrated);
      setSelectedStepId(null);
      if (name) {
        setPipelineNameState(name);
      }
      if (config) {
        setPipelineConfigState(config);
      }
      setIsDirty(false);
    },
    [resetHistory]
  );

  // Export pipeline
  const exportPipeline = useCallback(
    () => ({
      name: pipelineName,
      steps: JSON.parse(JSON.stringify(hydrateEditorPipelineSteps(steps))),
      config: pipelineConfig,
    }),
    [pipelineName, steps, pipelineConfig]
  );
  // Export to nirs4all canonical format
  const exportToNirs4all = useCallback(
    () => {
      const result = exportToNirs4allFormat(steps);
      return Array.isArray(result) ? result : result.pipeline;
    },
    [steps]
  );

  usePipelineEditorShortcuts({
    selectedStepId,
    undo,
    redo,
    removeStep,
    duplicateStep,
    setSelectedStepId,
  });

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

    // Derived graph document
    editorGraphDocument,

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
    exportToNirs4all,

    // Persistence
    clearPersistedData,
  };
}
