import i18n from "i18next";
import type { ExecutionBreakdown } from "./executionAnalysis";

export type ExecutionPreviewSeverity = "low" | "medium" | "high" | "extreme";

export function getFitsSeverity(fits: number): ExecutionPreviewSeverity {
  if (fits <= 100) return "low";
  if (fits <= 1000) return "medium";
  if (fits <= 10000) return "high";
  return "extreme";
}

export function getSeverityColor(severity: ExecutionPreviewSeverity): string {
  switch (severity) {
    case "low":
      return "text-emerald-500";
    case "medium":
      return "text-amber-500";
    case "high":
      return "text-orange-500";
    case "extreme":
      return "text-red-500";
  }
}

export function getComplexityLabel(severity: ExecutionPreviewSeverity): string {
  switch (severity) {
    case "low":
      return i18n.t("pipelineEditor.misc.complexity.low");
    case "medium":
      return i18n.t("pipelineEditor.misc.complexity.medium");
    case "high":
      return i18n.t("pipelineEditor.misc.complexity.high");
    case "extreme":
      return i18n.t("pipelineEditor.misc.complexity.extreme");
  }
}

export function estimateExecutionTime(fits: number): string {
  const seconds = fits;

  if (seconds < 60) return i18n.t("pipelineEditor.misc.time.seconds", { count: seconds });
  if (seconds < 3600) return i18n.t("pipelineEditor.misc.time.minutes", { count: Math.ceil(seconds / 60) });
  if (seconds < 86400) return i18n.t("pipelineEditor.misc.time.hours", { value: (seconds / 3600).toFixed(1) });
  return i18n.t("pipelineEditor.misc.time.days", { value: (seconds / 86400).toFixed(1) });
}

export function getExecutionProgressValue(totalFits: number): number {
  const maxLog = Math.log10(100000);
  const currentLog = Math.log10(Math.max(1, totalFits));
  return Math.min(100, (currentLog / maxLog) * 100);
}

export function generateExecutionSuggestions(breakdown: ExecutionBreakdown): string[] {
  const suggestions: string[] = [];

  if (breakdown.sweepVariants > 100 && breakdown.modelsWithFinetuning === 0) {
    suggestions.push(
      i18n.t("pipelineEditor.misc.suggestions.finetuning")
    );
  }

  if (breakdown.sweepVariants > 1000) {
    suggestions.push(
      i18n.t("pipelineEditor.misc.suggestions.reduceSweeps")
    );
  }

  if (breakdown.finetuningTrials > 100 && breakdown.sweepVariants > 1) {
    suggestions.push(
      i18n.t("pipelineEditor.misc.suggestions.reduceTrials")
    );
  }

  if (breakdown.cvFolds > 10) {
    suggestions.push(
      i18n.t("pipelineEditor.misc.suggestions.fewerFolds")
    );
  }

  if (breakdown.totalFits > 50000) {
    suggestions.push(
      i18n.t("pipelineEditor.misc.suggestions.subset")
    );
  }

  return suggestions;
}

export function buildExecutionFormula(breakdown: ExecutionBreakdown): string {
  const pipelineTerm = breakdown.totalPipelines > 1
    ? (() => {
      const pipelineParts: string[] = [];
      if (breakdown.sweepVariants > 1) pipelineParts.push(i18n.t("pipelineEditor.misc.formula.sweeps", { count: breakdown.sweepVariants }));
      if (breakdown.generatorVariants > 1) pipelineParts.push(i18n.t("pipelineEditor.misc.formula.generators", { count: breakdown.generatorVariants }));
      return pipelineParts.length > 0 ? pipelineParts.join(" × ") : i18n.t("pipelineEditor.misc.formula.pipelines", { count: breakdown.totalPipelines });
    })()
    : i18n.t("pipelineEditor.misc.formula.onePipeline");

  const fitTerm = i18n.t("pipelineEditor.misc.formula.fitsPerPipeline", { count: breakdown.cvFitsPerPipeline });
  const cvFormula = i18n.t("pipelineEditor.misc.formula.folds", { pipelines: pipelineTerm, fits: fitTerm, folds: breakdown.cvFolds });
  if (breakdown.refitModels > 0) {
    return i18n.t("pipelineEditor.misc.formula.refits", { formula: cvFormula, count: breakdown.refitModels });
  }
  return cvFormula;
}
