import { describe, expect, it } from "vitest";

import type { PipelineInfo } from "@/api/pipelines";
import { buildExperimentLaunchConfig } from "@/lib/experimentLaunchConfig";
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

describe("experimentLaunchConfig", () => {
  it("builds launch config with saved and current edited pipelines", () => {
    expect(buildExperimentLaunchConfig({
      name: "Experiment",
      description: "",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
        { id: CURRENT_EDITED_PIPELINE_ID, name: "Draft", steps: [{ id: "draft" }] },
      ],
      selectedGroupingPayload: { d1: null },
    })).toEqual({
      name: "Experiment",
      description: undefined,
      dataset_ids: ["d1"],
      pipeline_ids: ["pipe-1"],
      inline_pipeline: { name: "Draft", steps: [{ id: "draft" }] },
      inline_pipelines: [],
      split_group_by_by_dataset: { d1: null },
    });
  });

  it("only includes non-local execution backends in launch config", () => {
    expect(buildExperimentLaunchConfig({
      name: "Local",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: null },
      executionBackend: "local-python",
    })).not.toHaveProperty("execution_backend");

    expect(buildExperimentLaunchConfig({
      name: "Cluster",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: null },
      executionBackend: "cluster",
    })).toMatchObject({
      execution_backend: "cluster",
    });
  });

  it("includes explicit runtime engine and fallback policy when requested", () => {
    expect(buildExperimentLaunchConfig({
      name: "Runtime",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: null },
      runtimeEngine: " dag-ml ",
      allowFallback: true,
    })).toMatchObject({
      engine: "dag-ml",
      allow_fallback: true,
    });

    expect(buildExperimentLaunchConfig({
      name: "Strict",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: null },
      runtimeEngine: " ",
      allowFallback: false,
    })).toMatchObject({
      allow_fallback: false,
    });
  });

  it("converts pipelines with missing-node issues into pruned inline pipelines", () => {
    const config = buildExperimentLaunchConfig({
      name: "Experiment",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: "batch" },
      missingIssues: [
        {
          type: "missing_module",
          message: "SNV unavailable",
          details: { pipeline_id: "pipe-1", step_id: "pre" },
        },
      ],
    });

    expect(config.pipeline_ids).toEqual([]);
    expect(config.inline_pipeline).toMatchObject({
      name: "PLS Pipeline",
      steps: [{ id: "model", name: "PLS" }],
    });
    expect(config.split_group_by_by_dataset).toEqual({ d1: "batch" });
  });

  it("rejects launch configs that would prune a pipeline to empty", () => {
    expect(() => buildExperimentLaunchConfig({
      name: "Experiment",
      selectedDatasetIds: ["d1"],
      selectedPipelineConfigs: [
        { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
      ],
      selectedGroupingPayload: { d1: null },
      missingIssues: [
        {
          type: "missing_module",
          message: "SNV unavailable",
          details: { pipeline_id: "pipe-1", step_id: "pre" },
        },
        {
          type: "missing_module",
          message: "PLS unavailable",
          details: { pipeline_id: "pipe-1", step_id: "model" },
        },
      ],
    })).toThrow('Pipeline "PLS Pipeline" would be empty after removing unavailable nodes.');
  });
});
