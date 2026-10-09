import i18n from "i18next";

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
  noun: "generator" | "stepGenerator" | "parameterSweep" | "finetuneNode" | "refitNode",
): string {
  return i18n.t(`newExperiment.counts.${noun}`, { count });
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
      labels: [i18n.t("newExperiment.campaign.complexity.unknown")],
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
    labels.push(formatPipelineComplexityCount(stepGeneratorCount, "stepGenerator"));
  }
  if (parameterSweepCount > 0) {
    labels.push(formatPipelineComplexityCount(parameterSweepCount, "parameterSweep"));
  }
  if (finetuneNodeCount > 0) {
    labels.push(formatPipelineComplexityCount(finetuneNodeCount, "finetuneNode"));
  }
  if (refitNodeCount > 0) {
    labels.push(formatPipelineComplexityCount(refitNodeCount, "refitNode"));
  }

  return {
    generatorCount: graph.stats.generatorCount,
    stepGeneratorCount,
    parameterSweepCount,
    finetuneNodeCount,
    refitNodeCount,
    labels: labels.length > 0 ? labels : [i18n.t("newExperiment.campaign.complexity.none")],
  };
}
