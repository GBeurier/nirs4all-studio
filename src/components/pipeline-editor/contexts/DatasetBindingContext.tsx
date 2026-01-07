/**
 * DatasetBindingContext - Context for dataset binding in Pipeline Editor
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Provides dataset binding and shape propagation data to all pipeline
 * editor components without prop drilling.
 */

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { Dataset } from "@/types/datasets";
import type { PipelineStep } from "../types";
import type { BoundDataset, DataShape } from "../DatasetBinding";
import {
  useShapePropagation,
  type ShapePropagationResult,
  type ShapeWarning,
  type ShapeAtStep,
} from "@/hooks/useShapePropagation";

/**
 * Context value interface
 */
export interface DatasetBindingContextValue {
  // === Bound Dataset ===
  /** Currently bound dataset (null if none) */
  boundDataset: BoundDataset | null;
  /** All available datasets */
  datasets: Dataset[];
  /** Whether datasets are loading */
  isLoading: boolean;

  // === Actions ===
  /** Bind a dataset */
  bindDataset: (dataset: Dataset) => void;
  /** Clear the current binding */
  clearBinding: () => void;
  /** Select a target for the bound dataset */
  selectTarget: (targetColumn: string) => void;
  /** Refresh datasets list */
  refreshDatasets: () => Promise<void>;

  // === Shape Propagation ===
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

// Create context with undefined default
const DatasetBindingContext = createContext<DatasetBindingContextValue | undefined>(undefined);

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

/**
 * Provider component for dataset binding context
 */
export function DatasetBindingProvider({
  children,
  boundDataset,
  datasets,
  isLoading,
  onBind,
  onClear,
  onSelectTarget,
  onRefresh,
  steps,
}: DatasetBindingProviderProps) {
  // Calculate shape propagation
  const shapePropagation = useShapePropagation({
    steps,
    boundDataset,
  });

  // Helper to get shape at a step
  const getShapeAtStep = useMemo(() => {
    return (stepId: string): ShapeAtStep | null => {
      if (!shapePropagation) return null;
      return shapePropagation.shapes.get(stepId) || null;
    };
  }, [shapePropagation]);

  // Helper to get warnings for a step
  const getStepWarnings = useMemo(() => {
    return (stepId: string): ShapeWarning[] => {
      const shapeAtStep = getShapeAtStep(stepId);
      return shapeAtStep?.warnings || [];
    };
  }, [getShapeAtStep]);

  // All warnings
  const allWarnings = useMemo(() => {
    return shapePropagation?.warnings || [];
  }, [shapePropagation]);

  // Check for errors
  const hasDimensionErrors = useMemo(() => {
    return allWarnings.some((w) => w.severity === "error");
  }, [allWarnings]);

  // Memoize context value
  const value = useMemo<DatasetBindingContextValue>(
    () => ({
      boundDataset,
      datasets,
      isLoading,
      bindDataset: onBind,
      clearBinding: onClear,
      selectTarget: onSelectTarget,
      refreshDatasets: onRefresh,
      shapePropagation,
      getShapeAtStep,
      getStepWarnings,
      allWarnings,
      hasDimensionErrors,
    }),
    [
      boundDataset,
      datasets,
      isLoading,
      onBind,
      onClear,
      onSelectTarget,
      onRefresh,
      shapePropagation,
      getShapeAtStep,
      getStepWarnings,
      allWarnings,
      hasDimensionErrors,
    ]
  );

  return (
    <DatasetBindingContext.Provider value={value}>
      {children}
    </DatasetBindingContext.Provider>
  );
}

/**
 * Hook to access dataset binding context
 *
 * @throws Error if used outside of DatasetBindingProvider
 */
export function useDatasetBindingContext(): DatasetBindingContextValue {
  const context = useContext(DatasetBindingContext);

  if (context === undefined) {
    throw new Error(
      "useDatasetBindingContext must be used within a DatasetBindingProvider"
    );
  }

  return context;
}

/**
 * Hook to access dataset binding context optionally
 *
 * Returns undefined if not within a provider (useful for components
 * that may be used both inside and outside the pipeline editor)
 */
export function useDatasetBindingOptional(): DatasetBindingContextValue | undefined {
  return useContext(DatasetBindingContext);
}

/**
 * Hook to get shape at the current step
 *
 * Convenient hook for step components to access their shape data
 */
export function useStepShape(stepId: string): ShapeAtStep | null {
  const context = useDatasetBindingOptional();
  return useMemo(() => {
    if (!context) return null;
    return context.getShapeAtStep(stepId);
  }, [context, stepId]);
}

/**
 * Hook to get warnings for a step
 */
export function useStepDimensionWarnings(stepId: string): ShapeWarning[] {
  const context = useDatasetBindingOptional();
  return useMemo(() => {
    if (!context) return [];
    return context.getStepWarnings(stepId);
  }, [context, stepId]);
}
