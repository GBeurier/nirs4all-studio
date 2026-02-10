/**
 * useStepRenderer - Hook for step type renderer selection
 *
 * Provides the appropriate renderer component for a given step type.
 * Supports lazy loading for better bundle splitting.
 *
 * Uses a two-tier registry:
 * 1. SUBTYPE_RENDERER_REGISTRY: Checked first for flow/utility sub-types
 * 2. RENDERER_REGISTRY: Fallback keyed by the 8 consolidated StepTypes
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { lazy, useMemo, type ComponentType } from "react";
import type { StepType, StepSubType } from "../../types";
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

const GeneratorRenderer = lazy(() =>
  import("./GeneratorRenderer").then((m) => ({
    default: m.GeneratorRenderer,
  }))
);

const SequentialRenderer = lazy(() =>
  import("./SequentialRenderer").then((m) => ({
    default: m.SequentialRenderer,
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
 * Primary registry mapping the 8 consolidated step types to their renderers.
 * Used as fallback when no subType-specific renderer is found.
 */
const RENDERER_REGISTRY: Record<StepType, RendererConfig> = {
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
  model: {
    component: ModelRenderer,
    usesParameterProps: true,
    isLazy: true,
  },
  y_processing: {
    component: YProcessingRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  // Default renderers for flow/utility (overridden by subType)
  flow: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  utility: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
};

/**
 * Sub-type renderer overrides for flow and utility steps.
 * Checked first before falling back to the type-level registry.
 */
const SUBTYPE_RENDERER_REGISTRY: Partial<Record<StepSubType, RendererConfig>> = {
  // Flow sub-types
  branch: {
    component: DefaultRenderer,
    usesParameterProps: true,
    isLazy: false,
  },
  merge: {
    component: MergeRenderer,
    usesParameterProps: true,
    isLazy: true,
  },
  generator: {
    component: GeneratorRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
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
  sequential: {
    component: SequentialRenderer,
    usesParameterProps: false,
    isLazy: true,
  },
  // Utility sub-types
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
};

/**
 * Hook to get the appropriate renderer for a step.
 *
 * Checks subType first (for flow/utility steps), then falls back
 * to the type-level registry.
 *
 * @param type - The step type
 * @param subType - Optional sub-type for flow/utility steps
 * @returns The renderer component and metadata
 *
 * @example
 * const { Renderer, usesParameterProps, isLazy } = useStepRenderer(step.type, step.subType);
 */
export function useStepRenderer(type: StepType, subType?: StepSubType): UseStepRendererResult {
  return useMemo(() => {
    // Check subType-specific renderer first
    if (subType) {
      const subTypeConfig = SUBTYPE_RENDERER_REGISTRY[subType];
      if (subTypeConfig) {
        return {
          Renderer: subTypeConfig.component,
          usesParameterProps: subTypeConfig.usesParameterProps,
          isLazy: subTypeConfig.isLazy,
        };
      }
    }

    // Fall back to type-level renderer
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
  }, [type, subType]);
}

/**
 * Get all available step types that have renderers
 */
export function getAvailableStepTypes(): StepType[] {
  return Object.keys(RENDERER_REGISTRY) as StepType[];
}

/**
 * Check if a step type/subType uses parameter props
 */
export function stepTypeUsesParameterProps(type: StepType, subType?: StepSubType): boolean {
  if (subType) {
    const subTypeConfig = SUBTYPE_RENDERER_REGISTRY[subType];
    if (subTypeConfig) return subTypeConfig.usesParameterProps;
  }
  return RENDERER_REGISTRY[type]?.usesParameterProps ?? true;
}
