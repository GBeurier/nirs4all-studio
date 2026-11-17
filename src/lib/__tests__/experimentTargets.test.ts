import { describe, expect, it } from "vitest";

import {
  ALL_TARGET_COLUMNS,
  buildTargetByDataset,
  missingTargetCounts,
  resolveExperimentTargets,
} from "../experimentTargets";
import type { Dataset, DatasetConfig, TargetConfig } from "@/types/datasets";

function dataset(id: string, targets: TargetConfig[], overrides: Partial<Dataset> = {}): Dataset {
  return {
    id,
    name: `Dataset ${id}`,
    path: `/data/${id}`,
    linked_at: "2026-11-17T10:00:00Z",
    config: {} as DatasetConfig,
    targets,
    num_samples: 150,
    ...overrides,
  };
}

const single = dataset("single", [{ column: "protein", type: "regression", missing_count: 11 }], { default_target: "protein" });
const several = dataset("several", [
  { column: "trait_01", type: "regression", missing_count: 0 },
  { column: "trait_03", type: "regression", missing_count: 30 },
  { column: "grade", type: "multiclass_classification" },
], { default_target: "trait_03" });

describe("resolveExperimentTargets", () => {
  it("asks only for datasets with several target columns and preselects their default target", () => {
    const options = resolveExperimentTargets({}, [single, several]);
    expect(options.map((option) => [option.datasetId, option.selected])).toEqual([["several", "trait_03"]]);
    expect(options[0].targets.map((target) => target.column)).toEqual(["trait_01", "trait_03", "grade"]);
    expect(buildTargetByDataset(options)).toEqual({ several: "trait_03" });
  });

  it("falls back to the first column when the saved default target is not a target column", () => {
    const stale = { ...several, default_target: "removed" };
    expect(resolveExperimentTargets({}, [stale])[0].selected).toBe("trait_01");
    expect(resolveExperimentTargets({}, [{ ...several, default_target: undefined }])[0].selected).toBe("trait_01");
  });

  it("keeps the user's column, ignores an unknown one, and sends nothing for all columns together", () => {
    expect(resolveExperimentTargets({ several: "grade" }, [several])[0].selected).toBe("grade");
    expect(resolveExperimentTargets({ several: "unknown" }, [several])[0].selected).toBe("trait_03");
    const together = resolveExperimentTargets({ several: ALL_TARGET_COLUMNS }, [several]);
    expect(together[0].selected).toBe(ALL_TARGET_COLUMNS);
    expect(buildTargetByDataset(together)).toEqual({});
  });

  it("offers no column choice for a linked multimodal cohort document", () => {
    const multimodal = { ...several, config: { dataset_document: {} } as unknown as DatasetConfig };
    expect(resolveExperimentTargets({}, [multimodal])).toEqual([]);
  });
});

describe("missingTargetCounts", () => {
  it("reports the samples without a value for the column each run trains on", () => {
    const options = resolveExperimentTargets({}, [single, several]);
    expect(missingTargetCounts(options, [single, several])).toEqual([
      { datasetId: "single", datasetName: "Dataset single", target: "protein", missing: 11, samples: 150 },
      { datasetId: "several", datasetName: "Dataset several", target: "trait_03", missing: 30, samples: 150 },
    ]);
  });

  it("reports nothing for a complete column, an unknown count or all columns together", () => {
    expect(missingTargetCounts(resolveExperimentTargets({ several: "trait_01" }, [several]), [several])).toEqual([]);
    expect(missingTargetCounts(resolveExperimentTargets({ several: "grade" }, [several]), [several])).toEqual([]);
    expect(missingTargetCounts(resolveExperimentTargets({ several: ALL_TARGET_COLUMNS }, [several]), [several])).toEqual([]);
  });
});
