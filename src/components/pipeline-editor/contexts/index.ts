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
  usePipeline,
  usePipelineOptional,
  type PipelineContextValue,
  type PipelineProviderProps,
} from "./PipelineContext";

export {
  NodeRegistryProvider,
  useNodeRegistry,
  useNodeRegistryOptional,
  type NodeDefinition,
  type NodeRegistryContextValue,
  type NodeRegistryProviderProps,
} from "./NodeRegistryContext";
