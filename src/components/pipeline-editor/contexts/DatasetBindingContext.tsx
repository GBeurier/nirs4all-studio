/**
 * DatasetBindingContext - Context for dataset binding in Pipeline Editor
 *
 * Phase 4 Implementation: Pipeline Integration
 * @see docs/ROADMAP_DATASETS_WORKSPACE.md
 *
 * Provides dataset binding and shape propagation data to all pipeline
 * editor components without prop drilling.
 */

import { useMemo } from "react";
import {
  useShapePropagation,
  type ShapeWarning,
  type ShapeAtStep,
} from "@/hooks/useShapePropagation";
import {
  DatasetBindingContext,
  type DatasetBindingContextValue,
  type DatasetBindingProviderProps,
} from "./useDatasetBindingContext";

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
