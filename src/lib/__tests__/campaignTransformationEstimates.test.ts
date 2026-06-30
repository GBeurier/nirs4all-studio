import { describe, expect, it } from "vitest";

import { buildCampaignTransformationEstimate } from "../campaignTransformationEstimates";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";

describe("campaignTransformationEstimates", () => {
  it("formats dataset and graph backed transformation-size estimates", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        { id: "pre", name: "SNV", type: "preprocessing", params: {} },
        { id: "model", name: "PLS", type: "model", params: {} },
      ],
      { id: "p1", name: "PLS" },
    );

    expect(buildCampaignTransformationEstimate({
      schemaRef: {
        sampleCount: 42,
        featureCount: 128,
        sourceCount: 2,
      },
      graph,
    })).toEqual({
      sampleCount: 42,
      featureCount: 128,
      sourceCount: 2,
      activeNodeCount: 2,
      estimatedCellCount: 10752,
      label: "size: 42 samples x 128 features x 2 active nodes across 2 sources (~10,752 cells)",
    });
  });

  it("prefers data-view dimensions over schema-level dimensions", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [{ id: "model", name: "PLS", type: "model", params: {} }],
      { id: "p1", name: "PLS" },
    );

    expect(buildCampaignTransformationEstimate({
      schemaRef: {
        sampleCount: 42,
        featureCount: 128,
        sourceCount: 2,
      },
      dataView: {
        sampleCount: 10,
        featureCount: 8,
        sourceCount: 1,
      },
      graph,
    }).label).toBe("size: 10 samples x 8 features x 1 active node (~80 cells)");
  });

  it("keeps unknown-size previews explicit when schema or graph dimensions are missing", () => {
    expect(buildCampaignTransformationEstimate({
      schemaRef: {
        sampleCount: 42,
        featureCount: null,
        sourceCount: null,
      },
      graph: null,
    })).toEqual({
      sampleCount: 42,
      featureCount: null,
      sourceCount: null,
      activeNodeCount: null,
      estimatedCellCount: null,
      label: "Unknown transformation size",
    });
  });
});
