/**
 * Shared utilities for TreeNode components
 *
 * Centralized step icons and helper functions
 */

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
  FlaskConical,
  Combine,
  LineChart,
  MessageSquare,
} from "lucide-react";
import type { StepType, PipelineStep, ParameterSweep } from "../../types";
import { formatSweepDisplay, calculateStepVariants } from "../../types";

/**
 * Icons mapped to step types
 */
export const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
  sample_augmentation: Layers,
  feature_augmentation: FlaskConical,
  sample_filter: Filter,
  concat_transform: Combine,
  chart: LineChart,
  comment: MessageSquare,
};

/**
 * Container step types that have children (not branches)
 */
export const CONTAINER_TYPES: StepType[] = [
  "sample_augmentation",
  "feature_augmentation",
  "sample_filter",
  "concat_transform",
];

/**
 * Check if a step type has children (not branches)
 */
export function hasChildren(step: PipelineStep): boolean {
  return CONTAINER_TYPES.includes(step.type) && (step.children?.length ?? 0) > 0;
}

/**
 * Check if a step is a container type
 */
export function isContainerStep(step: PipelineStep): boolean {
  return CONTAINER_TYPES.includes(step.type);
}

/**
 * Get container label based on step type
 */
export function getContainerChildLabel(stepType: StepType): string {
  switch (stepType) {
    case "sample_augmentation":
      return "transformer";
    case "feature_augmentation":
      return "transform";
    case "sample_filter":
      return "filter";
    case "concat_transform":
      return "transform";
    default:
      return "child";
  }
}

/**
 * Check if step type is a branch or generator
 */
export function isBranchableStep(step: PipelineStep): boolean {
  return step.type === "branch" || step.type === "generator";
}

/**
 * Get the label for branches based on step configuration
 */
export function getBranchLabel(step: PipelineStep): string {
  if (step.type === "generator") {
    return step.generatorKind === "cartesian" ? "Stage" : "Option";
  }
  return "Branch";
}

// ============================================================================
// Sweep & Variant Display Utilities
// ============================================================================

/**
 * Computed sweep information for a step
 */
export interface SweepInfo {
  hasSweeps: boolean;
  hasParamSweeps: boolean;
  hasStepGenerator: boolean;
  totalVariants: number;
  sweepCount: number;
  sweepKeys: string[];
  sweepSummary: string;
}

/**
 * Compute sweep information for a step
 */
export function computeSweepInfo(step: PipelineStep): SweepInfo {
  const hasParamSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;
  const hasStepGenerator = !!step.stepGenerator;
  const hasSweeps = hasParamSweeps || hasStepGenerator;
  const totalVariants = calculateStepVariants(step);
  const sweepCount = (step.paramSweeps ? Object.keys(step.paramSweeps).length : 0) + (hasStepGenerator ? 1 : 0);
  const sweepKeys = step.paramSweeps ? Object.keys(step.paramSweeps) : [];

  // Build sweep summary for tooltip
  const sweepSummaryParts: string[] = [];
  if (step.stepGenerator) {
    const gen = step.stepGenerator;
    const paramName = gen.param || "value";
    if (gen.type === "_range_" && Array.isArray(gen.values)) {
      const [start, end, rangeStep = 1] = gen.values as number[];
      sweepSummaryParts.push(`${paramName}: range(${start}, ${end}, ${rangeStep})`);
    } else if (gen.type === "_log_range_" && Array.isArray(gen.values)) {
      const [start, end, count = 5] = gen.values as number[];
      sweepSummaryParts.push(`${paramName}: log_range(${start}, ${end}, ${count})`);
    } else if (gen.type === "_or_" && Array.isArray(gen.values)) {
      const choices = gen.values.slice(0, 3).join(", ");
      const suffix = gen.values.length > 3 ? `, ... (${gen.values.length} total)` : "";
      sweepSummaryParts.push(`${paramName}: [${choices}${suffix}]`);
    }
  }
  sweepKeys.forEach((k) => {
    const sweep = step.paramSweeps![k];
    sweepSummaryParts.push(`${k}: ${formatSweepDisplay(sweep)}`);
  });

  return {
    hasSweeps,
    hasParamSweeps,
    hasStepGenerator,
    totalVariants,
    sweepCount,
    sweepKeys,
    sweepSummary: sweepSummaryParts.join("\n"),
  };
}

/**
 * Computed finetuning information for a step
 */
export interface FinetuneInfo {
  hasFinetuning: boolean;
  finetuneTrials: number;
  finetuneParamCount: number;
}

/**
 * Compute finetuning information for a step
 */
export function computeFinetuneInfo(step: PipelineStep): FinetuneInfo {
  return {
    hasFinetuning: !!step.finetuneConfig?.enabled,
    finetuneTrials: step.finetuneConfig?.n_trials ?? 0,
    finetuneParamCount: step.finetuneConfig?.model_params?.length ?? 0,
  };
}

/**
 * Get display parameters (non-swept params, formatted)
 */
export function getDisplayParams(step: PipelineStep, sweepKeys: string[]): string {
  const paramEntries = Object.entries(step.params);
  return paramEntries
    .filter(([k]) => !sweepKeys.includes(k))
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

/**
 * Get fold label based on step type and children/branches
 */
export function getFoldLabel(step: PipelineStep, childLabel: string): string {
  const isBranchable = isBranchableStep(step);
  const isContainer = isContainerStep(step);
  const containerChildren = step.children ?? [];

  if (isBranchable) {
    const count = step.branches?.length ?? 0;
    const label = step.type === "generator"
      ? (step.generatorKind === "cartesian" ? "stages" : "options")
      : "branches";
    return `${count} ${label}`;
  }
  if (isContainer) {
    return `${containerChildren.length} ${childLabel}${containerChildren.length !== 1 ? "s" : ""}`;
  }
  return "";
}
