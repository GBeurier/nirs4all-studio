/**
 * Shared utilities for TreeNode components
 *
 * Centralized step icons and helper functions.
 * Uses subType for rendering distinctions within flow/utility types.
 */

import i18n from "i18next";
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
import type { StepType, StepSubType, FlowStepSubType, GeneratorKind, PipelineStep, ParameterSweep } from "../../types";
import { formatSweepDisplay, calculateStepVariants, getStepColor, CONTAINER_CHILDREN_SUBTYPES } from "../../types";

/**
 * Icons mapped to step types
 */
export const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  filter: Filter,
  augmentation: Zap,
  flow: GitBranch,
  utility: Sparkles,
};

/**
 * Icons mapped to sub-types (for finer distinction)
 */
export const stepSubTypeIcons: Record<StepSubType, typeof Waves> = {
  branch: GitBranch,
  merge: GitMerge,
  generator: Sparkles,
  sample_augmentation: Layers,
  feature_augmentation: FlaskConical,
  sample_filter: Filter,
  concat_transform: Combine,
  sequential: Layers,
  chart: LineChart,
  comment: MessageSquare,
};

/**
 * Get the appropriate icon for a step, considering subType.
 */
export function getStepIcon(step: PipelineStep): typeof Waves {
  if (step.subType && step.subType in stepSubTypeIcons) {
    return stepSubTypeIcons[step.subType];
  }
  return stepIcons[step.type];
}

/**
 * Check if a step type has children (not branches).
 * Uses subType for flow steps.
 */
export function hasChildren(step: PipelineStep): boolean {
  return isContainerStep(step) && (step.children?.length ?? 0) > 0;
}

/**
 * Check if a step is a container type (uses children, not branches).
 * Uses subType for flow steps.
 */
export function isContainerStep(step: PipelineStep): boolean {
  return step.subType !== undefined && CONTAINER_CHILDREN_SUBTYPES.includes(step.subType as FlowStepSubType);
}

/**
 * Get container label based on step subType
 */
export function getContainerChildLabel(step: PipelineStep): string {
  switch (step.subType) {
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
 * Check if step is a branch or generator (uses branches array).
 */
export function isBranchableStep(step: PipelineStep): boolean {
  return step.subType === "branch" || (
    step.subType === "generator" &&
    (step.branches?.length ?? 0) > 0
  );
}

/**
 * Get the label for branches based on step configuration
 */
export function getBranchLabel(step: PipelineStep): string {
  if (step.subType === "branch" && step.branchMode === "separation") {
    return i18n.t("pipelineEditor.tree.branchKinds.route");
  }
  if (step.subType === "generator") {
    return step.generatorKind === "cartesian" ? i18n.t("pipelineEditor.tree.branchKinds.stage")
      : step.generatorKind === "grid" || step.generatorKind === "zip" ? i18n.t("pipelineEditor.tree.branchKinds.param")
      : step.generatorKind === "chain" ? i18n.t("pipelineEditor.tree.branchKinds.config")
      : i18n.t("pipelineEditor.tree.branchKinds.option");
  }
  return i18n.t("pipelineEditor.tree.branchKinds.branch");
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
  const hasParamSweeps = !!(step.paramSweeps && Object.keys(step.paramSweeps).length > 0);
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
      const suffix = gen.values.length > 3 ? i18n.t("pipelineEditor.tree.totalSuffix", { count: gen.values.length }) : "";
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
 * Computed generator information for a generator step
 */
export interface GeneratorInfo {
  isGenerator: boolean;
  generatorKind: GeneratorKind | null;
  optionCount: number;
  variantCount: number;
  hasPickArrange: boolean;
  selectionSummary: string;
  optionNames: string[];
}

/**
 * Compute generator information for a step
 */
export function computeGeneratorInfo(step: PipelineStep): GeneratorInfo {
  if (step.subType !== "generator") {
    return {
      isGenerator: false,
      generatorKind: null,
      optionCount: 0,
      variantCount: 0,
      hasPickArrange: false,
      selectionSummary: "",
      optionNames: [],
    };
  }

  const generatorKind = step.generatorKind || "or";
  const branches = step.branches || [];
  const scalarEntries = step.scalarGeneratorConfig?.entries ?? [];
  const sampleConfig = step.scalarGeneratorConfig?.sample ?? {};
  const optionCount = generatorKind === "grid" || generatorKind === "zip"
    ? scalarEntries.length || branches.length
    : generatorKind === "sample"
      ? Number(sampleConfig.num) || 0
      : branches.length;
  const opts = step.generatorOptions || {};

  // Check if pick/arrange is configured
  const hasPickArrange = opts.pick !== undefined ||
    opts.arrange !== undefined ||
    opts.then_pick !== undefined ||
    opts.then_arrange !== undefined;

  const variantCount = calculateStepVariants(step);

  // Build selection summary
  const summaryParts: string[] = [];
  if (opts.pick !== undefined) {
    summaryParts.push(i18n.t("pipelineEditor.tree.gen.pick", { value: formatPickArrangeValue(opts.pick) }));
  }
  if (opts.arrange !== undefined) {
    summaryParts.push(i18n.t("pipelineEditor.tree.gen.arrange", { value: formatPickArrangeValue(opts.arrange) }));
  }
  if (opts.then_pick !== undefined) {
    summaryParts.push(i18n.t("pipelineEditor.tree.gen.thenPick", { value: formatPickArrangeValue(opts.then_pick) }));
  }
  if (opts.then_arrange !== undefined) {
    summaryParts.push(i18n.t("pipelineEditor.tree.gen.thenArrange", { value: formatPickArrangeValue(opts.then_arrange) }));
  }
  if (opts.count !== undefined) {
    summaryParts.push(i18n.t("pipelineEditor.tree.gen.limit", { value: opts.count }));
  }

  // Get option names from branches
  const optionNames = generatorKind === "grid" || generatorKind === "zip"
    ? scalarEntries.map((entry, idx) => {
        const prefix = generatorKind === "grid" || generatorKind === "zip" ? entry.key : i18n.t("pipelineEditor.tree.gen.optionN", { n: idx + 1 });
        return `${prefix} (${entry.values.length})`;
      })
    : generatorKind === "sample"
      ? [String(sampleConfig.distribution || i18n.t("pipelineEditor.tree.gen.distributionFallback"))]
      : branches.map((branch, idx) => {
          if (branch.length === 0) return i18n.t("pipelineEditor.tree.gen.optionEmpty", { n: idx + 1 });
          if (branch.length === 1) return branch[0].name;
          return i18n.t("pipelineEditor.tree.gen.plusMore", { name: branch[0].name, count: branch.length - 1 });
        });

  if (generatorKind === "sample" && sampleConfig.distribution) {
    summaryParts.unshift(i18n.t("pipelineEditor.tree.gen.distribution", { name: sampleConfig.distribution }));
  }

  return {
    isGenerator: true,
    generatorKind,
    optionCount,
    variantCount,
    hasPickArrange,
    selectionSummary: summaryParts.join(" -> ") || (
      generatorKind === "cartesian" || generatorKind === "grid" ? i18n.t("pipelineEditor.tree.gen.summary.combinations")
        : generatorKind === "zip" ? i18n.t("pipelineEditor.tree.gen.summary.parallel")
        : generatorKind === "chain" ? i18n.t("pipelineEditor.tree.gen.summary.ordered")
        : generatorKind === "sample" ? i18n.t("pipelineEditor.tree.gen.summary.sampled")
        : i18n.t("pipelineEditor.tree.gen.summary.tryEach")
    ),
    optionNames,
  };
}

// Helper: Format pick/arrange value for display
function formatPickArrangeValue(value: number | [number, number]): string {
  if (Array.isArray(value) && value.length === 2) {
    return `[${value[0]}-${value[1]}]`;
  }
  return String(value);
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
 * Get fold label based on step subType and children/branches
 */
export function getFoldLabel(step: PipelineStep, childLabel: string): string {
  const isBranchable = isBranchableStep(step);
  const isContainer = isContainerStep(step);
  const containerChildren = step.children ?? [];

  if (isBranchable) {
    const count = step.branches?.length ?? 0;
    const label = step.subType === "generator"
      ? (step.generatorKind === "cartesian" ? "stages"
        : step.generatorKind === "grid" || step.generatorKind === "zip" ? "params"
        : step.generatorKind === "chain" ? "configs"
        : "options")
      : step.branchMode === "separation" ? "routes" : "branches";
    return i18n.t(`pipelineEditor.tree.foldLabels.${label}`, { count });
  }
  if (isContainer) {
    return i18n.t("pipelineEditor.tree.foldLabels.children", {
      count: containerChildren.length,
      noun: i18n.t(`pipelineEditor.tree.childKind_${childLabel}`, { count: containerChildren.length }),
    });
  }
  return "";
}
