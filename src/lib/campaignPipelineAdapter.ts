import type {
  CampaignPipelineRef,
  CampaignPipelineSource,
} from "./campaignSpecTypes";
import {
  buildPipelineGraphSpecFromLegacySteps,
  summarizePipelineGraphSpec,
  type PipelineGraphSpec,
  type PipelineGraphSummary,
} from "./pipelineGraphSpec";

export interface CampaignPipelineStepsInput {
  id: string;
  name: string;
  source: CampaignPipelineSource;
  steps: unknown[];
}

export interface CampaignPipelineProjection {
  graph: PipelineGraphSpec;
  graphSummary: PipelineGraphSummary;
  stepCount: number;
  stepSummary: string;
}

export function buildCampaignPipelineProjection({
  id,
  name,
  steps,
}: Pick<CampaignPipelineStepsInput, "id" | "name" | "steps">): CampaignPipelineProjection {
  const graph = buildPipelineGraphSpecFromLegacySteps(steps, { id, name });
  const graphSummary = summarizePipelineGraphSpec(graph);

  return {
    graph,
    graphSummary,
    stepCount: graphSummary.topLevelNodeCount,
    stepSummary: graphSummary.stepSummary,
  };
}

export function summarizeCampaignPipelineSteps(steps: readonly unknown[] | null | undefined): string {
  if (!steps?.length) return "Empty pipeline";
  return buildCampaignPipelineProjection({
    id: "pipeline-preview",
    name: "Pipeline preview",
    steps: [...steps],
  }).stepSummary;
}

export function buildCampaignPipelineRefFromSteps({
  id,
  name,
  source,
  steps,
}: CampaignPipelineStepsInput): CampaignPipelineRef {
  const projection = buildCampaignPipelineProjection({ id, name, steps });

  return {
    id,
    name,
    source,
    ...(source === "saved" ? {} : { steps: [...steps] }),
    stepCount: projection.stepCount,
    stepSummary: projection.stepSummary,
    graph: projection.graph,
  };
}
