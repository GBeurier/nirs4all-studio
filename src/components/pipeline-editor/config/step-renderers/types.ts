/**
 * Step Renderer Types
 *
 * Shared types and interfaces for all step type renderers.
 * Each renderer is responsible for rendering the configuration UI
 * for a specific step type.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import type { PipelineStep, StepType, StepOption } from "../../types";

/**
 * Props passed to all step renderers.
 *
 * Renderers receive the step data and callbacks to modify it.
 * The parent StepConfigPanel handles common elements like the header
 * and action buttons.
 */
export interface StepRendererProps {
  /** The step being configured */
  step: PipelineStep;

  /** Update the step with partial changes */
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;

  /** Remove the step */
  onRemove: (id: string) => void;

  /** Duplicate the step */
  onDuplicate: (id: string) => void;

  /**
   * Select a step (used for navigating to child steps in containers)
   * Optional - only provided when container navigation is supported
   */
  onSelectStep?: (id: string | null) => void;

  /**
   * Add a child to a container step
   * Optional - only provided for container steps
   */
  onAddChild?: (stepId: string) => void;

  /**
   * Remove a child from a container step
   * Optional - only provided for container steps
   */
  onRemoveChild?: (stepId: string, childId: string) => void;

  /**
   * Current step option definition
   * Contains name, description, and default params
   */
  currentOption?: StepOption;
}

/**
 * Extended props for renderers that support parameter inputs
 */
export interface ParameterRendererProps extends StepRendererProps {
  /**
   * Render a parameter input field
   * Provided by StepConfigPanel with sweep support
   */
  renderParamInput: (key: string, value: string | number | boolean) => React.ReactNode;

  /**
   * Handle algorithm/step name change
   */
  handleNameChange: (name: string) => void;

  /**
   * Reset parameters to defaults
   */
  handleResetParams: () => void;
}

/**
 * Component type for step renderers
 */
export type StepRenderer = React.ComponentType<StepRendererProps>;

/**
 * Component type for parameter-aware step renderers
 */
export type ParameterStepRenderer = React.ComponentType<ParameterRendererProps>;

/**
 * Registry of step type to renderer component mapping
 */
export type StepRendererRegistry = Partial<Record<StepType, React.LazyExoticComponent<StepRenderer>>>;

/**
 * Result of the useStepRenderer hook
 */
export interface UseStepRendererResult {
  /** The renderer component to use */
  Renderer: React.ComponentType<StepRendererProps> | React.ComponentType<ParameterRendererProps>;

  /** Whether this renderer uses parameter props (renderParamInput, etc.) */
  usesParameterProps: boolean;

  /** Whether the component is lazy-loaded */
  isLazy: boolean;
}
