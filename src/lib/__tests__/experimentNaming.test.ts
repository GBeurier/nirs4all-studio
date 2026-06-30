import { describe, expect, it } from "vitest";

import { buildAutoExperimentName } from "@/lib/experimentNaming";
import {
  CURRENT_EDITED_PIPELINE_ID,
  type ExperimentPipelineOption,
} from "@/lib/experimentPipelineSelection";

function pipelineOption(
  overrides: Partial<ExperimentPipelineOption> & Pick<ExperimentPipelineOption, "id" | "name">,
): ExperimentPipelineOption {
  return {
    favorite: false,
    preset: false,
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

const pipelines: ExperimentPipelineOption[] = [
  pipelineOption({
    id: "p1",
    name: "PLS",
    favorite: true,
    steps: "SNV -> PLS",
    nodeCount: 2,
    activeNodeCount: 2,
  }),
  pipelineOption({
    id: "p2",
    name: "Random Forest",
    preset: true,
    steps: "RF",
    nodeCount: 1,
    activeNodeCount: 1,
  }),
];

describe("experimentNaming", () => {
  it("builds compact auto names from selected dataset and saved pipeline labels", () => {
    expect(buildAutoExperimentName({
      selectedDatasetIds: ["d1", "d2"],
      selectedPipelineIds: ["p1"],
      datasetsById: new Map([
        ["d1", { name: "Corn" }],
        ["d2", { name: "Wheat" }],
      ]),
      pipelines,
      currentEditedPipeline: null,
    })).toBe("Corn_Whea x PLS");
  });

  it("uses the current edited pipeline name when selected", () => {
    expect(buildAutoExperimentName({
      selectedDatasetIds: ["d1"],
      selectedPipelineIds: [CURRENT_EDITED_PIPELINE_ID, "p2"],
      datasetsById: new Map([["d1", { name: "Corn" }]]),
      pipelines,
      currentEditedPipeline: {
        name: "Draft",
        steps: [],
        isDirty: true,
      },
    })).toBe("Corn x Draf_Rand");
  });

  it("returns an empty name until both dataset and pipeline labels are available", () => {
    expect(buildAutoExperimentName({
      selectedDatasetIds: ["missing"],
      selectedPipelineIds: ["p1"],
      datasetsById: new Map(),
      pipelines,
      currentEditedPipeline: null,
    })).toBe("");
    expect(buildAutoExperimentName({
      selectedDatasetIds: ["d1"],
      selectedPipelineIds: ["missing"],
      datasetsById: new Map([["d1", { name: "Corn" }]]),
      pipelines,
      currentEditedPipeline: null,
    })).toBe("");
  });
});
