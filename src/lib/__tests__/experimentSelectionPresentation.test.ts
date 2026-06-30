import { describe, expect, it } from "vitest";

import { toExperimentDatasetOption } from "../experimentDatasetOptions";
import type { ExperimentDatasetOption } from "../experimentDatasetOptions";
import type { ExperimentPipelineOption } from "../experimentPipelineSelection";
import type { Dataset } from "@/types/datasets";
import {
  buildExperimentDatasetSelectionChipLabels,
  buildExperimentDatasetSelectionDetails,
  buildExperimentPipelineSelectionChipLabels,
  buildExperimentPipelineSelectionBadges,
  buildExperimentPipelineSelectionDetails,
  formatExperimentPipelineGraphReadiness,
  formatExperimentSelectionCount,
  formatNoExperimentDatasetSearchMatch,
  formatNoExperimentPipelineSearchMatch,
  getExperimentSelectionErrorMessage,
} from "../experimentSelectionPresentation";

function rawDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d1",
    name: "Corn",
    path: "/data/corn",
    linked_at: "2026-01-01T00:00:00",
    num_samples: 42,
    train_samples: 30,
    test_samples: 12,
    num_features: 128,
    n_sources: 2,
    is_multi_source: true,
    default_target: "protein",
    metadata_columns: ["batch", "operator"],
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
      targets: [
        { column: "protein", type: "regression" },
        { column: "moisture", type: "regression" },
      ],
    },
    ...overrides,
  };
}

function datasetOption(overrides: Partial<ExperimentDatasetOption> = {}): ExperimentDatasetOption {
  return {
    ...toExperimentDatasetOption(rawDataset()),
    representationCount: 4,
    dataViewLabel: "Default spectral view",
    dataViewTaskType: "regression",
    targetCount: 2,
    aggregationLabel: "Aggregation: mean by sample_id",
    ...overrides,
  };
}

function pipelineOption(overrides: Partial<ExperimentPipelineOption> = {}): ExperimentPipelineOption {
  return {
    id: "p1",
    name: "PLS",
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

describe("experimentSelectionPresentation", () => {
  it("formats shared selection and empty-search copy", () => {
    expect(formatExperimentSelectionCount(2)).toBe("2 selected");
    expect(formatNoExperimentDatasetSearchMatch("corn")).toBe('No datasets match "corn"');
    expect(formatNoExperimentPipelineSearchMatch("pls")).toBe('No pipelines match "pls"');
    expect(getExperimentSelectionErrorMessage(new Error("No access"), "fallback")).toBe("No access");
    expect(getExperimentSelectionErrorMessage("bad", "fallback")).toBe("fallback");
  });

  it("builds dataset card detail labels", () => {
    const dataset = datasetOption();

    const details = buildExperimentDatasetSelectionDetails(dataset);

    expect(details).toEqual({
      sampleLabel: "42 samples",
      splitLabel: "(30 train · 12 test)",
      featureLabel: "128 features",
      sourceLabel: "2 sources",
      sourceModeLabel: "multi-source",
      representationLabel: "4 representations",
      dataViewLabel: "View: Default spectral view",
      dataViewTaskLabel: "Task: regression",
      targetLabel: "Target: protein",
      targetCountLabel: "2 targets",
      metadataLabel: "Metadata: 2 columns",
      repetitionLabel: "Repetition: sample_id",
      aggregationLabel: "Aggregation: mean by sample_id",
    });
    expect(buildExperimentDatasetSelectionChipLabels(details)).toEqual([
      "2 sources",
      "multi-source",
      "4 representations",
      "View: Default spectral view",
      "Task: regression",
      "2 targets",
      "Metadata: 2 columns",
      "Repetition: sample_id",
      "Aggregation: mean by sample_id",
    ]);
  });

  it("handles sparse dataset card detail labels and pipeline badges", () => {
    const dataset = {
      ...datasetOption(),
      samples: 0,
      trainSamples: undefined,
      testSamples: undefined,
      features: 0,
      sourceCount: null,
      isMultiSource: undefined,
      representationCount: 0,
      dataViewLabel: "Unknown data view",
      dataViewTaskType: undefined,
      target: "Unknown",
      targetCount: undefined,
      metadataColumns: [],
      repetitionColumn: undefined,
      aggregationLabel: null,
    } as unknown as ExperimentDatasetOption;
    const pipeline = pipelineOption({
      preset: true,
      steps: "SNV \u2192 PLS",
      nodeCount: 2,
      activeNodeCount: 2,
    });

    const datasetDetails = buildExperimentDatasetSelectionDetails(dataset);
    const pipelineDetails = buildExperimentPipelineSelectionDetails(pipeline);

    expect(datasetDetails).toMatchObject({
      splitLabel: null,
      sourceLabel: "Unknown sources",
      sourceModeLabel: "Unknown source mode",
      representationLabel: "0 representations",
      dataViewTaskLabel: "Task: unknown task",
      targetCountLabel: "Unknown targets",
      metadataLabel: "Metadata: 0 columns",
      repetitionLabel: null,
      aggregationLabel: null,
    });
    expect(buildExperimentDatasetSelectionChipLabels(datasetDetails)).toEqual([
      "Unknown sources",
      "Unknown source mode",
      "0 representations",
      "View: Unknown data view",
      "Task: unknown task",
      "Unknown targets",
      "Metadata: 0 columns",
    ]);
    expect(buildExperimentPipelineSelectionBadges(pipeline)).toEqual({
      showFavorite: false,
      showPreset: true,
    });
    expect(pipelineDetails).toEqual({
      stepSummaryLabel: "SNV \u2192 PLS",
      graphReadinessLabel: "Graph ready",
      nodeLabel: "2 nodes",
      branchLabel: null,
      generatorLabel: null,
      depthLabel: null,
      complexityLabels: [],
    });
    expect(buildExperimentPipelineSelectionChipLabels(pipelineDetails)).toEqual([
      "Graph ready",
      "2 nodes",
    ]);
  });

  it("builds graph-aware pipeline card detail labels", () => {
    const pipeline = pipelineOption({
      steps: "Branch",
      nodeCount: 3,
      activeNodeCount: 2,
      disabledNodeCount: 1,
      branchCount: 1,
      generatorCount: 2,
      stepGeneratorCount: 1,
      parameterSweepCount: 1,
      finetuneNodeCount: 1,
      refitNodeCount: 1,
      maxDepth: 2,
    });

    const details = buildExperimentPipelineSelectionDetails(pipeline);

    expect(details).toEqual({
      stepSummaryLabel: "Branch",
      graphReadinessLabel: "Graph has disabled nodes",
      nodeLabel: "2/3 active nodes",
      branchLabel: "1 branch",
      generatorLabel: "2 generators",
      depthLabel: "Depth 3",
      complexityLabels: [
        "1 step generator",
        "1 parameter sweep",
        "1 finetune node",
        "1 refit node",
      ],
    });
    expect(buildExperimentPipelineSelectionChipLabels(details)).toEqual([
      "Graph has disabled nodes",
      "2/3 active nodes",
      "1 branch",
      "2 generators",
      "Depth 3",
      "1 step generator",
      "1 parameter sweep",
      "1 finetune node",
      "1 refit node",
    ]);
  });

  it("formats pipeline graph readiness labels", () => {
    expect(formatExperimentPipelineGraphReadiness({
      nodeCount: 0,
      activeNodeCount: 0,
      disabledNodeCount: 0,
    })).toBe("Empty graph");
    expect(formatExperimentPipelineGraphReadiness({
      nodeCount: 2,
      activeNodeCount: 0,
      disabledNodeCount: 2,
    })).toBe("No active nodes");
    expect(formatExperimentPipelineGraphReadiness({
      nodeCount: 3,
      activeNodeCount: 2,
      disabledNodeCount: 1,
    })).toBe("Graph has disabled nodes");
    expect(formatExperimentPipelineGraphReadiness({
      nodeCount: 2,
      activeNodeCount: 2,
      disabledNodeCount: 0,
    })).toBe("Graph ready");
  });
});
