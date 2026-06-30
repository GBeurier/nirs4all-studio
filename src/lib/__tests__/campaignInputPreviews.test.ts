import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildCampaignDatasetPreviews as buildCampaignDatasetPreviewsFromFacade,
  buildCampaignPipelinePreviews as buildCampaignPipelinePreviewsFromFacade,
  getCampaignPipelineSourceLabel as getCampaignPipelineSourceLabelFromFacade,
} from "../campaignInputPreviews";
import { buildCampaignDatasetPreviews } from "../campaignDatasetPreviews";
import {
  buildCampaignPipelinePreviews,
  getCampaignPipelineSourceLabel,
} from "../campaignPipelinePreviews";
import { buildDatasetSchemaRef } from "../datasetSchema";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";
import type { CampaignSpec } from "../campaignPlan";

function campaign(overrides: Partial<CampaignSpec> = {}): CampaignSpec {
  return {
    name: "Campaign",
    mode: "legacy_cartesian",
    executionBackend: "local-python",
    datasets: [],
    pipelines: [],
    runMatrix: [],
    ...overrides,
  };
}

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

describe("campaignInputPreviews", () => {
  it("keeps campaign input preview facade exports stable", () => {
    expect(buildCampaignDatasetPreviewsFromFacade).toBe(buildCampaignDatasetPreviews);
    expect(buildCampaignPipelinePreviewsFromFacade).toBe(buildCampaignPipelinePreviews);
    expect(getCampaignPipelineSourceLabelFromFacade).toBe(getCampaignPipelineSourceLabel);
  });

  it("builds dataset previews from legacy schema summaries", () => {
    const plan = campaign({
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
          splitGroupBy: null,
        },
      ],
    });

    expect(buildCampaignDatasetPreviews(plan)).toEqual([
      {
        id: "d1",
        label: "Corn",
        sampleCountLabel: "42 samples",
        featureCountLabel: "128 features",
        sourceCountLabel: "Unknown sources",
        sourceModeLabel: "Unknown source mode",
        representationCountLabel: "Unknown representations",
        dataViewLabel: "Unknown data view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "1 target",
        targetLabel: "protein",
        metadataColumnCountLabel: "2 metadata columns",
        repetitionLabel: "repetition: sample_id",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: "batch",
      },
      {
        id: "d2",
        label: "d2",
        sampleCountLabel: "Unknown samples",
        featureCountLabel: "Unknown features",
        sourceCountLabel: "Unknown sources",
        sourceModeLabel: "Unknown source mode",
        representationCountLabel: "Unknown representations",
        dataViewLabel: "Unknown data view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "Unknown targets",
        targetLabel: "Unknown target",
        metadataColumnCountLabel: "Unknown metadata columns",
        repetitionLabel: "No repetition column",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: null,
      },
    ]);
  });

  it("builds richer dataset previews from schema refs", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const plan = campaign({
      datasets: [
        {
          id: "d1",
          schemaRef,
          splitGroupBy: "batch",
        },
      ],
    });

    expect(buildCampaignDatasetPreviews(plan)).toEqual([
      {
        id: "d1",
        label: "Corn",
        sampleCountLabel: "42 samples",
        featureCountLabel: "128 features",
        sourceCountLabel: "2 sources",
        sourceModeLabel: "multi-source",
        representationCountLabel: "4 representations",
        dataViewLabel: "Default spectral view",
        dataViewTaskLabel: "unknown task",
        targetCountLabel: "1 target",
        targetLabel: "protein",
        metadataColumnCountLabel: "1 metadata column",
        repetitionLabel: "repetition: sample_id",
        aggregationLabel: "No aggregation configured",
        aggregationSourceLabel: null,
        splitGroupBy: "batch",
      },
    ]);
  });

  it("shows dataset aggregation previews from schema refs", () => {
    const schemaRef = buildDatasetSchemaRef(dataset({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        repetition: "sample_id",
        aggregation: {
          enabled: true,
          column: "sample_id",
          method: "median",
        },
      },
    }));
    const plan = campaign({
      datasets: [
        {
          id: "d1",
          schemaRef,
          splitGroupBy: "batch",
        },
      ],
    });

    expect(buildCampaignDatasetPreviews(plan)[0]).toMatchObject({
      repetitionLabel: "repetition: sample_id",
      aggregationLabel: "aggregation: median by sample_id",
      aggregationSourceLabel: "aggregation source: dataset config",
    });
  });

  it("labels campaign pipeline sources", () => {
    expect(getCampaignPipelineSourceLabel("saved")).toBe("Saved pipeline");
    expect(getCampaignPipelineSourceLabel("inline")).toBe("Current editor");
    expect(getCampaignPipelineSourceLabel("inline-pruned")).toBe("Pruned inline");
  });

  it("builds pipeline previews from explicit summaries and graph specs", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        { id: "pre", name: "SNV", type: "preprocessing", params: {} },
        { id: "model", name: "PLS", type: "model", params: {} },
      ],
      { id: "p2", name: "Graph" },
    );
    const plan = campaign({
      pipelines: [
        {
          id: "p1",
          name: "Explicit",
          source: "saved",
          stepCount: 2,
          stepSummary: "SNV -> PLS",
        },
        {
          id: "p2",
          name: "Graph",
          source: "inline",
          graph,
        },
        {
          id: "p3",
          name: "Unknown",
          source: "inline-pruned",
        },
      ],
    });

    expect(buildCampaignPipelinePreviews(plan)).toEqual([
      {
        id: "p1",
        label: "Explicit",
        sourceLabel: "Saved pipeline",
        stepCountLabel: "2 steps",
        stepSummaryLabel: "SNV -> PLS",
        complexityLabels: [],
      },
      {
        id: "p2",
        label: "Graph",
        sourceLabel: "Current editor",
        stepCountLabel: "2 steps",
        stepSummaryLabel: "SNV \u2192 PLS",
        complexityLabels: [],
      },
      {
        id: "p3",
        label: "Unknown",
        sourceLabel: "Pruned inline",
        stepCountLabel: "Unknown steps",
        stepSummaryLabel: "Unknown steps",
        complexityLabels: [],
      },
    ]);
  });

  it("adds non-trivial pipeline complexity labels to campaign pipeline previews", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        {
          id: "augment",
          name: "Augment",
          type: "augmentation",
          params: {},
          generatorKind: "grid",
          stepGenerator: { strategy: "cartesian" },
          paramSweeps: { alpha: [0.1, 1] },
        },
        {
          id: "model",
          name: "PLS",
          type: "model",
          params: {},
          finetuneConfig: { enabled: true },
          refitConfig: { enabled: true },
        },
      ],
      { id: "p1", name: "Generated PLS" },
    );

    expect(buildCampaignPipelinePreviews(campaign({
      pipelines: [{ id: "p1", name: "Generated PLS", source: "saved", graph }],
    }))[0]).toMatchObject({
      complexityLabels: [
        "1 generator",
        "1 step generator",
        "1 parameter sweep",
        "1 finetune node",
        "1 refit node",
      ],
    });
  });
});
