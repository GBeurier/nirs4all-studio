/**
 * Wizard Context - State management for the Dataset Loading Wizard
 *
 * Phase 5: Added support for loading workspace defaults for parsing options
 */
import React, { createContext, useContext, useReducer, useCallback, useEffect, useState, useRef } from "react";
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
  // Advanced configuration types
  MultiSourceConfig,
  PartitionConfig,
  FoldConfig,
  VariationsConfig,
} from "@/types/datasets";
import { getDataLoadingDefaults } from "@/api/client";
import type { DataLoadingDefaults } from "@/types/settings";

// System default parsing options (fallback)
const SYSTEM_DEFAULT_PARSING: ParsingOptions = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
  na_policy: "drop",
};

// Convert DataLoadingDefaults to ParsingOptions
function convertDefaultsToParsing(defaults: DataLoadingDefaults): ParsingOptions {
  return {
    delimiter: defaults.delimiter,
    decimal_separator: defaults.decimal_separator,
    has_header: defaults.has_header,
    header_unit: defaults.header_unit as ParsingOptions["header_unit"],
    signal_type: defaults.signal_type as ParsingOptions["signal_type"],
    na_policy: defaults.na_policy as ParsingOptions["na_policy"],
  };
}

// Default aggregation
const DEFAULT_AGGREGATION: AggregationConfig = {
  enabled: false,
  method: "mean",
  exclude_outliers: false,
};

// Default partition (file-based - default behavior)
const DEFAULT_PARTITION: PartitionConfig = {
  method: "files",
};

// Initial state factory (needs defaults parameter)
const createInitialState = (parsing: ParsingOptions): WizardState => ({
  step: "source",
  sourceType: null,
  basePath: "",
  datasetName: "",
  files: [],
  parsing: { ...parsing },
  perFileOverrides: {},
  targets: [],
  defaultTarget: "",
  taskType: "auto",
  aggregation: { ...DEFAULT_AGGREGATION },
  preview: null,
  isLoading: false,
  errors: {},
  // Advanced configuration (Phase 7 extensions)
  multiSource: null,
  partition: { ...DEFAULT_PARTITION },
  folds: null,
  variations: null,
});

// Initial state (uses system defaults, will be updated when workspace defaults load)
const initialState: WizardState = createInitialState(SYSTEM_DEFAULT_PARSING);

/**
 * Initial state that can be passed from drag-and-drop
 */
export interface WizardInitialState {
  sourceType: WizardSourceType;
  basePath: string;
  files?: DetectedFile[];
  skipToStep?: WizardStep;
}

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
  | { type: "APPLY_DEFAULTS"; payload: ParsingOptions }
  | { type: "INIT_FROM_DROP"; payload: { initial: WizardInitialState; parsing: ParsingOptions } }
  | { type: "RESET"; payload?: ParsingOptions }
  // Advanced configuration actions (Phase 7)
  | { type: "SET_MULTI_SOURCE"; payload: MultiSourceConfig | null }
  | { type: "SET_PARTITION"; payload: Partial<PartitionConfig> }
  | { type: "SET_FOLDS"; payload: FoldConfig | null }
  | { type: "SET_VARIATIONS"; payload: VariationsConfig | null };

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

    case "APPLY_DEFAULTS":
      // Only apply defaults if parsing hasn't been modified from initial state
      return { ...state, parsing: { ...action.payload } };

    case "INIT_FROM_DROP": {
      const { initial, parsing } = action.payload;
      const basePath = initial.basePath;
      const parts = basePath.split(/[/\\]/);
      const name = parts[parts.length - 1] || "dataset";
      return {
        ...createInitialState(parsing),
        step: initial.skipToStep || "files",
        sourceType: initial.sourceType,
        basePath: initial.basePath,
        datasetName: name,
        files: initial.files || [],
        isLoading: !initial.files, // If no files yet, we're loading
      };
    }

    case "RESET":
      return action.payload
        ? createInitialState(action.payload)
        : { ...initialState };

    // Advanced configuration cases (Phase 7)
    case "SET_MULTI_SOURCE":
      return { ...state, multiSource: action.payload };

    case "SET_PARTITION":
      return {
        ...state,
        partition: { ...state.partition, ...action.payload },
      };

    case "SET_FOLDS":
      return { ...state, folds: action.payload };

    case "SET_VARIATIONS":
      return { ...state, variations: action.payload };

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
  // Phase 5: Defaults
  workspaceDefaults: ParsingOptions | null;
  isLoadingDefaults: boolean;
  reloadDefaults: () => Promise<void>;
  // Drag-and-drop initialization
  initFromDrop: (initial: WizardInitialState) => void;
}

const WizardContext = createContext<WizardContextType | null>(null);

// Step order
const STEP_ORDER: WizardStep[] = ["source", "files", "parsing", "targets", "preview"];

// Provider props
interface WizardProviderProps {
  children: React.ReactNode;
  initialState?: WizardInitialState;
}

// Provider
export function WizardProvider({ children, initialState: initialProp }: WizardProviderProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const [workspaceDefaults, setWorkspaceDefaults] = useState<ParsingOptions | null>(null);
  const [isLoadingDefaults, setIsLoadingDefaults] = useState(true);
  const hasInitialized = useRef(false);

  // Load workspace defaults on mount
  const loadDefaults = useCallback(async () => {
    try {
      setIsLoadingDefaults(true);
      const defaults = await getDataLoadingDefaults();
      const parsingDefaults = convertDefaultsToParsing(defaults);
      setWorkspaceDefaults(parsingDefaults);
      // Apply defaults to state if wizard is at initial state
      dispatch({ type: "APPLY_DEFAULTS", payload: parsingDefaults });
    } catch (error) {
      // Workspace may not be selected, use system defaults
      console.log("Using system defaults for parsing options");
      setWorkspaceDefaults(SYSTEM_DEFAULT_PARSING);
    } finally {
      setIsLoadingDefaults(false);
    }
  }, []);

  useEffect(() => {
    loadDefaults();
  }, [loadDefaults]);

  // Initialize from drop if initial state is provided
  useEffect(() => {
    if (initialProp && !hasInitialized.current && !isLoadingDefaults) {
      hasInitialized.current = true;
      dispatch({
        type: "INIT_FROM_DROP",
        payload: {
          initial: initialProp,
          parsing: workspaceDefaults || SYSTEM_DEFAULT_PARSING,
        },
      });
    }
  }, [initialProp, isLoadingDefaults, workspaceDefaults]);

  // Function to initialize from drop (for external use)
  const initFromDrop = useCallback(
    (initial: WizardInitialState) => {
      dispatch({
        type: "INIT_FROM_DROP",
        payload: {
          initial,
          parsing: workspaceDefaults || SYSTEM_DEFAULT_PARSING,
        },
      });
    },
    [workspaceDefaults]
  );

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
    // Reset with workspace defaults if available
    dispatch({ type: "RESET", payload: workspaceDefaults || SYSTEM_DEFAULT_PARSING });
  }, [workspaceDefaults]);

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
      value={{
        state,
        dispatch,
        goToStep,
        nextStep,
        prevStep,
        reset,
        canProceed,
        workspaceDefaults,
        isLoadingDefaults,
        reloadDefaults: loadDefaults,
        initFromDrop,
      }}
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
export { SYSTEM_DEFAULT_PARSING as DEFAULT_PARSING, DEFAULT_AGGREGATION, DEFAULT_PARTITION, STEP_ORDER };
