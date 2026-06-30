import { describe, expect, it } from "vitest";

import {
  buildExperimentDatasetSearchText,
  buildExperimentPipelineSearchText,
  filterExperimentDatasets,
  filterExperimentPipelines,
} from "@/lib/experimentInputFilters";
import { toExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { Dataset } from "@/types/datasets";
import type { ExperimentPipelineOption } from "@/lib/experimentPipelineSelection";

function rawDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    num_features: 128,
    n_sources: 1,
    is_multi_source: false,
    default_target: "protein",
    metadata_columns: ["batch"],
    config: {
      delimiter: ",",
      decimal_separator: ".",
      has_header: true,
    },
    ...overrides,
  };
}

function datasetOption(
  id: string,
  name: string,
  overrides: Partial<ExperimentDatasetOption> = {},
): ExperimentDatasetOption {
  return {
    ...toExperimentDatasetOption(rawDataset({ id, name })),
    id,
    name,
    dataViewLabel: "Default spectral view",
    representationCount: 4,
    ...overrides,
  };
}

function pipelineOption(
  overrides: Partial<ExperimentPipelineOption> & Pick<ExperimentPipelineOption, "id" | "name">,
): ExperimentPipelineOption {
  return {
    preset: false,
    favorite: false,
    steps: "",
    nodeCount: 0,
    activeNodeCount: 0,
    disabledNodeCount: 0,
    branchCount: 0,
    generatorCount: 0,
    stepGeneratorCount: 0,
    parameterSweepCount: 0,
    finetuneNodeCount: 0,
    refitNodeCount: 0,
    maxDepth: 0,
    ...overrides,
  };
}

describe("experimentInputFilters", () => {
  it("builds searchable dataset and pipeline text from selection details", () => {
    expect(buildExperimentDatasetSearchText({
      ...datasetOption("d1", "Corn"),
      sourceCount: 2,
      isMultiSource: true,
      dataViewTaskType: "regression",
      target: "moisture",
      targetCount: 2,
      metadataColumns: ["batch", "operator"],
      repetitionColumn: "scan_id",
      aggregationLabel: "Aggregation: median by scan_id",
    })).toContain("multi-source");
    expect(buildExperimentDatasetSearchText({
      ...datasetOption("d1", "Corn"),
      sourceCount: 2,
      isMultiSource: true,
      dataViewTaskType: "regression",
      target: "moisture",
      targetCount: 2,
      metadataColumns: ["batch", "operator"],
      repetitionColumn: "scan_id",
      aggregationLabel: "Aggregation: median by scan_id",
    })).toContain("moisture");
    expect(buildExperimentPipelineSearchText(pipelineOption({
      id: "p1",
      name: "Generated",
      steps: "Augment -> PLS",
      nodeCount: 3,
      activeNodeCount: 2,
      disabledNodeCount: 1,
      parameterSweepCount: 1,
      refitNodeCount: 1,
    }))).toContain("graph has disabled nodes");
  });

  it("filters datasets by trimmed case-insensitive selection detail search", () => {
    const datasets: ExperimentDatasetOption[] = [
      datasetOption("d1", "Corn"),
      datasetOption("d2", "Winter Wheat", {
        target: "moisture",
        dataViewTaskType: "regression",
        isMultiSource: true,
      }),
    ];

    expect(filterExperimentDatasets(datasets, "  WHE  ").map((entry) => entry.id)).toEqual(["d2"]);
    expect(filterExperimentDatasets(datasets, "moisture").map((entry) => entry.id)).toEqual(["d2"]);
    expect(filterExperimentDatasets(datasets, "multi-source").map((entry) => entry.id)).toEqual(["d2"]);
    expect(filterExperimentDatasets(datasets, "regression").map((entry) => entry.id)).toEqual(["d2"]);
    expect(filterExperimentDatasets(datasets, "").map((entry) => entry.id)).toEqual(["d1", "d2"]);
  });

  it("filters pipelines by search and mode while keeping current editor entries searchable", () => {
    const pipelines = [
      pipelineOption({ id: "p1", name: "PLS", favorite: true, steps: "SNV -> PLS", nodeCount: 2, activeNodeCount: 2 }),
      pipelineOption({ id: "p2", name: "RF", preset: true, steps: "Random Forest", nodeCount: 2, activeNodeCount: 2, parameterSweepCount: 1 }),
      pipelineOption({ id: "current", name: "[Current] Draft", isCurrentEdited: true, steps: "Draft pipeline" }),
    ];

    expect(filterExperimentPipelines(pipelines, "forest", "all").map((entry) => entry.id)).toEqual(["p2"]);
    expect(filterExperimentPipelines(pipelines, "parameter sweep", "all").map((entry) => entry.id)).toEqual(["p2"]);
    expect(filterExperimentPipelines(pipelines, "graph ready", "all").map((entry) => entry.id)).toEqual(["p1", "p2"]);
    expect(filterExperimentPipelines(pipelines, "", "favorites").map((entry) => entry.id)).toEqual(["p1", "current"]);
    expect(filterExperimentPipelines(pipelines, "", "presets").map((entry) => entry.id)).toEqual(["p2", "current"]);
    expect(filterExperimentPipelines(pipelines, "draft", "favorites").map((entry) => entry.id)).toEqual(["current"]);
  });
});
