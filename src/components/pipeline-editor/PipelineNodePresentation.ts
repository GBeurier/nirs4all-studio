import {
  Waves,
  Shuffle,
  Target,
  GitBranch,
  GitMerge,
  Sparkles,
  Filter,
  Layers,
  BarChart,
  Combine,
  LineChart,
  MessageSquare,
  Zap,
} from "lucide-react";
import { formatSweepDisplay } from "./stepFactory";
import { getStepColor } from "./stepPresentation";
import {
  type PipelineStep,
  type StepType,
  type StepSubType,
} from "./types";
import { calculateStepVariants } from "./variantCounting";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart,
  splitting: Shuffle,
  model: Target,
  filter: Filter,
  augmentation: Layers,
  flow: GitBranch,
  utility: Sparkles,
};

const stepSubTypeIcons: Record<StepSubType, typeof Waves> = {
  branch: GitBranch,
  merge: GitMerge,
  generator: Sparkles,
  sample_augmentation: Zap,
  feature_augmentation: Layers,
  sample_filter: Filter,
  concat_transform: Combine,
  sequential: Layers,
  chart: LineChart,
  comment: MessageSquare,
};

type StepIcon = typeof Waves;
type StepColors = ReturnType<typeof getStepColor>;

export interface PipelineNodePresentation {
  Icon: StepIcon;
  colors: StepColors;
  hasSweeps: boolean;
  totalVariants: number;
  sweepCount: number;
  sweepSummary: string;
  displayParams: string;
  allParamsDisplay: string;
  generatorBranchLabel: string;
}

export function getPipelineNodePresentation(step: PipelineStep): PipelineNodePresentation {
  const Icon = getPipelineNodeIcon(step);
  const colors = getStepColor(step);
  const hasStepGenerator = !!step.stepGenerator;
  const sweepKeys = Object.keys(step.paramSweeps ?? {});
  const hasParamSweeps = sweepKeys.length > 0;
  const hasSweeps = hasParamSweeps || hasStepGenerator;
  const totalVariants = calculateStepVariants(step);
  const sweepCount = sweepKeys.length + (hasStepGenerator ? 1 : 0);
  const paramEntries = Object.entries(step.params);
  const displayParams = paramEntries
    .filter(([key]) => !sweepKeys.includes(key))
    .slice(0, 2)
    .map(formatParamEntry)
    .join(", ");
  const allParamsDisplay = paramEntries.map(formatParamEntry).join(", ");

  return {
    Icon,
    colors,
    hasSweeps,
    totalVariants,
    sweepCount,
    sweepSummary: buildSweepSummary(step, sweepKeys),
    displayParams,
    allParamsDisplay,
    generatorBranchLabel: getGeneratorBranchLabel(step),
  };
}

export function getPipelineNodeIcon(step: PipelineStep): StepIcon {
  if (step.subType && step.subType in stepSubTypeIcons) {
    return stepSubTypeIcons[step.subType];
  }

  return stepIcons[step.type];
}

function formatParamEntry([key, value]: [string, unknown]) {
  return `${key}=${value}`;
}

function buildSweepSummary(step: PipelineStep, sweepKeys: string[]) {
  const sweepSummaryParts: string[] = [];

  if (step.stepGenerator) {
    const generator = step.stepGenerator;
    const paramName = generator.param || "value";
    if (generator.type === "_range_" && Array.isArray(generator.values)) {
      const [start, end, rangeStep = 1] = generator.values as number[];
      sweepSummaryParts.push(`${paramName}: range(${start}, ${end}, ${rangeStep})`);
    } else if (generator.type === "_log_range_" && Array.isArray(generator.values)) {
      const [start, end, count = 5] = generator.values as number[];
      sweepSummaryParts.push(`${paramName}: log_range(${start}, ${end}, ${count})`);
    } else if (generator.type === "_or_" && Array.isArray(generator.values)) {
      const choices = generator.values.slice(0, 3).map(String).join(", ");
      const suffix = generator.values.length > 3 ? `, ... (${generator.values.length} total)` : "";
      sweepSummaryParts.push(`${paramName}: [${choices}${suffix}]`);
    }
  }

  sweepKeys.forEach((key) => {
    const sweep = step.paramSweeps?.[key];
    if (sweep) {
      sweepSummaryParts.push(`${key}: ${formatSweepDisplay(sweep)}`);
    }
  });

  return sweepSummaryParts.join("\n");
}

function getGeneratorBranchLabel(step: PipelineStep) {
  if (step.generatorKind === "cartesian") {
    return "Stage";
  }
  if (step.generatorKind === "grid" || step.generatorKind === "zip") {
    return "Param";
  }
  if (step.generatorKind === "chain") {
    return "Config";
  }
  return "Option";
}
