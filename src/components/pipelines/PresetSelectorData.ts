import { buildCanonicalPreviewSteps } from "@/lib/canonicalPipelinePreview";
import {
  buildPipelinePreview,
  computePipelineStats,
  type PipelinePreviewNode,
  type PipelineStats,
} from "@/lib/pipelineStats";
import type { PipelinePreset, PipelinePresetVariantId } from "@/types/pipelines";

export type PresetComplexityKey = "starter" | "quick" | "balanced" | "heavy" | "exhaustive";

export type PresetComplexityMeta = {
  key: PresetComplexityKey;
  label: string;
  hint: string;
  description: string;
  chipClass: string;
  iconClass: string;
};

export type PresetPipelinePreview = {
  nodes: PipelinePreviewNode[];
  totalSteps: number;
  truncated: boolean;
};

export type PresetCardModel = {
  variants: PipelinePresetVariantId[];
  primaryVariant: PipelinePresetVariantId;
  pipeline: unknown[];
  editorSteps: unknown[];
  stats: PipelineStats;
  preview: PresetPipelinePreview;
  complexity: number;
  complexityMeta: PresetComplexityMeta;
  operatorCount: number;
  variantCount: number;
};

const PRESET_COMPLEXITY_META: Record<PresetComplexityKey, PresetComplexityMeta> = {
  starter: {
    key: "starter",
    label: "Starter",
    hint: "Fast baseline",
    description: "Small search space intended for quick validation and first-pass comparisons.",
    chipClass: "border-emerald-500/25 bg-emerald-500/[0.10] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/[0.12] dark:text-emerald-200",
    iconClass: "text-emerald-500 dark:text-emerald-300",
  },
  quick: {
    key: "quick",
    label: "Quick",
    hint: "Compact screening",
    description: "Still lightweight, but broad enough to compare a few meaningful alternatives.",
    chipClass: "border-sky-500/25 bg-sky-500/[0.10] text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/[0.12] dark:text-sky-200",
    iconClass: "text-sky-500 dark:text-sky-300",
  },
  balanced: {
    key: "balanced",
    label: "Balanced",
    hint: "Broader search",
    description: "A middle-ground preset with enough breadth to explore several preprocessing and model families.",
    chipClass: "border-amber-500/25 bg-amber-500/[0.10] text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/[0.12] dark:text-amber-200",
    iconClass: "text-amber-500 dark:text-amber-300",
  },
  heavy: {
    key: "heavy",
    label: "Heavy",
    hint: "Wide benchmark",
    description: "Larger cartesian spaces or heavier models. Expect noticeably longer benchmarking runs.",
    chipClass: "border-orange-500/25 bg-orange-500/[0.10] text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/[0.12] dark:text-orange-200",
    iconClass: "text-orange-500 dark:text-orange-300",
  },
  exhaustive: {
    key: "exhaustive",
    label: "Exhaustive",
    hint: "Long exploration",
    description: "Highest-complexity preset family for deep, slow exploration and exhaustive benchmarking.",
    chipClass: "border-rose-500/25 bg-rose-500/[0.10] text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/[0.12] dark:text-rose-200",
    iconClass: "text-rose-500 dark:text-rose-300",
  },
};

export function clampPresetComplexity(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 5;
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function getPresetComplexityKey(value: number | undefined): PresetComplexityKey {
  const complexity = clampPresetComplexity(value);
  if (complexity <= 2) return "starter";
  if (complexity <= 4) return "quick";
  if (complexity <= 6) return "balanced";
  if (complexity <= 8) return "heavy";
  return "exhaustive";
}

export function getPresetComplexityMeta(value: number | undefined): PresetComplexityMeta {
  return PRESET_COMPLEXITY_META[getPresetComplexityKey(value)];
}

export function getPresetVariants(preset: PipelinePreset): PipelinePresetVariantId[] {
  if (preset.available_variants?.length > 0) {
    return preset.available_variants;
  }
  if (preset.task_type) {
    return [preset.task_type];
  }
  return ["regression"];
}

export function getPresetPrimaryVariant(preset: PipelinePreset): PipelinePresetVariantId {
  return preset.default_variant ?? preset.task_type ?? getPresetVariants(preset)[0] ?? "regression";
}

export function getPresetPipeline(preset: PipelinePreset, variant: PipelinePresetVariantId): unknown[] {
  return preset.variants?.[variant]?.pipeline ?? preset.pipeline ?? [];
}

export function deriveEditorStepsFromPreset(
  preset: PipelinePreset,
  variant: PipelinePresetVariantId
): unknown[] {
  return buildCanonicalPreviewSteps(getPresetPipeline(preset, variant));
}

export function getPresetTaskColorKey(preset: PipelinePreset): string {
  return preset.task_type ?? "default";
}

export function buildPresetCardModel(
  preset: PipelinePreset,
  previewLimit = 5
): PresetCardModel {
  const variants = getPresetVariants(preset);
  const primaryVariant = getPresetPrimaryVariant(preset);
  const pipeline = getPresetPipeline(preset, primaryVariant);
  const editorSteps = buildCanonicalPreviewSteps(pipeline);
  const stats = computePipelineStats(editorSteps);
  const preview = buildPipelinePreview(editorSteps, previewLimit);
  const complexity = clampPresetComplexity(preset.complexity);

  return {
    variants,
    primaryVariant,
    pipeline,
    editorSteps,
    stats,
    preview,
    complexity,
    complexityMeta: getPresetComplexityMeta(complexity),
    operatorCount: stats.operators || preset.steps_count,
    variantCount: stats.hasGenerators ? stats.variants : 1,
  };
}
