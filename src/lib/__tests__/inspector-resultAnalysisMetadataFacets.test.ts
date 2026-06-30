import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisMetadataFacetCounters,
  buildResultAnalysisMetadataFacets,
  formatResultAnalysisMetadataFacetKeyLabel,
  summarizeResultAnalysisMetadataFacet,
  summarizeResultAnalysisMetadataFacets,
  type ResultAnalysisMetadataFacet,
} from "@/lib/inspector/resultAnalysisMetadataFacets";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.1,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

function facetByKey(facets: readonly ResultAnalysisMetadataFacet[]): Map<string, ResultAnalysisMetadataFacet> {
  return new Map(facets.map(facet => [`${facet.kind}:${facet.key}`, facet]));
}

describe("result analysis metadata facets", () => {
  it("builds generic metadata and dimension facets with normalized counts", () => {
    const facets = buildResultAnalysisMetadataFacets([
      makeChain({
        chain_id: "chain-a",
        variant_params: {
          result_metadata: {
            target_name: " moisture ",
            backend: "dag-ml",
            content_address: "sha256:a",
            artifact_count: 3,
            refit: false,
            generator_choices: [{ node: "pls" }],
            dimensions: {
              repetition_policy: "aggregate",
              fold_index: 3,
              ignored_empty: "",
              ignored_nested: { source: "nested" },
            },
          },
        },
      }),
      makeChain({
        chain_id: "chain-b",
        variant_params: {
          result_metadata: {
            target_name: "moisture",
            backend: "sklearn",
            artifact_count: "3",
            refit: true,
            dimensions: {
              repetition_policy: "raw",
              fold_index: "3",
              ignored_list: ["a"],
            },
          },
        },
      }),
      makeChain({
        chain_id: "chain-c",
        variant_params: {
          result_metadata: {
            target_name: "protein",
            backend: "dag-ml",
          },
        },
      }),
      makeChain({ chain_id: "chain-d", variant_params: null }),
    ]);

    const byKey = facetByKey(facets);

    expect(byKey.get("metadata:target_name")).toEqual({
      kind: "metadata",
      key: "target_name",
      values: [
        { value: "moisture", count: 2 },
        { value: "protein", count: 1 },
      ],
    });
    expect(byKey.get("metadata:backend")).toEqual({
      kind: "metadata",
      key: "backend",
      values: [
        { value: "dag-ml", count: 2 },
        { value: "sklearn", count: 1 },
      ],
    });
    expect(byKey.get("metadata:artifact_count")).toEqual({
      kind: "metadata",
      key: "artifact_count",
      values: [{ value: "3", count: 2 }],
    });
    expect(byKey.get("metadata:refit")).toEqual({
      kind: "metadata",
      key: "refit",
      values: [
        { value: "false", count: 1 },
        { value: "true", count: 1 },
      ],
    });
    expect(byKey.get("dimension:fold_index")).toEqual({
      kind: "dimension",
      key: "fold_index",
      values: [{ value: "3", count: 2 }],
    });
    expect(byKey.get("dimension:repetition_policy")).toEqual({
      kind: "dimension",
      key: "repetition_policy",
      values: [
        { value: "aggregate", count: 1 },
        { value: "raw", count: 1 },
      ],
    });
    expect(byKey.has("metadata:dimensions")).toBe(false);
    expect(byKey.has("metadata:generator_choices")).toBe(false);
    expect(byKey.has("dimension:ignored_empty")).toBe(false);
    expect(byKey.has("dimension:ignored_nested")).toBe(false);
    expect(byKey.has("dimension:ignored_list")).toBe(false);
  });

  it("can build dimension-only facets", () => {
    const facets = buildResultAnalysisMetadataFacets([
      makeChain({
        variant_params: {
          result_metadata: {
            target_name: "moisture",
            dimensions: { source: "benchmark-a" },
          },
        },
      }),
    ], {
      includeMetadataFields: false,
    });

    expect(facets).toEqual([
      {
        kind: "dimension",
        key: "source",
        values: [{ value: "benchmark-a", count: 1 }],
      },
    ]);
  });

  it("formats facet key labels for UI summaries", () => {
    expect(formatResultAnalysisMetadataFacetKeyLabel("target_name")).toBe("Target Name");
    expect(formatResultAnalysisMetadataFacetKeyLabel("fold-index")).toBe("Fold Index");
    expect(formatResultAnalysisMetadataFacetKeyLabel("  backend source ")).toBe("Backend Source");
    expect(formatResultAnalysisMetadataFacetKeyLabel("__")).toBe("__");
  });

  it("summarizes metadata facets with unique and total value counts", () => {
    const facet: ResultAnalysisMetadataFacet = {
      kind: "metadata",
      key: "target_name",
      values: [
        { value: "moisture", count: 3 },
        { value: "protein", count: 2 },
      ],
    };

    expect(summarizeResultAnalysisMetadataFacet(facet)).toEqual({
      kind: "metadata",
      key: "target_name",
      label: "Target Name",
      valueCount: 2,
      totalValueCount: 5,
    });
  });

  it("summarizes facet lists without changing order", () => {
    const facets: ResultAnalysisMetadataFacet[] = [
      {
        kind: "metadata",
        key: "backend",
        values: [{ value: "dag-ml", count: 2 }],
      },
      {
        kind: "dimension",
        key: "fold_index",
        values: [
          { value: "0", count: 1 },
          { value: "1", count: 1 },
        ],
      },
    ];

    expect(summarizeResultAnalysisMetadataFacets(facets)).toEqual([
      {
        kind: "metadata",
        key: "backend",
        label: "Backend",
        valueCount: 1,
        totalValueCount: 2,
      },
      {
        kind: "dimension",
        key: "fold_index",
        label: "Fold Index",
        valueCount: 2,
        totalValueCount: 2,
      },
    ]);
  });

  it("builds compact counters for inspector metadata badges", () => {
    const facets: ResultAnalysisMetadataFacet[] = [
      {
        kind: "metadata",
        key: "backend",
        values: [{ value: "dag-ml", count: 2 }],
      },
      {
        kind: "metadata",
        key: "target_name",
        values: [
          { value: "moisture", count: 1 },
          { value: "protein", count: 1 },
        ],
      },
      {
        kind: "dimension",
        key: "fold_index",
        values: [
          { value: "0", count: 1 },
          { value: "1", count: 1 },
        ],
      },
      {
        kind: "dimension",
        key: "repetition_policy",
        values: [{ value: "raw", count: 2 }],
      },
    ];

    expect(buildResultAnalysisMetadataFacetCounters(facets, { maxFacetCounters: 2 })).toEqual([
      {
        id: "metadata.facets",
        source: "metadata",
        label: "Metadata facets",
        value: 2,
        formattedValue: "2",
      },
      {
        id: "dimension.facets",
        source: "dimension",
        label: "Dimension facets",
        value: 2,
        formattedValue: "2",
      },
      {
        id: "summary.uniqueValues",
        source: "summary",
        label: "Facet values",
        value: 6,
        formattedValue: "6",
      },
      {
        id: "dimension:fold_index.values",
        source: "dimension",
        label: "Fold Index",
        value: 2,
        formattedValue: "2 values",
      },
      {
        id: "metadata:target_name.values",
        source: "metadata",
        label: "Target Name",
        value: 2,
        formattedValue: "2 values",
      },
    ]);
  });

  it("omits metadata counters when no facets are available", () => {
    expect(buildResultAnalysisMetadataFacetCounters([])).toEqual([]);
  });
});
