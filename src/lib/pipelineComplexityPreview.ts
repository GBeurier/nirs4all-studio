import type { PipelineGraphSpec } from "./pipelineGraphSpec";

export interface PipelineComplexityPreview {
  generatorCount: number | null;
  stepGeneratorCount: number | null;
  parameterSweepCount: number | null;
  finetuneNodeCount: number | null;
  refitNodeCount: number | null;
  labels: string[];
}

function formatPipelineComplexityCount(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildPipelineComplexityPreview(
  graph: Pick<PipelineGraphSpec, "nodes" | "stats"> | null | undefined,
): PipelineComplexityPreview {
  if (!graph) {
    return {
      generatorCount: null,
      stepGeneratorCount: null,
      parameterSweepCount: null,
      finetuneNodeCount: null,
      refitNodeCount: null,
      labels: ["Unknown pipeline complexity"],
    };
  }

  const stepGeneratorCount = graph.nodes.filter((node) => node.hasStepGenerator).length;
  const parameterSweepCount = graph.nodes.filter((node) => node.hasParameterSweeps).length;
  const finetuneNodeCount = graph.nodes.filter((node) => node.hasFinetune).length;
  const refitNodeCount = graph.nodes.filter((node) => node.hasRefit).length;
  const labels: string[] = [];

  if (graph.stats.generatorCount > 0) {
    labels.push(formatPipelineComplexityCount(graph.stats.generatorCount, "generator"));
  }
  if (stepGeneratorCount > 0) {
    labels.push(formatPipelineComplexityCount(stepGeneratorCount, "step generator"));
  }
  if (parameterSweepCount > 0) {
    labels.push(formatPipelineComplexityCount(parameterSweepCount, "parameter sweep"));
  }
  if (finetuneNodeCount > 0) {
    labels.push(formatPipelineComplexityCount(finetuneNodeCount, "finetune node"));
  }
  if (refitNodeCount > 0) {
    labels.push(formatPipelineComplexityCount(refitNodeCount, "refit node"));
  }

  return {
    generatorCount: graph.stats.generatorCount,
    stepGeneratorCount,
    parameterSweepCount,
    finetuneNodeCount,
    refitNodeCount,
    labels: labels.length > 0 ? labels : ["No refit, finetune, sweeps, or generators"],
  };
}
