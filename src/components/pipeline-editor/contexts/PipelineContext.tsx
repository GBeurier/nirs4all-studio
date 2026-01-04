/**
 * PipelineContext - Context wrapper for pipeline editor state
 *
 * Provides the usePipelineEditor hook state via React Context to avoid
 * deep prop drilling throughout the pipeline editor component tree.
 *
 * Phase 1 Implementation - Foundation
 * @see docs/_internals/component_refactoring_specs.md
 *
 * Strategy (from specs):
 * - Context for: Global state mutations (removeStep, selectStep, etc.)
 * - Props for: Component-specific data (the step being rendered, branch index)
 *
 * This eliminates 80% of prop drilling while keeping component contracts
 * explicit for local data.
 *
 * @example
 * // At the provider level (PipelineEditor component)
 * const editorState = usePipelineEditor({ ... });
 * return (
 *   <PipelineProvider value={editorState}>
 *     <PipelineCanvas />
 *   </PipelineProvider>
 * );
 *
 * // In any child component
 * const { removeStep, updateStep, selectedStepId } = usePipeline();
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PipelineStep, StepType, StepOption } from "../types";
import type { PipelineConfig } from "@/hooks/usePipelineEditor";

/**
 * Subset of usePipelineEditor return values exposed via context.
 * This is intentionally a subset to encourage prop passing for
 * component-specific data.
 */
export interface PipelineContextValue {
  // === State (read-only) ===
  /** Current pipeline steps */
  steps: PipelineStep[];
  /** Currently selected step ID */
  selectedStepId: string | null;
  /** Pipeline name */
  pipelineName: string;
  /** Pipeline configuration */
  pipelineConfig: PipelineConfig;
  /** Whether the pipeline has unsaved changes */
  isDirty: boolean;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Step counts by type */
  stepCounts: Record<StepType, number>;
  /** Total number of steps */
  totalSteps: number;

  // === Step Operations ===
  /** Add a step to the root level */
  addStep: (type: StepType, option: StepOption) => void;
  /** Add a step at a specific path and index */
  addStepAtPath: (type: StepType, option: StepOption, path: string[], index: number) => void;
  /** Remove a step by ID */
  removeStep: (id: string, path?: string[]) => void;
  /** Duplicate a step */
  duplicateStep: (id: string, path?: string[]) => void;
  /** Move a step up or down */
  moveStep: (id: string, direction: "up" | "down", path?: string[]) => void;
  /** Update step properties */
  updateStep: (id: string, updates: Partial<PipelineStep>) => void;

  // === Selection ===
  /** Set the selected step */
  setSelectedStepId: (id: string | null) => void;
  /** Get the currently selected step object */
  getSelectedStep: () => PipelineStep | null;

  // === Branch Operations ===
  /** Add a branch to a branch step */
  addBranch: (stepId: string, path?: string[]) => void;
  /** Remove a branch from a branch step */
  removeBranch: (stepId: string, branchIndex: number, path?: string[]) => void;

  // === Container Children Operations ===
  /** Add a child to a container step */
  addChild: (stepId: string, path?: string[]) => void;
  /** Remove a child from a container step */
  removeChild: (stepId: string, childId: string, path?: string[]) => void;
  /** Update a child in a container step */
  updateChild: (stepId: string, childId: string, updates: Partial<PipelineStep>, path?: string[]) => void;

  // === History ===
  /** Undo the last action */
  undo: () => void;
  /** Redo the last undone action */
  redo: () => void;

  // === Pipeline Operations ===
  /** Clear the entire pipeline */
  clearPipeline: () => void;
  /** Load a pipeline */
  loadPipeline: (steps: PipelineStep[], name?: string, config?: PipelineConfig) => void;
}

// Create context with undefined default (will error if used outside provider)
const PipelineContext = createContext<PipelineContextValue | undefined>(undefined);

export interface PipelineProviderProps {
  /** The pipeline editor state from usePipelineEditor */
  value: PipelineContextValue;
  children: ReactNode;
}

/**
 * Provider component for pipeline editor context.
 *
 * Wraps children with access to pipeline state and operations.
 * Should be used at the top level of the pipeline editor component tree.
 *
 * Note: We pass `value` directly without memoization here because:
 * 1. The parent component (PipelineEditor) already owns the state
 * 2. usePipelineEditor should use useCallback for its functions
 * 3. Memoizing here with all deps would re-memoize on every render anyway
 *
 * If consumers experience performance issues, ensure usePipelineEditor
 * stabilizes its function references with useCallback.
 */
export function PipelineProvider({ value, children }: PipelineProviderProps) {
  // Only memoize based on primitive/reference-stable values
  // Functions from usePipelineEditor should be stable via useCallback
  const memoizedValue = useMemo(
    () => value,
    // Intentionally only depend on state values, not functions
    // Functions are assumed stable from usePipelineEditor's useCallback usage
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      value.steps,
      value.selectedStepId,
      value.pipelineName,
      value.isDirty,
      value.canUndo,
      value.canRedo,
      value.totalSteps,
    ]
  );

  return (
    <PipelineContext.Provider value={memoizedValue}>
      {children}
    </PipelineContext.Provider>
  );
}

/**
 * Hook to access pipeline editor context.
 *
 * Must be used within a PipelineProvider.
 *
 * @throws Error if used outside of PipelineProvider
 *
 * @example
 * function StepActions({ stepId }: { stepId: string }) {
 *   const { removeStep, duplicateStep } = usePipeline();
 *   return (
 *     <>
 *       <Button onClick={() => duplicateStep(stepId)}>Duplicate</Button>
 *       <Button onClick={() => removeStep(stepId)}>Remove</Button>
 *     </>
 *   );
 * }
 */
export function usePipeline(): PipelineContextValue {
  const context = useContext(PipelineContext);

  if (context === undefined) {
    throw new Error("usePipeline must be used within a PipelineProvider");
  }

  return context;
}

/**
 * Hook to access pipeline context with optional fallback.
 *
 * Useful for components that may be used both inside and outside
 * the pipeline editor context.
 *
 * @returns The context value or undefined if not within a provider
 */
export function usePipelineOptional(): PipelineContextValue | undefined {
  return useContext(PipelineContext);
}
