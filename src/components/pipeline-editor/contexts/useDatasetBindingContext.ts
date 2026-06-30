import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Dataset } from "@/types/datasets";
import type { BoundDataset } from "../DatasetBinding";
import type { PipelineStep } from "../types";
import type {
  ShapeAtStep,
  ShapePropagationResult,
  ShapeWarning,
} from "@/hooks/useShapePropagation";

/**
 * Context value interface
 */
export interface DatasetBindingContextValue {
  /** Currently bound dataset (null if none) */
  boundDataset: BoundDataset | null;
  /** All available datasets */
  datasets: Dataset[];
  /** Whether datasets are loading */
  isLoading: boolean;
  /** Bind a dataset */
  bindDataset: (dataset: Dataset) => void;
  /** Clear the current binding */
  clearBinding: () => void;
  /** Select a target for the bound dataset */
  selectTarget: (targetColumn: string) => void;
  /** Refresh datasets list */
  refreshDatasets: () => Promise<void>;
  /** Shape propagation result (null if no dataset bound) */
  shapePropagation: ShapePropagationResult | null;
  /** Get shape at a specific step */
  getShapeAtStep: (stepId: string) => ShapeAtStep | null;
  /** Get warnings for a specific step */
  getStepWarnings: (stepId: string) => ShapeWarning[];
  /** All warnings across the pipeline */
  allWarnings: ShapeWarning[];
  /** Whether there are any dimension errors */
  hasDimensionErrors: boolean;
}

/**
 * Provider props
 */
export interface DatasetBindingProviderProps {
  children: ReactNode;
  /** Currently bound dataset */
  boundDataset: BoundDataset | null;
  /** All available datasets */
  datasets: Dataset[];
  /** Loading state */
  isLoading: boolean;
  /** Bind dataset callback */
  onBind: (dataset: Dataset) => void;
  /** Clear binding callback */
  onClear: () => void;
  /** Select target callback */
  onSelectTarget: (targetColumn: string) => void;
  /** Refresh callback */
  onRefresh: () => Promise<void>;
  /** Current pipeline steps for shape propagation */
  steps: PipelineStep[];
}

export const DatasetBindingContext = createContext<DatasetBindingContextValue | undefined>(undefined);

export function useDatasetBindingContext(): DatasetBindingContextValue {
  const context = useContext(DatasetBindingContext);

  if (context === undefined) {
    throw new Error(
      "useDatasetBindingContext must be used within a DatasetBindingProvider"
    );
  }

  return context;
}

export function useDatasetBindingOptional(): DatasetBindingContextValue | undefined {
  return useContext(DatasetBindingContext);
}

export function useStepShape(stepId: string): ShapeAtStep | null {
  const context = useDatasetBindingOptional();
  return useMemo(() => {
    if (!context) return null;
    return context.getShapeAtStep(stepId);
  }, [context, stepId]);
}

export function useStepDimensionWarnings(stepId: string): ShapeWarning[] {
  const context = useDatasetBindingOptional();
  return useMemo(() => {
    if (!context) return [];
    return context.getStepWarnings(stepId);
  }, [context, stepId]);
}
