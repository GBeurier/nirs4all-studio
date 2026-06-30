import { describe, expect, it } from "vitest";

import type { DatasetRuntimeGroupingState } from "../runtimeSplitGrouping";
import {
  formatRuntimeGroupingMetadataColumnCount,
  formatRuntimeGroupingSelectedDatasetCount,
  getRuntimeGroupingRequirementBadge,
} from "../runtimeGroupingPresentation";

const baseGroupingState: DatasetRuntimeGroupingState = {
  repetitionColumn: null,
  metadataColumns: [],
  selectedGroupBy: null,
  requiresExplicitGroup: false,
  hasBlockingError: false,
  blockingMessage: null,
  repetitionOnlyWarning: null,
  optionalPropagationWarning: null,
};

describe("runtimeGroupingPresentation", () => {
  it("formats selected dataset counts", () => {
    expect(formatRuntimeGroupingSelectedDatasetCount(1)).toBe("1 dataset");
    expect(formatRuntimeGroupingSelectedDatasetCount(2)).toBe("2 datasets");
  });

  it("formats metadata column counts", () => {
    expect(formatRuntimeGroupingMetadataColumnCount(0)).toBe("0 metadata columns");
    expect(formatRuntimeGroupingMetadataColumnCount(1)).toBe("1 metadata column");
    expect(formatRuntimeGroupingMetadataColumnCount(3)).toBe("3 metadata columns");
  });

  it("projects requirement badges from grouping state and selected splitters", () => {
    expect(getRuntimeGroupingRequirementBadge({
      ...baseGroupingState,
      requiresExplicitGroup: true,
    }, true)).toEqual({ label: "Required", variant: "destructive" });

    expect(getRuntimeGroupingRequirementBadge(baseGroupingState, true)).toEqual({
      label: "Optional with repetition",
      variant: "outline",
    });

    expect(getRuntimeGroupingRequirementBadge(baseGroupingState, false)).toEqual({
      label: "Optional",
      variant: "outline",
    });
  });
});
