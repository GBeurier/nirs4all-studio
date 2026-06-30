import { describe, expect, it } from "vitest";

import {
  buildInspectorSidebarMetadataFacetQuery,
  buildInspectorSidebarMetadataFacetItems,
  getInspectorSelectionSubtitle,
  getInspectorSidebarStatusLabel,
  isInspectorSelectAllDisabled,
} from "@/lib/inspector/sidebarState";

describe("inspector sidebar state", () => {
  it("derives the sidebar status label by priority", () => {
    expect(getInspectorSidebarStatusLabel({
      error: "Backend failed",
      isLoading: true,
      chainCount: 4,
    })).toBe("Error");
    expect(getInspectorSidebarStatusLabel({
      error: null,
      isLoading: true,
      chainCount: 4,
    })).toBe("Loading");
    expect(getInspectorSidebarStatusLabel({
      error: null,
      isLoading: false,
      chainCount: 0,
    })).toBe("No data");
    expect(getInspectorSidebarStatusLabel({
      error: null,
      isLoading: false,
      chainCount: 2,
    })).toBe("Ready");
  });

  it("describes the selection card from pinned count", () => {
    expect(getInspectorSelectionSubtitle(0)).toBe("active chains");
    expect(getInspectorSelectionSubtitle(3)).toBe("3 pinned");
  });

  it("keeps select-all disabled without available ids or when all chains are already selected", () => {
    expect(isInspectorSelectAllDisabled({
      availableChainCount: 0,
      selectedCount: 0,
      totalChains: 5,
    })).toBe(true);
    expect(isInspectorSelectAllDisabled({
      availableChainCount: 5,
      selectedCount: 5,
      totalChains: 5,
    })).toBe(true);
    expect(isInspectorSelectAllDisabled({
      availableChainCount: 3,
      selectedCount: 1,
      totalChains: 5,
    })).toBe(false);
  });

  it("builds sidebar-ready metadata facet items with stable labels and limits", () => {
    expect(buildInspectorSidebarMetadataFacetItems([
      {
        kind: "metadata",
        key: "execution_backend",
        values: [
          { value: "sklearn", count: 1 },
          { value: "dag-ml", count: 3 },
          { value: "wasm", count: 2 },
        ],
      },
      {
        kind: "dimension",
        key: "fold-index",
        values: [
          { value: "2", count: 1 },
          { value: "1", count: 1 },
        ],
      },
    ], { valueLimit: 2 })).toEqual([
      {
        id: "metadata:execution_backend",
        kind: "metadata",
        key: "execution_backend",
        label: "Execution Backend",
        valueCount: 3,
        totalCount: 6,
        values: [
          { id: "metadata:execution_backend:dag-ml", label: "dag-ml", count: 3 },
          { id: "metadata:execution_backend:wasm", label: "wasm", count: 2 },
        ],
        hiddenValueCount: 1,
      },
      {
        id: "dimension:fold-index",
        kind: "dimension",
        key: "fold-index",
        label: "Fold Index",
        valueCount: 2,
        totalCount: 2,
        values: [
          { id: "dimension:fold-index:1", label: "1", count: 1 },
          { id: "dimension:fold-index:2", label: "2", count: 1 },
        ],
        hiddenValueCount: 0,
      },
    ]);
  });

  it("allows hiding all sidebar facet values while preserving facet totals", () => {
    expect(buildInspectorSidebarMetadataFacetItems([
      {
        kind: "metadata",
        key: "target_name",
        values: [{ value: "moisture", count: 4 }],
      },
    ], { valueLimit: 0 })).toEqual([
      {
        id: "metadata:target_name",
        kind: "metadata",
        key: "target_name",
        label: "Target Name",
        valueCount: 1,
        totalCount: 4,
        values: [],
        hiddenValueCount: 1,
      },
    ]);
  });

  it("builds result-analysis query metadata filters from sidebar facet selections", () => {
    expect(buildInspectorSidebarMetadataFacetQuery([
      {
        kind: "metadata",
        key: "backend",
        values: ["dag-ml", " sklearn ", "dag-ml"],
      },
      {
        kind: "dimension",
        key: "source",
        values: ["benchmark-a", ""],
      },
      {
        kind: "metadata",
        key: "backend",
        values: ["wasm-local"],
      },
    ])).toEqual({
      resultMetadata: {
        backend: ["dag-ml", "sklearn", "wasm-local"],
      },
      dimensions: {
        source: ["benchmark-a"],
      },
    });
  });

  it("omits empty facet selections from result-analysis query filters", () => {
    expect(buildInspectorSidebarMetadataFacetQuery([
      { kind: "metadata", key: "backend", values: [] },
      { kind: "dimension", key: "source", values: [" "] },
    ])).toEqual({});
  });
});
