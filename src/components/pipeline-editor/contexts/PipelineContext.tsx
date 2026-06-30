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

import { useMemo } from "react";
import {
  PipelineContext,
  type PipelineProviderProps,
} from "./usePipelineContext";

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
