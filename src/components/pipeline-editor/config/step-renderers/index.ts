/**
 * Step Renderers Module
 *
 * Per-step-type configuration renderers extracted from StepConfigPanel.
 * Each renderer handles the UI for configuring a specific step type.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 *
 * @example
 * import { useStepRenderer, StepActions } from './step-renderers';
 *
 * function StepConfigPanel({ step, ...props }) {
 *   const { Renderer, usesParameterProps } = useStepRenderer(step.type);
 *   return <Renderer step={step} {...props} />;
 * }
 */

// Types
export type {
  StepRendererProps,
  ParameterRendererProps,
  StepRenderer,
  ParameterStepRenderer,
  StepRendererRegistry,
  UseStepRendererResult,
} from "./types";

// Hook for renderer selection
export {
  useStepRenderer,
  getAvailableStepTypes,
  stepTypeUsesParameterProps,
} from "./useStepRenderer";

// Shared components
export { StepActions } from "./StepActions";
export type { StepActionsProps } from "./StepActions";

// Direct imports for non-lazy usage (testing, SSR, etc.)
export { DefaultRenderer } from "./DefaultRenderer";
export { GeneratorRenderer } from "./GeneratorRenderer";
export { ModelRenderer } from "./ModelRenderer";
export { MergeRenderer } from "./MergeRenderer";
export { YProcessingRenderer } from "./YProcessingRenderer";
export { ChartRenderer } from "./ChartRenderer";
export { CommentRenderer } from "./CommentRenderer";
export {
  SampleAugmentationRenderer,
  FeatureAugmentationRenderer,
  SampleFilterRenderer,
  ConcatTransformRenderer,
} from "./ContainerRenderers";
export { SequentialRenderer } from "./SequentialRenderer";
