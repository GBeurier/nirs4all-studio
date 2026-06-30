import { createContext, useContext, type ReactNode } from "react";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";
import type { PipelineStep, StepOption, StepType } from "../types";

/**
 * Subset of usePipelineEditor return values exposed via context.
 * This is intentionally a subset to encourage prop passing for
 * component-specific data.
 */
export interface PipelineContextValue {
  steps: PipelineStep[];
  selectedStepId: string | null;
  pipelineName: string;
  pipelineConfig: PipelineConfig;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  stepCounts: Record<StepType, number>;
  totalSteps: number;
  addStep: (type: StepType, option: StepOption) => void;
  addStepAtPath: (type: StepType, option: StepOption, path: string[], index: number) => void;
  removeStep: (id: string, path?: string[]) => void;
  duplicateStep: (id: string, path?: string[]) => void;
  moveStep: (id: string, direction: "up" | "down", path?: string[]) => void;
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;
  setSelectedStepId: (id: string | null) => void;
  getSelectedStep: () => PipelineStep | null;
  addBranch: (stepId: string, path?: string[]) => void;
  removeBranch: (stepId: string, branchIndex: number, path?: string[]) => void;
  addChild: (stepId: string, path?: string[]) => void;
  removeChild: (stepId: string, childId: string, path?: string[]) => void;
  updateChild: (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => void;
  undo: () => void;
  redo: () => void;
  clearPipeline: () => void;
  loadPipeline: (steps: PipelineStep[], name?: string, config?: PipelineConfig) => void;
}

export interface PipelineProviderProps {
  /** The pipeline editor state from usePipelineEditor */
  value: PipelineContextValue;
  children: ReactNode;
}

export const PipelineContext = createContext<PipelineContextValue | undefined>(undefined);

export function usePipeline(): PipelineContextValue {
  const context = useContext(PipelineContext);

  if (context === undefined) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }

  return context;
}

export function usePipelineOptional(): PipelineContextValue | undefined {
  return useContext(PipelineContext);
}
