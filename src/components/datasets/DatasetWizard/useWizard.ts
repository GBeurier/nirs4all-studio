import { createContext, useContext, type Dispatch, type ReactNode } from "react";
import type {
  AggregationConfig,
  DetectedFile,
  DetectionConfidence,
  FoldConfig,
  MultiSourceConfig,
  ParsingOptions,
  PreviewDataResponse,
  TargetConfig,
  TaskType,
  WizardSourceType,
  WizardState,
  WizardStep,
} from "@/types/datasets";

export const DEFAULT_PARSING: ParsingOptions = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
  na_policy: "auto",
};

export const DEFAULT_AGGREGATION: AggregationConfig = {
  enabled: false,
  method: "mean",
};

export const STEP_ORDER: WizardStep[] = ["source", "files", "parsing", "targets", "preview"];

export interface WizardInitialState {
  sourceType: WizardSourceType;
  basePath: string;
  datasetName?: string;
  files?: DetectedFile[];
  skipToStep?: WizardStep;
  parsing?: Partial<ParsingOptions>;
  perFileOverrides?: Record<string, Partial<ParsingOptions>>;
  targets?: TargetConfig[];
  defaultTarget?: string;
  taskType?: TaskType;
  aggregation?: Partial<AggregationConfig>;
  multiSource?: MultiSourceConfig | null;
  folds?: FoldConfig | null;
  detectedParsing?: Partial<ParsingOptions>;
  hasFoldFile?: boolean;
  foldFilePath?: string;
  metadataColumns?: string[];
  confidence?: DetectionConfidence;
  fileBlobs?: Map<string, File>;
}

/** Extract backend-provided parsing overrides into the persisted wizard state. */
export function getDetectedFileOverrides(
  files: DetectedFile[],
): Record<string, Partial<ParsingOptions>> {
  return Object.fromEntries(
    files.flatMap((file) => file.overrides ? [[file.path, file.overrides]] : []),
  );
}

export type WizardAction =
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
  | {
      type: "SET_DETECTION_RESULTS";
      payload: {
        files?: DetectedFile[];
        parsing?: Partial<ParsingOptions>;
        hasFoldFile?: boolean;
        foldFilePath?: string | null;
        metadataColumns?: string[];
        confidence?: DetectionConfidence;
        perFileOverrides?: Record<string, Partial<ParsingOptions>>;
      };
    }
  | { type: "SET_MULTI_SOURCE"; payload: MultiSourceConfig | null }
  | { type: "SET_FOLDS"; payload: FoldConfig | null }
  | { type: "SET_VALIDATING"; payload: boolean }
  | { type: "SET_VALIDATED_SHAPES"; payload: Record<string, { num_rows?: number; num_columns?: number; error?: string }> }
  | { type: "SET_VALIDATION_ERROR"; payload: string | null }
  | { type: "SET_FILE_BLOBS"; payload: Map<string, File> };

export interface WizardContextType {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  goToStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
  canProceed: () => boolean;
  workspaceDefaults: ParsingOptions | null;
  isLoadingDefaults: boolean;
  reloadDefaults: () => Promise<void>;
  initFromDrop: (initial: WizardInitialState) => void;
}

export interface WizardProviderProps {
  children: ReactNode;
  initialState?: WizardInitialState;
}

export const WizardContext = createContext<WizardContextType | null>(null);

export function useWizard() {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error("useWizard must be used within a WizardProvider");
  }
  return context;
}
