import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildCampaignCompatibilityPreviews as buildCampaignCompatibilityPreviewsFromFacade,
  buildDatasetPipelineCompatibilityPreview as buildDatasetPipelineCompatibilityPreviewFromFacade,
} from "../campaignCompatibility";
import {
  buildCampaignCompatibilityPreviews,
  buildDatasetPipelineCompatibilityPreview,
} from "../campaignCompatibilityPreviews";
import { buildDatasetSchemaRef } from "../datasetSchema";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";
import type { CampaignSpec } from "../campaignPlan";

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn.csv",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
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

describe("campaignCompatibility", () => {
  it("keeps compatibility facade preview builder exports stable", () => {
    expect(buildCampaignCompatibilityPreviewsFromFacade).toBe(buildCampaignCompatibilityPreviews);
    expect(buildDatasetPipelineCompatibilityPreviewFromFacade).toBe(buildDatasetPipelineCompatibilityPreview);
  });

  it("marks dataset/pipeline pairs ready when schema and graph previews are present", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        { id: "pre", name: "SNV", type: "preprocessing", params: {} },
        { id: "model", name: "PLS", type: "model", params: {} },
      ],
      { id: "p1", name: "PLS Pipeline" },
    );

    const preview = buildDatasetPipelineCompatibilityPreview({
      run: {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: "batch",
      },
      dataset: {
        id: "d1",
        name: "Corn",
        schemaRef,
        splitGroupBy: "batch",
      },
      pipeline: {
        id: "p1",
        name: "PLS Pipeline",
        source: "saved",
        graph,
      },
    });

    expect(preview).toMatchObject({
      id: "d1::p1",
      datasetLabel: "Corn",
      pipelineLabel: "PLS Pipeline",
      status: "passed",
      statusLabel: "Ready",
      summary: "Schema preview ready for this dataset/pipeline pair.",
      dataViewLabel: "Default spectral view",
      dataViewTaskLabel: "unknown task",
      targetLabel: "protein",
      targetCountLabel: "1 target",
      sourceCountLabel: "1 source",
      sourceModeLabel: "single-source",
      datasetAggregationLabel: "No aggregation configured",
      datasetAggregationSourceLabel: null,
      pipelineNodeCountLabel: "2 active nodes",
      transformationSizeLabel: "size: 42 samples x 128 features x 2 active nodes (~10,752 cells)",
      pipelineComplexityLabels: ["No refit, finetune, sweeps, or generators"],
    });
    expect(preview.checks.map((check) => check.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
    ]);
  });

  it("keeps legacy pairs non-evaluated when schema refs or graph specs are missing", () => {
    const preview = buildDatasetPipelineCompatibilityPreview({
      run: {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: null,
      },
      dataset: {
        id: "d1",
        name: "Corn",
        splitGroupBy: null,
      },
      pipeline: {
        id: "p1",
        name: "PLS Pipeline",
        source: "saved",
      },
    });

    expect(preview).toMatchObject({
      status: "not_evaluated",
      statusLabel: "Not evaluated",
      dataViewLabel: "Unknown data view",
      dataViewTaskLabel: "unknown task",
      targetLabel: "Unknown target",
      targetCountLabel: "Unknown targets",
      sourceCountLabel: "Unknown sources",
      sourceModeLabel: "Unknown source mode",
      datasetAggregationLabel: "No aggregation configured",
      datasetAggregationSourceLabel: null,
      pipelineNodeCountLabel: "Unknown active nodes",
      transformationSizeLabel: "Unknown transformation size",
      pipelineComplexityLabels: ["Unknown pipeline complexity"],
    });
    expect(preview.checks.map((check) => check.id)).toEqual([
      "dataset-schema-ref",
      "pipeline-graph-spec",
    ]);
  });

  it("summarizes pipeline refit, finetune, sweep, and generator complexity", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
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

    const preview = buildDatasetPipelineCompatibilityPreview({
      run: {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: null,
      },
      dataset: {
        id: "d1",
        name: "Corn",
        schemaRef,
        splitGroupBy: null,
      },
      pipeline: {
        id: "p1",
        name: "Generated PLS",
        source: "saved",
        graph,
      },
    });

    expect(preview.pipelineComplexityLabels).toEqual([
      "1 generator",
      "1 step generator",
      "1 parameter sweep",
      "1 finetune node",
      "1 refit node",
    ]);
  });

  it("surfaces dataset aggregation labels in pair previews", () => {
    const schemaRef = buildDatasetSchemaRef(dataset({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        repetition: "sample_id",
        aggregation: {
          enabled: true,
          column: "sample_id",
          method: "mean",
        },
      },
    }));
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [{ id: "model", name: "PLS", type: "model", params: {}, refitConfig: { enabled: true } }],
      { id: "p1", name: "Aggregated PLS" },
    );

    const preview = buildDatasetPipelineCompatibilityPreview({
      run: {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: null,
      },
      dataset: {
        id: "d1",
        name: "Corn",
        schemaRef,
        splitGroupBy: null,
      },
      pipeline: {
        id: "p1",
        name: "Aggregated PLS",
        source: "saved",
        graph,
      },
    });

    expect(preview.datasetAggregationLabel).toBe("aggregation: mean by sample_id");
    expect(preview.datasetAggregationSourceLabel).toBe("aggregation source: dataset config");
    expect(preview.checks.find((check) => check.id === "dataset-aggregation")).toEqual({
      id: "dataset-aggregation",
      status: "passed",
      title: "Dataset aggregation",
      message: "Aggregation uses mean by \"sample_id\" from dataset config.",
    });
    expect(preview.checks.find((check) => check.id === "refit-aggregation")).toEqual({
      id: "refit-aggregation",
      status: "passed",
      title: "Refit aggregation",
      message: "1 refit node will refit on aggregated dataset rows. Aggregation uses mean by \"sample_id\" from dataset config.",
    });
  });

  it("warns on legacy aggregation metadata in pair previews", () => {
    const schemaRef = buildDatasetSchemaRef(dataset({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        aggregate: "scan_group",
      },
    }));
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [{ id: "model", name: "PLS", type: "model", params: {}, refitConfig: { enabled: true } }],
      { id: "p1", name: "Legacy Aggregated PLS" },
    );

    const preview = buildDatasetPipelineCompatibilityPreview({
      run: {
        id: "d1::p1",
        datasetId: "d1",
        pipelineId: "p1",
        datasetIndex: 0,
        pipelineIndex: 0,
        splitGroupBy: null,
      },
      dataset: {
        id: "d1",
        name: "Corn",
        schemaRef,
        splitGroupBy: null,
      },
      pipeline: {
        id: "p1",
        name: "Legacy Aggregated PLS",
        source: "saved",
        graph,
      },
    });

    expect(preview.status).toBe("warning");
    expect(preview.datasetAggregationLabel).toBe("aggregation: unknown method by scan_group");
    expect(preview.datasetAggregationSourceLabel).toBe("aggregation source: legacy aggregate field");
    expect(preview.checks.find((check) => check.id === "dataset-aggregation")).toMatchObject({
      status: "warning",
      message: "Aggregation uses legacy aggregate field \"scan_group\" without an explicit method.",
    });
    expect(preview.checks.find((check) => check.id === "refit-aggregation")).toMatchObject({
      status: "warning",
      message: "1 refit node may refit with aggregation metadata that is not strict-mode ready. Aggregation uses legacy aggregate field \"scan_group\" without an explicit method.",
    });
  });

  it("surfaces warnings for schema-backed pairs that are not strict-mode ready", () => {
    const schemaRef = buildDatasetSchemaRef(dataset({
      num_features: undefined,
      default_target: undefined,
      targets: undefined,
    }));
    const graph = buildPipelineGraphSpecFromLegacySteps([], { id: "empty", name: "Empty" });
    const campaign: CampaignSpec = {
      name: "Sparse",
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets: [{ id: "d1", name: "Sparse", schemaRef, splitGroupBy: null }],
      pipelines: [{ id: "empty", name: "Empty", source: "inline", graph }],
      runMatrix: [
        {
          id: "d1::empty",
          datasetId: "d1",
          pipelineId: "empty",
          datasetIndex: 0,
          pipelineIndex: 0,
          splitGroupBy: null,
        },
      ],
    };

    const previews = buildCampaignCompatibilityPreviews(campaign);

    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({
      status: "warning",
      statusLabel: "Warning",
      targetLabel: "Unknown target",
      datasetAggregationLabel: "No aggregation configured",
      datasetAggregationSourceLabel: null,
      pipelineNodeCountLabel: "0 active nodes",
      transformationSizeLabel: "Unknown transformation size",
    });
    expect(previews[0].checks.filter((check) => check.status === "warning").map((check) => check.id)).toEqual([
      "feature-axis",
      "target",
      "pipeline-active-nodes",
    ]);
  });

  it("surfaces broken run matrix references even without schema or graph previews", () => {
    const campaign: CampaignSpec = {
      name: "Broken",
      mode: "legacy_cartesian",
      executionBackend: "local-python",
      datasets: [{ id: "d1", name: "Corn", splitGroupBy: null }],
      pipelines: [{ id: "p1", name: "PLS", source: "saved" }],
      runMatrix: [
        {
          id: "missing-dataset::p1",
          datasetId: "missing-dataset",
          pipelineId: "p1",
          datasetIndex: 0,
          pipelineIndex: 0,
          splitGroupBy: null,
        },
        {
          id: "d1::missing-pipeline",
          datasetId: "d1",
          pipelineId: "missing-pipeline",
          datasetIndex: 0,
          pipelineIndex: 1,
          splitGroupBy: null,
        },
        {
          id: "d1::p1",
          datasetId: "d1",
          pipelineId: "p1",
          datasetIndex: 0,
          pipelineIndex: 2,
          splitGroupBy: null,
        },
      ],
    };

    const previews = buildCampaignCompatibilityPreviews(campaign);

    expect(previews).toHaveLength(2);
    expect(previews.map((preview) => preview.id)).toEqual([
      "missing-dataset::p1",
      "d1::missing-pipeline",
    ]);
    expect(previews.map((preview) => preview.status)).toEqual(["blocking", "blocking"]);
    expect(previews[0].checks.map((check) => check.id)).toEqual([
      "dataset-ref",
      "pipeline-graph-spec",
    ]);
    expect(previews[1].checks.map((check) => check.id)).toEqual([
      "dataset-schema-ref",
      "pipeline-ref",
    ]);
  });
});
