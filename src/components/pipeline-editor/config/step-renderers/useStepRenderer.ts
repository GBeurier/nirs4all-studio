/**
 * useStepRenderer - Hook for step type renderer selection
 *
 * Provides the appropriate renderer component for a given step type.
 * Supports lazy loading for better bundle splitting.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { lazy, useMemo, type ComponentType } from "react";
import type { StepType } from "../../types";
import type {
  StepRendererProps,
  ParameterRendererProps,
  UseStepRendererResult,
} from "./types";

// Lazy-loaded renderer imports
// Heavy renderers are lazy-loaded to improve initial bundle size
const ModelRenderer = lazy(() =>
  import("./ModelRenderer").then((m) => ({ default: m.ModelRenderer }))
);

const MergeRenderer = lazy(() =>
  import("./MergeRenderer").then((m) => ({ default: m.MergeRenderer }))
);

const YProcessingRenderer = lazy(() =>
  import("./YProcessingRenderer").then((m) => ({
    default: m.YProcessingRenderer,
  }))
);

const ChartRenderer = lazy(() =>
  import("./ChartRenderer").then((m) => ({ default: m.ChartRenderer }))
);

const CommentRenderer = lazy(() =>
  import("./CommentRenderer").then((m) => ({ default: m.CommentRenderer }))
);

// Container renderers
const SampleAugmentationRenderer = lazy(() =>
  import("./ContainerRenderers").then((m) => ({
    default: m.SampleAugmentationRenderer,
  }))
);

const FeatureAugmentationRenderer = lazy(() =>
  import("./ContainerRenderers").then((m) => ({
    default: m.FeatureAugmentationRenderer,
  }))
);

const SampleFilterRenderer = lazy(() =>
  import("./ContainerRenderers").then((m) => ({
    default: m.SampleFilterRenderer,
  }))
);

const ConcatTransformRenderer = lazy(() =>
  import("./ContainerRenderers").then((m) => ({
    default: m.ConcatTransformRenderer,
  }))
);

// Default renderer is not lazy-loaded as it's used frequently
import { DefaultRenderer } from "./DefaultRenderer";

/**
 * Configuration for each step type's renderer
 */
interface RendererConfig {
  /** The renderer component */
  component: ComponentType<StepRendererProps> | ComponentType<ParameterRendererProps>;
  /** Whether this renderer uses parameter props (renderParamInput, etc.) */
  usesParameterProps: boolean;
  /** Whether this is a lazy-loaded component */
  isLazy: boolean;
}

/**
 * Registry mapping step types to their renderers
 */
const RENDERER_REGISTRY: Record<StepType, RendererConfig> = {
  // Standard renderers using DefaultRenderer with parameter props
  preprocessing: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  splitting: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  filter: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  augmentation: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },

  // Specialized renderers
  model: {
    component: ModelRenderer,
    usesParameterProps: true,
    isLazy: true,
  },
  merge: {
    component: MergeRenderer,
    usesParameterProps: true,
    isLazy: true,
  },
  y_processing: {
    component: YProcessingRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  chart: {
    component: ChartRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  comment: {
    component: CommentRenderer,
    usesParameterProps: false,
    isLazy: true,
  },

  // Container renderers
  sample_augmentation: {
    component: SampleAugmentationRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  feature_augmentation: {
    component: FeatureAugmentationRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  sample_filter: {
    component: SampleFilterRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  concat_transform: {
    component: ConcatTransformRenderer,
    usesParameterProps: false,
    isLazy: true,
  },

  // Types that use DefaultRenderer
  generator: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  branch: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
};

/**
 * Hook to get the appropriate renderer for a step type.
 *
 * @param type - The step type to get a renderer for
 * @returns The renderer component and metadata
 *
 * @example
 * const { Renderer, usesParameterProps, isLazy } = useStepRenderer(step.type);
 *
 * if (usesParameterProps) {
 *   return (
 *     <Suspense fallback={<Skeleton />}>
 *       <Renderer
 *         step={step}
 *         onUpdate={onUpdate}
 *         renderParamInput={renderParamInput}
 *         handleNameChange={handleNameChange}
 *         handleResetParams={handleResetParams}
 *         {...otherProps}
 *       />
 *     </Suspense>
 *   );
 * } else {
 *   return (
 *     <Suspense fallback={<Skeleton />}>
 *       <Renderer step={step} onUpdate={onUpdate} {...otherProps} />
 *     </Suspense>
 *   );
 * }
 */
export function useStepRenderer(type: StepType): UseStepRendererResult {
  return useMemo(() => {
    const config = RENDERER_REGISTRY[type];

    if (!config) {
      // Fallback to default renderer for unknown types
      return {
        Renderer: DefaultRenderer,
        usesParameterProps: true,
        isLazy: false,
      };
    }

    return {
      Renderer: config.component,
      usesParameterProps: config.usesParameterProps,
      isLazy: config.isLazy,
    };
  }, [type]);
}

/**
 * Get all available step types that have renderers
 */
export function getAvailableStepTypes(): StepType[] {
  return Object.keys(RENDERER_REGISTRY) as StepType[];
}

/**
 * Check if a step type uses parameter props
 */
export function stepTypeUsesParameterProps(type: StepType): boolean {
  return RENDERER_REGISTRY[type]?.usesParameterProps ?? true;
}
