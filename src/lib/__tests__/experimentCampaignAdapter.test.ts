import { describe, expect, it } from "vitest";

import type { PipelineInfo } from "@/api/pipelines";
import type { Dataset } from "@/types/datasets";
import { DATASET_SCHEMA_REF_VERSION } from "@/lib/datasetSchema";
import {
  buildExperimentCampaignSpec,
  getPlannedRunCount,
  getSelectedGroupingPayload,
} from "@/lib/experimentCampaignAdapter";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import { CURRENT_EDITED_PIPELINE_ID } from "@/lib/experimentPipelineSelection";

function pipeline(overrides: Partial<PipelineInfo> = {}): PipelineInfo {
  return {
    id: "pipe-1",
    name: "PLS Pipeline",
    category: "custom",
    steps: [
      { id: "pre", name: "SNV", type: "preprocessing", params: {} },
      { id: "model", name: "PLS", type: "model", params: {} },
    ],
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "dataset-1",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    default_target: "protein",
    metadata_columns: ["fold", "batch"],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

describe("experimentCampaignAdapter", () => {
  it("builds the current cartesian run count and grouping payload explicitly", () => {
    expect(getPlannedRunCount(["d1", "d2"], ["p1", "p2", "p3"])).toBe(6);
    expect(getSelectedGroupingPayload(["d1", "d2"], { d1: "batch" })).toEqual({
      d1: "batch",
      d2: null,
    });
  });

  it("builds an explicit campaign spec for the selected experiment matrix", () => {
    const datasetById = new Map([
      ["d1", toExperimentDatasetOption(dataset({ id: "d1", name: "Corn" }))],
      ["d2", toExperimentDatasetOption(dataset({ id: "d2", name: "Wheat" }))],
    ]);
    const campaign = buildExperimentCampaignSpec({
      name: "Experiment",
      selectedDatasetIds: ["d1", "d2"],
      datasetById,
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
        { id: CURRENT_EDITED_PIPELINE_ID, name: "Draft", steps: [{ id: "draft" }] },
      ],
      selectedGroupingPayload: { d1: "batch", d2: null },
    });

    expect(campaign).toMatchObject({
      name: "Experiment",
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets: [
        {
          id: "d1",
          name: "Corn",
          schema: {
            sampleCount: 42,
            featureCount: 128,
            targetLabel: "protein",
            metadataColumnCount: 2,
            repetitionColumn: "sample_id",
          },
          splitGroupBy: "batch",
        },
        {
          id: "d2",
          name: "Wheat",
          schema: {
            sampleCount: 42,
            featureCount: 128,
            targetLabel: "protein",
            metadataColumnCount: 2,
            repetitionColumn: "sample_id",
          },
          splitGroupBy: null,
        },
      ],
      pipelines: [
        {
          id: "pipe-1",
          name: "PLS Pipeline",
          source: "saved",
          stepCount: 2,
          stepSummary: "SNV \u2192 PLS",
          graph: {
            id: "pipe-1",
            name: "PLS Pipeline",
            version: "studio.pipeline-graph.v1",
            source: "legacy-editor",
            entryNodeIds: ["pre", "model"],
            stats: {
              nodeCount: 2,
              activeNodeCount: 2,
              disabledNodeCount: 0,
              topLevelNodeCount: 2,
              branchCount: 0,
              generatorCount: 0,
              maxDepth: 0,
            },
          },
        },
        {
          id: CURRENT_EDITED_PIPELINE_ID,
          name: "Draft",
          source: "inline",
          stepCount: 1,
          stepSummary: "draft",
          graph: {
            id: CURRENT_EDITED_PIPELINE_ID,
            name: "Draft",
            entryNodeIds: ["draft"],
            stats: {
              nodeCount: 1,
              activeNodeCount: 1,
              disabledNodeCount: 0,
              topLevelNodeCount: 1,
              branchCount: 0,
              generatorCount: 0,
              maxDepth: 0,
            },
          },
        },
      ],
    });
    expect(campaign.datasets[0].schemaRef).toMatchObject({
      id: "d1:schema",
      datasetId: "d1",
      version: DATASET_SCHEMA_REF_VERSION,
      defaultDataViewId: "d1:view:default",
    });
    expect(campaign.datasets[0].schemaRef?.representations.map((representation) => representation.kind)).toEqual([
      "spectra",
      "targets",
      "metadata",
      "grouping",
    ]);
    expect(campaign.runMatrix.map((entry) => entry.id)).toEqual([
      "d1::pipe-1",
      `d1::${CURRENT_EDITED_PIPELINE_ID}`,
      "d2::pipe-1",
      `d2::${CURRENT_EDITED_PIPELINE_ID}`,
    ]);
  });

  it("passes optional execution backends through campaign spec construction", () => {
    const campaign = buildExperimentCampaignSpec({
      name: "Cluster Experiment",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [{ id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps }],
      selectedGroupingPayload: { d1: null },
      executionBackend: "cluster",
    });

    expect(campaign.executionBackend).toBe("cluster");
    expect(campaign.runMatrix).toEqual([
      {
        id: "d1::pipe-1",
        datasetId: "d1",
        pipelineId: "pipe-1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: null,
      },
    ]);
  });
});
