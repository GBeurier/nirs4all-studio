import { describe, expect, it } from "vitest";

import {
  analyzeSelectedPipelinesRuntimeGrouping,
  evaluateDatasetRuntimeGrouping,
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
  getRuntimeGroupingSummary,
  RUNTIME_GROUPING_COPY,
} from "../runtimeSplitGrouping";

describe("runtimeSplitGrouping", () => {
  it("detects required and optional splitters across selected pipelines", () => {
    const selection = analyzeSelectedPipelinesRuntimeGrouping([
      {
        id: "pipeline-required",
        name: "Required",
        steps: [{ type: "splitting", name: "GroupKFold", params: { n_splits: 3 } }],
      },
      {
        id: "pipeline-optional",
        name: "Optional",
        steps: [{ type: "splitting", name: "KFold", params: { n_splits: 5 } }],
      },
    ]);

    expect(selection.hasSplitters).toBe(true);
    expect(selection.hasRequiredSplitters).toBe(true);
    expect(selection.hasOptionalSplitters).toBe(true);
    expect(selection.hasPersistedGroupConflict).toBe(false);
  });

  it("flags persisted splitter group parameters as a conflict", () => {
    const selection = analyzeSelectedPipelinesRuntimeGrouping([
      {
        id: "pipeline-conflict",
        name: "Conflict",
        steps: [{ type: "splitting", name: "KFold", params: { n_splits: 5, group_by: "batch" } }],
      },
    ]);

    expect(selection.hasPersistedGroupConflict).toBe(true);
    expect(selection.conflictingPipelines).toEqual([
      {
        id: "pipeline-conflict",
        name: "Conflict",
        steps: ["KFold"],
      },
    ]);
  });

  it("requires an explicit metadata group when required splitters have no repetition fallback", () => {
    const state = evaluateDatasetRuntimeGrouping(
      { metadata_columns: ["batch", "year"], repetitionColumn: null },
      {
        hasSplitters: true,
        hasRequiredSplitters: true,
        hasOptionalSplitters: false,
        hasPersistedGroupConflict: false,
        conflictingPipelines: [],
      },
      null,
    );

    expect(state.requiresExplicitGroup).toBe(true);
    expect(state.hasBlockingError).toBe(true);
    expect(state.blockingMessage).toBe(RUNTIME_GROUPING_COPY.requiredBlocking);
  });

  it("warns when repetition alone satisfies required grouping", () => {
    const state = evaluateDatasetRuntimeGrouping(
      {
        metadata_columns: ["batch", "year"],
        config: { repetition: "sample_id" },
      },
      {
        hasSplitters: true,
        hasRequiredSplitters: true,
        hasOptionalSplitters: false,
        hasPersistedGroupConflict: false,
        conflictingPipelines: [],
      },
      null,
    );

    expect(state.requiresExplicitGroup).toBe(false);
    expect(state.hasBlockingError).toBe(false);
    expect(state.repetitionColumn).toBe("sample_id");
    expect(state.repetitionOnlyWarning).toContain("configured dataset repetition");
  });

  it("warns when an explicit group will also propagate to optional splitters", () => {
    const state = evaluateDatasetRuntimeGrouping(
      {
        metadata_columns: ["batch", "year"],
        repetitionColumn: "sample_id",
      },
      {
        hasSplitters: true,
        hasRequiredSplitters: true,
        hasOptionalSplitters: true,
        hasPersistedGroupConflict: false,
        conflictingPipelines: [],
      },
      "batch",
    );

    expect(state.hasBlockingError).toBe(false);
    expect(state.selectedGroupBy).toBe("batch");
    expect(state.optionalPropagationWarning).toContain("do not strictly require");
  });

  it("builds explicit summaries for repetition plus runtime group_by", () => {
    expect(getRuntimeGroupingSummary("sample_id", "batch")).toBe(
      "Split constraints: sample_id + batch",
    );
    expect(getRuntimeGroupingSummary("sample_id", null)).toBe(
      "Dataset repetition only (sample_id)",
    );
  });

  it("describes runtime grouping as an additional split constraint", () => {
    expect(RUNTIME_GROUPING_COPY.additiveDescription).toContain("extra split constraint");
    expect(RUNTIME_GROUPING_COPY.additiveDescription).toContain("samples sharing the repetition value or the selected group_by value stay in the same fold");
  });

  it("normalizes metadata and repetition helpers from dataset payloads", () => {
    expect(getDatasetMetadataColumns({
      metadata_columns: ["batch", "", "batch", "year"],
    })).toEqual(["batch", "year"]);

    expect(getDatasetRepetitionColumn({
      config: {
        aggregation: { enabled: true, column: "sample_id", method: "mean" },
      },
    })).toBe("sample_id");
  });
});
