import { createContext, useContext } from "react";

import type {
  SynthesisConfig,
  SynthesisStep,
  SynthesisStepType,
  ValidationError,
  ValidationWarning,
} from "../types";

export interface SynthesisBuilderState {
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

export interface SynthesisBuilderContextValue {
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

export const SynthesisBuilderContext = createContext<SynthesisBuilderContextValue | null>(null);

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
