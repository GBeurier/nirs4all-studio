/**
 * StepConfigPanel - Refactored Thin Orchestrator
 *
 * This is the refactored version of StepConfigPanel that delegates
 * step-type-specific rendering to dedicated renderer components.
 *
 * The original 2,500+ line file has been reduced to ~350 lines by:
 * 1. Extracting step type renderers to config/step-renderers/
 * 2. Moving parameter input rendering to shared/useParamInput hook
 * 3. Using the useStepRenderer hook for renderer selection
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { Suspense, useCallback } from "react";
import {
  Waves,
  Shuffle,
  Target,
  GitBranch,
  GitMerge,
  Sparkles,
  Filter,
  Zap,
  BarChart3,
  Layers,
  Combine,
  LineChart,
  MessageSquare,
  Repeat,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  stepOptions,
  stepColors,
  type PipelineStep,
  type StepType,
  type ParameterSweep,
  calculateStepVariants,
} from "./types";
import { FinetuningBadge } from "./FinetuneConfig";
import { useStepRenderer } from "./config/step-renderers";
import { useParamInput } from "./shared/useParamInput";

// Step type icons mapping
const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  chart: LineChart,
  comment: MessageSquare,
};

export interface StepConfigPanelProps {
  step: PipelineStep | null;
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onSelectStep?: (id: string | null) => void;
  onAddChild?: (stepId: string) => void;
  onRemoveChild?: (stepId: string, childId: string) => void;
}

/**
 * StepConfigPanel - Main configuration panel for pipeline steps
 *
 * This is a thin orchestrator that:
 * 1. Renders the common header with step info
 * 2. Delegates step-specific content to the appropriate renderer
 * 3. Provides parameter input rendering with sweep support via useParamInput hook
 */
export function StepConfigPanel({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepConfigPanelProps) {
  // Empty state when no step selected
  if (!step) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-card">
        <div className="p-4 rounded-full bg-muted/50 mb-4">
          <GitBranch className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">No Step Selected</h3>
        <p className="text-sm text-muted-foreground max-w-[200px]">
          Select a step from the canvas or drag one from the palette to
          configure it
        </p>
      </div>
    );
  }

  // Get the appropriate renderer for this step type
  const { Renderer, usesParameterProps } = useStepRenderer(step.type);

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];
  const currentOption = stepOptions[step.type]?.find((o) => o.name === step.name);

  // Handlers for parameter operations
  const handleNameChange = useCallback(
    (name: string) => {
      const option = stepOptions[step.type]?.find((o) => o.name === name);
      if (option) {
        onUpdate(step.id, {
          name,
          params: { ...option.defaultParams },
        });
      }
    },
    [step.type, step.id, onUpdate]
  );

  const handleParamChange = useCallback(
    (key: string, value: string | number | boolean) => {
      onUpdate(step.id, {
        params: { ...step.params, [key]: value },
      });
    },
    [step.id, step.params, onUpdate]
  );

  const handleResetParams = useCallback(() => {
    if (currentOption) {
      onUpdate(step.id, {
        params: { ...currentOption.defaultParams },
        paramSweeps: undefined,
      });
    }
  }, [currentOption, step.id, onUpdate]);

  const handleSweepChange = useCallback(
    (key: string, sweep: ParameterSweep | undefined) => {
      const newSweeps = { ...(step.paramSweeps || {}) };
      if (sweep) {
        newSweeps[key] = sweep;
      } else {
        delete newSweeps[key];
      }
      onUpdate(step.id, {
        paramSweeps: Object.keys(newSweeps).length > 0 ? newSweeps : undefined,
      });
    },
    [step.paramSweeps, step.id, onUpdate]
  );

  // Use the extracted param input hook
  const { renderParamInput } = useParamInput({
    paramSweeps: step.paramSweeps,
    onParamChange: handleParamChange,
    onSweepChange: handleSweepChange,
  });

  // Calculate variant info for header
  const totalVariants = calculateStepVariants(step);
  const hasParamSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;
  const hasStepGenerator = !!step.stepGenerator;
  const hasSweeps = hasParamSweeps || hasStepGenerator;

  // Prepare renderer props based on whether it needs parameter props
  const baseProps = {
    step,
    onUpdate,
    onRemove,
    onDuplicate,
    onSelectStep,
    onAddChild,
    onRemoveChild,
    currentOption,
  };

  const parameterProps = usesParameterProps
    ? {
        ...baseProps,
        renderParamInput,
        handleNameChange,
        handleResetParams,
      }
    : baseProps;

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colors.bg} ${colors.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate">
              {step.name}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="secondary" className="text-xs capitalize">
                {step.type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {Object.keys(step.params).length} params
              </span>
              {hasSweeps && (
                <Badge className="text-xs bg-orange-500 hover:bg-orange-600">
                  <Repeat className="h-3 w-3 mr-1" />
                  {totalVariants} variants
                </Badge>
              )}
              <FinetuningBadge config={step.finetuneConfig} />
            </div>
          </div>
        </div>
      </div>

      {/* Content - Delegated to renderer */}
      <Suspense fallback={<RendererSkeleton />}>
        <Renderer {...parameterProps} />
      </Suspense>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

/**
 * Skeleton loading state for lazy-loaded renderers
 */
function RendererSkeleton() {
  return (
    <div className="flex-1 p-4 space-y-4 animate-pulse">
      <div className="h-10 bg-muted rounded" />
      <div className="h-8 bg-muted rounded w-3/4" />
      <div className="h-8 bg-muted rounded w-1/2" />
      <div className="h-8 bg-muted rounded w-2/3" />
    </div>
  );
}

// Export for backwards compatibility
export default StepConfigPanel;
