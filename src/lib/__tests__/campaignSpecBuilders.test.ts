import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildCampaignDatasetRefs,
  buildLegacyCampaignRunMatrix,
  buildLegacyCampaignSpec,
  buildPairedCampaignRunMatrix,
  buildPairedCampaignSpec,
} from "../campaignSpecBuilders";
import { buildDatasetSchemaRef } from "../datasetSchema";
import type {
  CampaignDatasetRef,
  CampaignPipelineRef,
} from "../campaignPlan";

const datasets: CampaignDatasetRef[] = [
  { id: "d1", splitGroupBy: "batch" },
  { id: "d2", splitGroupBy: null },
];

const pipelines: CampaignPipelineRef[] = [
  { id: "p1", name: "PLS", source: "saved" },
  { id: "p2", name: "SVM", source: "inline" },
];

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn.csv",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    n_sources: 2,
    default_target: "protein",
    metadata_columns: ["batch"],
    targets: [{ column: "protein", type: "regression" }],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
      repetition: "sample_id",
    },
    ...overrides,
  };
}

describe("campaignSpecBuilders", () => {
  it("builds legacy cartesian run matrices", () => {
    expect(buildLegacyCampaignRunMatrix(datasets, pipelines)).toEqual([
      { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
      { id: "d1::p2", datasetId: "d1", pipelineId: "p2", datasetIndex: 0, pipelineIndex: 1, splitGroupBy: "batch" },
      { id: "d2::p1", datasetId: "d2", pipelineId: "p1", datasetIndex: 1, pipelineIndex: 0, splitGroupBy: null },
      { id: "d2::p2", datasetId: "d2", pipelineId: "p2", datasetIndex: 1, pipelineIndex: 1, splitGroupBy: null },
    ]);
  });

  it("builds paired run matrices by index", () => {
    expect(buildPairedCampaignRunMatrix(datasets, [pipelines[0]])).toEqual([
      { id: "d1::p1", datasetId: "d1", pipelineId: "p1", datasetIndex: 0, pipelineIndex: 0, splitGroupBy: "batch" },
    ]);
  });

  it("builds dataset refs from labels, legacy summaries, schema refs, and grouping payloads", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());

    expect(buildCampaignDatasetRefs({
      selectedDatasetIds: ["d1", "d2", "d3"],
      datasetLabelsById: { d1: "Corn Label" },
      datasetSchemasById: {
        d1: {
          sampleCount: 10,
          featureCount: 20,
          targetLabel: "moisture",
          metadataColumnCount: 0,
          repetitionColumn: null,
        },
      },
      datasetSchemaRefsById: { d2: schemaRef },
      selectedGroupingPayload: { d1: "batch", d2: "sample_id" },
    })).toEqual([
      {
        id: "d1",
        name: "Corn Label",
        schema: {
          sampleCount: 10,
          featureCount: 20,
          targetLabel: "moisture",
          metadataColumnCount: 0,
          repetitionColumn: null,
        },
        splitGroupBy: "batch",
      },
      {
        id: "d2",
        name: "Corn",
        schema: {
          sampleCount: 42,
          featureCount: 128,
          targetLabel: "protein",
          metadataColumnCount: 1,
          repetitionColumn: "sample_id",
        },
        schemaRef,
        splitGroupBy: "sample_id",
      },
      {
        id: "d3",
        splitGroupBy: null,
      },
    ]);
  });

  it("builds legacy and paired campaign specs with explicit run matrices", () => {
    const legacy = buildLegacyCampaignSpec({
      name: "Legacy",
      description: "",
      selectedDatasetIds: ["d1", "d2"],
      datasetLabelsById: { d1: "Corn", d2: "Wheat" },
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
      executionBackend: "cluster",
    });
    const paired = buildPairedCampaignSpec({
      name: "Paired",
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelines: pipelines,
      selectedGroupingPayload: { d1: "batch" },
    });

    expect(legacy).toMatchObject({
      name: "Legacy",
      description: undefined,
      mode: "legacy_cartesian",
      executionBackend: "cluster",
      runMatrix: [
        { id: "d1::p1", datasetId: "d1", pipelineId: "p1" },
        { id: "d1::p2", datasetId: "d1", pipelineId: "p2" },
        { id: "d2::p1", datasetId: "d2", pipelineId: "p1" },
        { id: "d2::p2", datasetId: "d2", pipelineId: "p2" },
      ],
    });
    expect(paired).toMatchObject({
      name: "Paired",
      mode: "paired_by_index",
      executionBackend: "local-python",
      runMatrix: [
        { id: "d1::p1", datasetId: "d1", pipelineId: "p1" },
        { id: "d2::p2", datasetId: "d2", pipelineId: "p2" },
      ],
    });
  });
});
