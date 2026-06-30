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
      return "Light";
    case "medium":
      return "Moderate";
    case "high":
      return "Heavy";
    case "extreme":
      return "Extreme";
  }
}

export function estimateExecutionTime(fits: number): string {
  const seconds = fits;

  if (seconds < 60) return `~${seconds}s`;
  if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
  if (seconds < 86400) return `~${(seconds / 3600).toFixed(1)} hours`;
  return `~${(seconds / 86400).toFixed(1)} days`;
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
      "Consider using Optuna finetuning instead of exhaustive grid search for faster optimization."
    );
  }

  if (breakdown.sweepVariants > 1000) {
    suggestions.push(
      "Reduce parameter sweep ranges or use coarser step sizes to limit combinations."
    );
  }

  if (breakdown.finetuningTrials > 100 && breakdown.sweepVariants > 1) {
    suggestions.push(
      "With many sweep variants, consider reducing Optuna trials per variant."
    );
  }

  if (breakdown.cvFolds > 10) {
    suggestions.push(
      "High CV fold count increases execution time. Consider 5-fold CV for faster iteration."
    );
  }

  if (breakdown.totalFits > 50000) {
    suggestions.push(
      "Consider using a subset of data for initial exploration, then full data for final model."
    );
  }

  return suggestions;
}

export function buildExecutionFormula(breakdown: ExecutionBreakdown): string {
  const pipelineTerm = breakdown.totalPipelines > 1
    ? (() => {
      const pipelineParts: string[] = [];
      if (breakdown.sweepVariants > 1) pipelineParts.push(`${breakdown.sweepVariants} sweeps`);
      if (breakdown.generatorVariants > 1) pipelineParts.push(`${breakdown.generatorVariants} generators`);
      return pipelineParts.length > 0 ? pipelineParts.join(" × ") : `${breakdown.totalPipelines} pipelines`;
    })()
    : "1 pipeline";

  const fitTerm = `${breakdown.cvFitsPerPipeline} fit${breakdown.cvFitsPerPipeline !== 1 ? "s" : ""}/pipeline`;
  const cvFormula = `${pipelineTerm} × ${fitTerm} × ${breakdown.cvFolds} folds`;
  if (breakdown.refitModels > 0) {
    return `${cvFormula} + ${breakdown.refitModels.toLocaleString()} refit${breakdown.refitModels !== 1 ? "s" : ""}`;
  }
  return cvFormula;
}
