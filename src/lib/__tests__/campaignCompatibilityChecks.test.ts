import { describe, expect, it } from "vitest";

import type { Dataset } from "@/types/datasets";

import {
  buildDatasetPipelineCompatibilityChecks,
  formatCompatibilityCount,
  formatOptionalCompatibilityCount,
  getDatasetPipelineCompatibilityPreviewStatus,
  getDatasetPipelineCompatibilityPreviewSummary,
  getDatasetPipelineCompatibilityStatusLabel,
} from "../campaignCompatibilityChecks";
import { buildDatasetSchemaRef } from "../datasetSchema";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";
import type {
  CampaignDatasetRef,
  CampaignPipelineRef,
} from "../campaignPlan";

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

describe("campaignCompatibilityChecks", () => {
  it("formats counts and optional counts for compatibility preview copy", () => {
    expect(formatCompatibilityCount(1, "source")).toBe("1 source");
    expect(formatCompatibilityCount(2, "active node")).toBe("2 active nodes");
    expect(formatOptionalCompatibilityCount(undefined, "feature")).toBe("Unknown features");
    expect(formatOptionalCompatibilityCount(0, "feature")).toBe("0 features");
  });

  it("labels statuses and summarizes compatibility preview readiness", () => {
    expect(getDatasetPipelineCompatibilityStatusLabel("passed")).toBe("Ready");
    expect(getDatasetPipelineCompatibilityStatusLabel("warning")).toBe("Warning");
    expect(getDatasetPipelineCompatibilityStatusLabel("blocking")).toBe("Blocking");
    expect(getDatasetPipelineCompatibilityStatusLabel("not_evaluated")).toBe("Not evaluated");

    expect(getDatasetPipelineCompatibilityPreviewSummary("passed")).toBe("Schema preview ready for this dataset/pipeline pair.");
    expect(getDatasetPipelineCompatibilityPreviewSummary("warning")).toBe("Schema preview is available but has warnings for stricter execution modes.");
    expect(getDatasetPipelineCompatibilityPreviewSummary("blocking")).toBe("Campaign data is inconsistent and cannot be previewed safely.");
    expect(getDatasetPipelineCompatibilityPreviewSummary("not_evaluated")).toBe("Compatibility preview needs both a dataset schema ref and a pipeline graph spec.");
  });

  it("prioritizes blocking, warning, and not-evaluated checks before passed", () => {
    expect(getDatasetPipelineCompatibilityPreviewStatus([
      { id: "a", status: "passed", title: "A", message: "A" },
      { id: "b", status: "warning", title: "B", message: "B" },
      { id: "c", status: "blocking", title: "C", message: "C" },
    ])).toBe("blocking");
    expect(getDatasetPipelineCompatibilityPreviewStatus([
      { id: "a", status: "passed", title: "A", message: "A" },
      { id: "b", status: "warning", title: "B", message: "B" },
      { id: "c", status: "not_evaluated", title: "C", message: "C" },
    ])).toBe("warning");
    expect(getDatasetPipelineCompatibilityPreviewStatus([
      { id: "a", status: "passed", title: "A", message: "A" },
      { id: "b", status: "not_evaluated", title: "B", message: "B" },
    ])).toBe("not_evaluated");
    expect(getDatasetPipelineCompatibilityPreviewStatus([
      { id: "a", status: "passed", title: "A", message: "A" },
    ])).toBe("passed");
  });

  it("builds missing-ref and legacy not-evaluated checks", () => {
    const legacyDataset: CampaignDatasetRef = { id: "d1", name: "Corn", splitGroupBy: null };
    const legacyPipeline: CampaignPipelineRef = { id: "p1", name: "PLS", source: "saved" };

    expect(buildDatasetPipelineCompatibilityChecks({ pipeline: legacyPipeline }).map((check) => check.id)).toEqual([
      "dataset-ref",
      "pipeline-graph-spec",
    ]);
    expect(buildDatasetPipelineCompatibilityChecks({ dataset: legacyDataset, pipeline: legacyPipeline })).toEqual([
      {
        id: "dataset-schema-ref",
        status: "not_evaluated",
        title: "Dataset schema ref",
        message: "No dataset schema ref is attached to this campaign dataset.",
      },
      {
        id: "pipeline-graph-spec",
        status: "not_evaluated",
        title: "Pipeline graph spec",
        message: "No pipeline graph spec is attached to this campaign pipeline.",
      },
    ]);
  });

  it("builds strict schema/graph readiness checks", () => {
    const schemaRef = buildDatasetSchemaRef(dataset());
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        { id: "pre", name: "SNV", type: "preprocessing", params: {} },
        { id: "model", name: "PLS", type: "model", params: {} },
      ],
      { id: "p1", name: "PLS" },
    );
    const defaultDataView = schemaRef.dataViews.find((view) => view.id === schemaRef.defaultDataViewId);

    const checks = buildDatasetPipelineCompatibilityChecks({
      dataset: { id: "d1", name: "Corn", schemaRef, splitGroupBy: null },
      pipeline: { id: "p1", name: "PLS", source: "saved", graph },
      defaultDataView,
    });

    expect(checks.map((check) => check.id)).toEqual([
      "dataset-schema-ref",
      "pipeline-graph-spec",
      "data-view",
      "feature-axis",
      "target",
      "dataset-aggregation",
      "pipeline-active-nodes",
    ]);
    expect(checks.every((check) => check.status === "passed")).toBe(true);
  });

  it("warns when dataset aggregation is not strict-mode ready", () => {
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
      { id: "p1", name: "PLS" },
    );
    const defaultDataView = schemaRef.dataViews.find((view) => view.id === schemaRef.defaultDataViewId);

    const checks = buildDatasetPipelineCompatibilityChecks({
      dataset: { id: "d1", name: "Corn", schemaRef, splitGroupBy: null },
      pipeline: { id: "p1", name: "PLS", source: "saved", graph },
      defaultDataView,
    });
    const aggregationCheck = checks.find((check) => check.id === "dataset-aggregation");
    const refitAggregationCheck = checks.find((check) => check.id === "refit-aggregation");

    expect(aggregationCheck).toEqual({
      id: "dataset-aggregation",
      status: "warning",
      title: "Dataset aggregation",
      message: "Aggregation uses legacy aggregate field \"scan_group\" without an explicit method.",
    });
    expect(refitAggregationCheck).toEqual({
      id: "refit-aggregation",
      status: "warning",
      title: "Refit aggregation",
      message: "1 refit node may refit with aggregation metadata that is not strict-mode ready. Aggregation uses legacy aggregate field \"scan_group\" without an explicit method.",
    });
  });
});
