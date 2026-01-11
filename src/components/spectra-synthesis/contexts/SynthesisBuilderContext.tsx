/**
 * SynthesisBuilderContext
 *
 * Manages the state of the synthesis builder, including:
 * - Core configuration (name, n_samples, random_state)
 * - Added steps and their parameters
 * - Selection state
 * - Validation state
 * - History for undo/redo
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
  type Dispatch,
} from "react";

// Simple ID generator using built-in crypto API
function generateId(): string {
  return crypto.randomUUID();
}
import type {
  SynthesisStep,
  SynthesisStepType,
  SynthesisConfig,
  ValidationError,
  ValidationWarning,
} from "../types";
import {
  getStepDefinition,
  getDefaultStepParams,
  getDefaultSynthesisConfig,
  SYNTHESIS_STEPS,
} from "../definitions";

// ============= State Types =============

interface SynthesisBuilderState {
  // Core config
  name: string;
  n_samples: number;
  random_state: number | null;

  // Steps
  steps: SynthesisStep[];

  // UI state
  selectedStepId: string | null;

  // Validation
  errors: ValidationError[];
  warnings: ValidationWarning[];

  // History
  history: SynthesisBuilderState[];
  historyIndex: number;

  // Dirty flag
  isDirty: boolean;
}

// ============= Action Types =============

type SynthesisBuilderAction =
  | { type: "SET_NAME"; payload: string }
  | { type: "SET_SAMPLES"; payload: number }
  | { type: "SET_RANDOM_STATE"; payload: number | null }
  | { type: "ADD_STEP"; payload: SynthesisStepType }
  | { type: "REMOVE_STEP"; payload: string }
  | { type: "UPDATE_STEP"; payload: { id: string; params: Record<string, unknown> } }
  | { type: "TOGGLE_STEP"; payload: string }
  | { type: "REORDER_STEPS"; payload: { fromIndex: number; toIndex: number } }
  | { type: "SELECT_STEP"; payload: string | null }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "LOAD_CONFIG"; payload: SynthesisConfig }
  | { type: "RESET" }
  | { type: "VALIDATE" };

// ============= Initial State =============

const defaultConfig = getDefaultSynthesisConfig();

const initialState: SynthesisBuilderState = {
  name: defaultConfig.name,
  n_samples: defaultConfig.n_samples,
  random_state: defaultConfig.random_state,
  steps: [],
  selectedStepId: null,
  errors: [],
  warnings: [],
  history: [],
  historyIndex: -1,
  isDirty: false,
};

// ============= Validation =============

function validateSteps(steps: SynthesisStep[]): {
  errors: ValidationError[];
  warnings: ValidationWarning[];
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const enabledSteps = steps.filter((s) => s.enabled);
  const enabledTypes = new Set(enabledSteps.map((s) => s.type));

  // Check mutual exclusivity
  if (enabledTypes.has("targets") && enabledTypes.has("classification")) {
    errors.push({
      message: "Cannot have both Targets (Regression) and Classification enabled. Choose one.",
      severity: "error",
    });
  }

  // Check dependencies
  const complexitySteps: SynthesisStepType[] = ["nonlinear_targets", "target_complexity", "complex_landscape"];
  for (const step of enabledSteps) {
    if (complexitySteps.includes(step.type) && !enabledTypes.has("targets")) {
      const def = getStepDefinition(step.type);
      warnings.push({
        stepId: step.id,
        message: `${def?.name || step.type} works best with Targets step enabled`,
        severity: "warning",
      });
    }
  }

  // Check if no steps
  if (enabledSteps.length === 0) {
    warnings.push({
      message: "No steps enabled. Add at least a Features step for basic generation.",
      severity: "warning",
    });
  }

  return { errors, warnings };
}

// ============= Reducer =============

function synthesisBuilderReducer(
  state: SynthesisBuilderState,
  action: SynthesisBuilderAction
): SynthesisBuilderState {
  // Helper to save to history
  const saveToHistory = (currentState: SynthesisBuilderState): SynthesisBuilderState[] => {
    // Don't save history or UI-only changes
    const historySlice = currentState.history.slice(0, currentState.historyIndex + 1);
    const stateForHistory = {
      ...currentState,
      history: [],
      historyIndex: -1,
    };
    return [...historySlice, stateForHistory].slice(-50); // Keep last 50 states
  };

  switch (action.type) {
    case "SET_NAME":
      return {
        ...state,
        name: action.payload,
        isDirty: true,
      };

    case "SET_SAMPLES":
      return {
        ...state,
        n_samples: Math.max(10, Math.min(100000, action.payload)),
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };

    case "SET_RANDOM_STATE":
      return {
        ...state,
        random_state: action.payload,
        isDirty: true,
      };

    case "ADD_STEP": {
      const stepType = action.payload;
      const definition = getStepDefinition(stepType);
      if (!definition) return state;

      const newStep: SynthesisStep = {
        id: generateId(),
        type: stepType,
        method: definition.method,
        params: getDefaultStepParams(stepType),
        enabled: true,
        order: state.steps.length,
      };

      const newSteps = [...state.steps, newStep];
      const validation = validateSteps(newSteps);

      return {
        ...state,
        steps: newSteps,
        selectedStepId: newStep.id,
        errors: validation.errors,
        warnings: validation.warnings,
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };
    }

    case "REMOVE_STEP": {
      const newSteps = state.steps
        .filter((s) => s.id !== action.payload)
        .map((s, i) => ({ ...s, order: i }));
      const validation = validateSteps(newSteps);

      return {
        ...state,
        steps: newSteps,
        selectedStepId: state.selectedStepId === action.payload ? null : state.selectedStepId,
        errors: validation.errors,
        warnings: validation.warnings,
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };
    }

    case "UPDATE_STEP": {
      const { id, params } = action.payload;
      const newSteps = state.steps.map((s) =>
        s.id === id ? { ...s, params: { ...s.params, ...params } } : s
      );

      return {
        ...state,
        steps: newSteps,
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };
    }

    case "TOGGLE_STEP": {
      const newSteps = state.steps.map((s) =>
        s.id === action.payload ? { ...s, enabled: !s.enabled } : s
      );
      const validation = validateSteps(newSteps);

      return {
        ...state,
        steps: newSteps,
        errors: validation.errors,
        warnings: validation.warnings,
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };
    }

    case "REORDER_STEPS": {
      const { fromIndex, toIndex } = action.payload;
      const newSteps = [...state.steps];
      const [removed] = newSteps.splice(fromIndex, 1);
      newSteps.splice(toIndex, 0, removed);
      const reorderedSteps = newSteps.map((s, i) => ({ ...s, order: i }));

      return {
        ...state,
        steps: reorderedSteps,
        isDirty: true,
        history: saveToHistory(state),
        historyIndex: state.historyIndex + 1,
      };
    }

    case "SELECT_STEP":
      return {
        ...state,
        selectedStepId: action.payload,
      };

    case "UNDO": {
      if (state.historyIndex < 0) return state;
      const previousState = state.history[state.historyIndex];
      if (!previousState) return state;

      return {
        ...previousState,
        history: state.history,
        historyIndex: state.historyIndex - 1,
        selectedStepId: state.selectedStepId,
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const nextState = state.history[state.historyIndex + 1];
      if (!nextState) return state;

      return {
        ...nextState,
        history: state.history,
        historyIndex: state.historyIndex + 1,
        selectedStepId: state.selectedStepId,
      };
    }

    case "LOAD_CONFIG": {
      const config = action.payload;
      const validation = validateSteps(config.steps);

      return {
        ...state,
        name: config.name,
        n_samples: config.n_samples,
        random_state: config.random_state,
        steps: config.steps,
        selectedStepId: null,
        errors: validation.errors,
        warnings: validation.warnings,
        isDirty: false,
        history: [],
        historyIndex: -1,
      };
    }

    case "RESET": {
      const validation = validateSteps([]);
      return {
        ...initialState,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    case "VALIDATE": {
      const validation = validateSteps(state.steps);
      return {
        ...state,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    default:
      return state;
  }
}

// ============= Context =============

interface SynthesisBuilderContextValue {
  // State
  state: SynthesisBuilderState;

  // Core config actions
  setName: (name: string) => void;
  setSamples: (n: number) => void;
  setRandomState: (seed: number | null) => void;

  // Step actions
  addStep: (type: SynthesisStepType) => void;
  removeStep: (id: string) => void;
  updateStep: (id: string, params: Record<string, unknown>) => void;
  toggleStep: (id: string) => void;
  reorderSteps: (fromIndex: number, toIndex: number) => void;
  selectStep: (id: string | null) => void;

  // History
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  // Import/Export
  exportConfig: () => SynthesisConfig;
  loadConfig: (config: SynthesisConfig) => void;
  reset: () => void;

  // Helpers
  getSelectedStep: () => SynthesisStep | undefined;
  getStepById: (id: string) => SynthesisStep | undefined;
  hasStep: (type: SynthesisStepType) => boolean;
  getEnabledSteps: () => SynthesisStep[];
}

const SynthesisBuilderContext = createContext<SynthesisBuilderContextValue | null>(null);

// ============= Provider =============

interface SynthesisBuilderProviderProps {
  children: ReactNode;
  initialConfig?: SynthesisConfig;
  persistKey?: string;
}

export function SynthesisBuilderProvider({
  children,
  initialConfig,
  persistKey = "nirs4all_synthesis_builder",
}: SynthesisBuilderProviderProps) {
  const [state, dispatch] = useReducer(synthesisBuilderReducer, initialState, (initial) => {
    // Try to load from localStorage
    if (persistKey) {
      try {
        const saved = localStorage.getItem(persistKey);
        if (saved) {
          const parsed = JSON.parse(saved);
          const validation = validateSteps(parsed.steps || []);
          return {
            ...initial,
            ...parsed,
            history: [],
            historyIndex: -1,
            errors: validation.errors,
            warnings: validation.warnings,
          };
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Use initial config if provided
    if (initialConfig) {
      const validation = validateSteps(initialConfig.steps);
      return {
        ...initial,
        ...initialConfig,
        errors: validation.errors,
        warnings: validation.warnings,
      };
    }

    return initial;
  });

  // Persist to localStorage
  useEffect(() => {
    if (persistKey && state.isDirty) {
      try {
        const toSave = {
          name: state.name,
          n_samples: state.n_samples,
          random_state: state.random_state,
          steps: state.steps,
        };
        localStorage.setItem(persistKey, JSON.stringify(toSave));
      } catch {
        // Ignore save errors
      }
    }
  }, [state, persistKey]);

  // Actions
  const setName = useCallback((name: string) => {
    dispatch({ type: "SET_NAME", payload: name });
  }, []);

  const setSamples = useCallback((n: number) => {
    dispatch({ type: "SET_SAMPLES", payload: n });
  }, []);

  const setRandomState = useCallback((seed: number | null) => {
    dispatch({ type: "SET_RANDOM_STATE", payload: seed });
  }, []);

  const addStep = useCallback((type: SynthesisStepType) => {
    dispatch({ type: "ADD_STEP", payload: type });
  }, []);

  const removeStep = useCallback((id: string) => {
    dispatch({ type: "REMOVE_STEP", payload: id });
  }, []);

  const updateStep = useCallback((id: string, params: Record<string, unknown>) => {
    dispatch({ type: "UPDATE_STEP", payload: { id, params } });
  }, []);

  const toggleStep = useCallback((id: string) => {
    dispatch({ type: "TOGGLE_STEP", payload: id });
  }, []);

  const reorderSteps = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: "REORDER_STEPS", payload: { fromIndex, toIndex } });
  }, []);

  const selectStep = useCallback((id: string | null) => {
    dispatch({ type: "SELECT_STEP", payload: id });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const exportConfig = useCallback((): SynthesisConfig => {
    return {
      name: state.name,
      n_samples: state.n_samples,
      random_state: state.random_state,
      steps: state.steps,
    };
  }, [state.name, state.n_samples, state.random_state, state.steps]);

  const loadConfig = useCallback((config: SynthesisConfig) => {
    dispatch({ type: "LOAD_CONFIG", payload: config });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
    if (persistKey) {
      localStorage.removeItem(persistKey);
    }
  }, [persistKey]);

  // Helpers
  const getSelectedStep = useCallback(() => {
    return state.steps.find((s) => s.id === state.selectedStepId);
  }, [state.steps, state.selectedStepId]);

  const getStepById = useCallback(
    (id: string) => {
      return state.steps.find((s) => s.id === id);
    },
    [state.steps]
  );

  const hasStep = useCallback(
    (type: SynthesisStepType) => {
      return state.steps.some((s) => s.type === type && s.enabled);
    },
    [state.steps]
  );

  const getEnabledSteps = useCallback(() => {
    return state.steps.filter((s) => s.enabled);
  }, [state.steps]);

  const canUndo = state.historyIndex >= 0;
  const canRedo = state.historyIndex < state.history.length - 1;

  const value = useMemo<SynthesisBuilderContextValue>(
    () => ({
      state,
      setName,
      setSamples,
      setRandomState,
      addStep,
      removeStep,
      updateStep,
      toggleStep,
      reorderSteps,
      selectStep,
      undo,
      redo,
      canUndo,
      canRedo,
      exportConfig,
      loadConfig,
      reset,
      getSelectedStep,
      getStepById,
      hasStep,
      getEnabledSteps,
    }),
    [
      state,
      setName,
      setSamples,
      setRandomState,
      addStep,
      removeStep,
      updateStep,
      toggleStep,
      reorderSteps,
      selectStep,
      undo,
      redo,
      canUndo,
      canRedo,
      exportConfig,
      loadConfig,
      reset,
      getSelectedStep,
      getStepById,
      hasStep,
      getEnabledSteps,
    ]
  );

  return (
    <SynthesisBuilderContext.Provider value={value}>
      {children}
    </SynthesisBuilderContext.Provider>
  );
}

// ============= Hook =============

export function useSynthesisBuilder(): SynthesisBuilderContextValue {
  const context = useContext(SynthesisBuilderContext);
  if (!context) {
    throw new Error("useSynthesisBuilder must be used within a SynthesisBuilderProvider");
  }
  return context;
}

export function useSynthesisBuilderOptional(): SynthesisBuilderContextValue | null {
  return useContext(SynthesisBuilderContext);
}
