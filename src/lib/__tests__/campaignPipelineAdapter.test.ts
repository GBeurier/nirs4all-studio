import { describe, expect, it } from "vitest";

import {
  buildCampaignPipelineProjection,
  buildCampaignPipelineRefFromSteps,
  summarizeCampaignPipelineSteps,
} from "../campaignPipelineAdapter";

const steps = [
  { id: "pre", name: "SNV", type: "preprocessing", params: {} },
  {
    id: "branch",
    name: "Branch",
    type: "flow",
    subType: "branch",
    branches: [
      [{ id: "pls", name: "PLS", type: "model", params: {} }],
      [{ id: "ridge", name: "Ridge", type: "model", params: {} }],
    ],
  },
];

describe("campaignPipelineAdapter", () => {
  it("summarizes legacy steps through the graph contract", () => {
    expect(summarizeCampaignPipelineSteps(steps)).toBe("SNV \u2192 Branch");
    expect(summarizeCampaignPipelineSteps([])).toBe("Empty pipeline");
    expect(summarizeCampaignPipelineSteps(null)).toBe("Empty pipeline");
  });

  it("builds a campaign pipeline projection with graph stats", () => {
    const projection = buildCampaignPipelineProjection({
      id: "pipe-1",
      name: "PLS Branch",
      steps,
    });

    expect(projection).toMatchObject({
      stepCount: 2,
      stepSummary: "SNV \u2192 Branch",
      graph: {
        id: "pipe-1",
        name: "PLS Branch",
        entryNodeIds: ["pre", "branch"],
        stats: {
          nodeCount: 4,
          activeNodeCount: 4,
          topLevelNodeCount: 2,
          branchCount: 2,
          maxDepth: 1,
        },
      },
      graphSummary: {
        nodeCount: 4,
        topLevelNodeCount: 2,
        branchCount: 2,
      },
    });
  });

  it("builds campaign pipeline refs without experiment-wizard state", () => {
    expect(buildCampaignPipelineRefFromSteps({
      id: "draft",
      name: "Draft",
      source: "inline",
      steps: [{ id: "nameless" }],
    })).toMatchObject({
      id: "draft",
      name: "Draft",
      source: "inline",
      steps: [{ id: "nameless" }],
      stepCount: 1,
      stepSummary: "nameless",
      graph: {
        id: "draft",
        entryNodeIds: ["nameless"],
      },
    });
  });

  it("carries steps only for executable inline campaign refs", () => {
    const inlineRef = buildCampaignPipelineRefFromSteps({
      id: "inline",
      name: "Inline",
      source: "inline",
      steps,
    });
    const prunedRef = buildCampaignPipelineRefFromSteps({
      id: "inline-pruned",
      name: "Inline pruned",
      source: "inline-pruned",
      steps,
    });
    const savedRef = buildCampaignPipelineRefFromSteps({
      id: "saved",
      name: "Saved",
      source: "saved",
      steps,
    });

    expect(inlineRef.steps).toEqual(steps);
    expect(prunedRef.steps).toEqual(steps);
    expect(savedRef).not.toHaveProperty("steps");
  });
});
