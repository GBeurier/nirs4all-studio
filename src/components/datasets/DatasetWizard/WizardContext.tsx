/**
 * Wizard Context - State management for the Dataset Loading Wizard
 */
import React, { createContext, useContext, useReducer, useCallback } from "react";
import type {
  WizardState,
  WizardStep,
  WizardSourceType,
  DetectedFile,
  ParsingOptions,
  TargetConfig,
  TaskType,
  AggregationConfig,
  PreviewDataResponse,
} from "@/types/datasets";

// Default parsing options
const DEFAULT_PARSING: ParsingOptions = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
  na_policy: "drop",
};

// Default aggregation
const DEFAULT_AGGREGATION: AggregationConfig = {
  enabled: false,
  method: "mean",
  exclude_outliers: false,
};

// Initial state
const initialState: WizardState = {
  step: "source",
  sourceType: null,
  basePath: "",
  datasetName: "",
  files: [],
  parsing: { ...DEFAULT_PARSING },
  perFileOverrides: {},
  targets: [],
  defaultTarget: "",
  taskType: "auto",
  aggregation: { ...DEFAULT_AGGREGATION },
  preview: null,
  isLoading: false,
  errors: {},
};

// Action types
type WizardAction =
  | { type: "SET_STEP"; payload: WizardStep }
  | { type: "SET_SOURCE_TYPE"; payload: WizardSourceType }
  | { type: "SET_BASE_PATH"; payload: string }
  | { type: "SET_DATASET_NAME"; payload: string }
  | { type: "SET_FILES"; payload: DetectedFile[] }
  | { type: "UPDATE_FILE"; payload: { index: number; updates: Partial<DetectedFile> } }
  | { type: "REMOVE_FILE"; payload: number }
  | { type: "ADD_FILES"; payload: DetectedFile[] }
  | { type: "SET_PARSING"; payload: Partial<ParsingOptions> }
  | { type: "SET_FILE_OVERRIDE"; payload: { path: string; options: Partial<ParsingOptions> | null } }
  | { type: "SET_TARGETS"; payload: TargetConfig[] }
  | { type: "SET_DEFAULT_TARGET"; payload: string }
  | { type: "SET_TASK_TYPE"; payload: TaskType }
  | { type: "SET_AGGREGATION"; payload: Partial<AggregationConfig> }
  | { type: "SET_PREVIEW"; payload: PreviewDataResponse | null }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: { key: string; message: string | null } }
  | { type: "RESET" };

// Reducer
function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.payload };

    case "SET_SOURCE_TYPE":
      return { ...state, sourceType: action.payload };

    case "SET_BASE_PATH":
      return { ...state, basePath: action.payload };

    case "SET_DATASET_NAME":
      return { ...state, datasetName: action.payload };

    case "SET_FILES":
      return { ...state, files: action.payload };

    case "UPDATE_FILE":
      return {
        ...state,
        files: state.files.map((f, i) =>
          i === action.payload.index ? { ...f, ...action.payload.updates } : f
        ),
      };

    case "REMOVE_FILE":
      return {
        ...state,
        files: state.files.filter((_, i) => i !== action.payload),
      };

    case "ADD_FILES":
      return { ...state, files: [...state.files, ...action.payload] };

    case "SET_PARSING":
      return { ...state, parsing: { ...state.parsing, ...action.payload } };

    case "SET_FILE_OVERRIDE":
      if (action.payload.options === null) {
        const { [action.payload.path]: _, ...rest } = state.perFileOverrides;
        return { ...state, perFileOverrides: rest };
      }
      return {
        ...state,
        perFileOverrides: {
          ...state.perFileOverrides,
          [action.payload.path]: {
            ...state.perFileOverrides[action.payload.path],
            ...action.payload.options,
          },
        },
      };

    case "SET_TARGETS":
      return { ...state, targets: action.payload };

    case "SET_DEFAULT_TARGET":
      return { ...state, defaultTarget: action.payload };

    case "SET_TASK_TYPE":
      return { ...state, taskType: action.payload };

    case "SET_AGGREGATION":
      return {
        ...state,
        aggregation: { ...state.aggregation, ...action.payload },
      };

    case "SET_PREVIEW":
      return { ...state, preview: action.payload };

    case "SET_LOADING":
      return { ...state, isLoading: action.payload };

    case "SET_ERROR":
      if (action.payload.message === null) {
        const { [action.payload.key]: _, ...rest } = state.errors;
        return { ...state, errors: rest };
      }
      return {
        ...state,
        errors: { ...state.errors, [action.payload.key]: action.payload.message },
      };

    case "RESET":
      return { ...initialState };

    default:
      return state;
  }
}

// Context
interface WizardContextType {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  // Helper actions
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
  canProceed: () => boolean;
}

const WizardContext = createContext<WizardContextType | null>(null);

// Step order
const STEP_ORDER: WizardStep[] = ["source", "files", "parsing", "targets", "preview"];

// Provider
export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const goToStep = useCallback((step: WizardStep) => {
    dispatch({ type: "SET_STEP", payload: step });
  }, []);

  const nextStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    if (currentIndex < STEP_ORDER.length - 1) {
      dispatch({ type: "SET_STEP", payload: STEP_ORDER[currentIndex + 1] });
    }
  }, [state.step]);

  const prevStep = useCallback(() => {
    const currentIndex = STEP_ORDER.indexOf(state.step);
    if (currentIndex > 0) {
      dispatch({ type: "SET_STEP", payload: STEP_ORDER[currentIndex - 1] });
    }
  }, [state.step]);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  const canProceed = useCallback(() => {
    switch (state.step) {
      case "source":
        return state.sourceType !== null && state.basePath.length > 0;
      case "files":
        return state.files.length > 0 && state.files.some((f) => f.type === "X");
      case "parsing":
        return true; // Parsing always has defaults
      case "targets":
        return true; // Targets are optional
      case "preview":
        return state.preview !== null && !state.preview.error;
      default:
        return false;
    }
  }, [state]);

  return (
    <WizardContext.Provider
      value={{ state, dispatch, goToStep, nextStep, prevStep, reset, canProceed }}
    >
      {children}
    </WizardContext.Provider>
  );
}

// Hook
export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return context;
}

// Export defaults for reuse
export { DEFAULT_PARSING, DEFAULT_AGGREGATION, STEP_ORDER };
