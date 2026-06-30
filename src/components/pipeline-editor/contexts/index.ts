/**
 * Pipeline Editor Contexts
 *
 * Context providers for pipeline editor state management.
 * These contexts help reduce prop drilling while maintaining
 * explicit component contracts.
 *
 * Phase 1 Implementation - Foundation
 * @see docs/_internals/implementation_roadmap.md
 */

export {
  PipelineProvider,
} from "./PipelineContext";
export {
  usePipeline,
  usePipelineOptional,
} from "./usePipelineContext";
export type {
  PipelineContextValue,
  PipelineProviderProps,
} from "./usePipelineContext";

export {
  NodeRegistryProvider,
} from "./NodeRegistryContext";
export {
  useNodeRegistry,
  useNodeRegistryOptional,
  useNodesByType,
  useNodeSearch,
  useNodeParameters,
} from "./useNodeRegistry";
export type {
  NodeDefinition,
  NodeRegistryContextValue,
} from "./useNodeRegistry";
export type {
  NodeRegistryProviderProps,
} from "./NodeRegistryContext";

export {
  PipelineEditorPreferencesProvider,
} from "./PipelineEditorPreferencesContext";
export {
  usePipelineEditorPreferences,
  usePipelineEditorPreferencesOptional,
} from "./usePipelineEditorPreferences";
export type {
  PipelineEditorPreferences,
  TierLevel,
} from "./usePipelineEditorPreferences";

export {
  OperatorAvailabilityProvider,
} from "./OperatorAvailabilityContext";
export {
  useOperatorAvailability,
  useOperatorAvailabilityOptional,
} from "./useOperatorAvailability";
export type {
  OperatorAvailability,
  OperatorAvailabilityContextValue,
} from "./useOperatorAvailability";
export type {
  OperatorAvailabilityProviderProps,
} from "./OperatorAvailabilityContext";

// Phase 4: Pipeline Integration
export {
  DatasetBindingProvider,
} from "./DatasetBindingContext";
export {
  useDatasetBindingContext,
  useDatasetBindingOptional,
  useStepShape,
  useStepDimensionWarnings,
} from "./useDatasetBindingContext";
export type {
  DatasetBindingContextValue,
  DatasetBindingProviderProps,
} from "./useDatasetBindingContext";
