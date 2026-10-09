import "@/lib/__tests__/support/experimentI18n";
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

  it("accepts groups embedded in a typed cohort for a group-required splitter", () => {
    const selection = {
      hasSplitters: true, hasRequiredSplitters: true, hasOptionalSplitters: false,
      hasPersistedGroupConflict: false, conflictingPipelines: [],
    };
    const dataset = {
      metadata_columns: [],
      config: { dataset_document: {
        schema: "nirs4all.studio-multimodal-dataset.v1",
        cohort: { schema: "nirs4all.multimodal-dataset", schema_version: 1,
          sample_ids: ["a", "b", "c"], groups: { shape: [3], values: ["g1", "g1", "g2"] } },
      } },
    };
    const state = evaluateDatasetRuntimeGrouping(dataset, selection, null);
    expect(state.embeddedGroups).toBe(true);
    expect(state.requiresExplicitGroup).toBe(false);
    expect(state.hasBlockingError).toBe(false);
    expect(evaluateDatasetRuntimeGrouping({ ...dataset, config: { dataset_document: {
      ...dataset.config.dataset_document,
      cohort: { ...dataset.config.dataset_document.cohort, groups: { shape: [2], values: ["g1"] } },
    } } }, selection, null).hasBlockingError).toBe(true);
  });

  it("keeps runtime group_by optional for optional splitters without repetition", () => {
    const state = evaluateDatasetRuntimeGrouping(
      { metadata_columns: ["batch", "year"], repetitionColumn: null },
      {
        hasSplitters: true,
        hasRequiredSplitters: false,
        hasOptionalSplitters: true,
        hasPersistedGroupConflict: false,
        conflictingPipelines: [],
      },
      null,
    );

    expect(state.requiresExplicitGroup).toBe(false);
    expect(state.hasBlockingError).toBe(false);
    expect(state.blockingMessage).toBeNull();
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
    expect(state.repetitionOnlyWarning).toContain("Repeated measurements will be kept together using 'sample_id'");
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
    expect(state.optionalPropagationWarning).toContain("will apply to all selected pipelines");
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
    expect(RUNTIME_GROUPING_COPY.additiveDescription).toContain("Keep related samples together during cross-validation");
    expect(RUNTIME_GROUPING_COPY.additiveDescription).toContain("Samples sharing a repetition identifier or the selected group stay in the same fold");
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
