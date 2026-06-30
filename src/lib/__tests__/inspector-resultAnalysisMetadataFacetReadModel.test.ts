import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisMetadataFacetItems,
  buildResultAnalysisMetadataFacetQuery,
  buildResultAnalysisMetadataFacetReadModel,
} from "@/lib/inspector/resultAnalysisMetadataFacetReadModel";
import type { ResultAnalysisMetadataFacet } from "@/lib/inspector/resultAnalysisMetadataFacets";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline 1",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: [],
    source_index: null,
    metric: "r2",
    task_type: "regression",
    dataset_name: "Dataset 1",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.82,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("result analysis metadata facet read model", () => {
  it("builds sidebar-ready facet items with shared labels, sorted values, and limits", () => {
    const facets: ResultAnalysisMetadataFacet[] = [
      {
        kind: "metadata",
        key: "execution_backend",
        values: [
          { value: "sklearn", count: 1 },
          { value: "dag-ml", count: 3 },
          { value: "wasm", count: 2 },
        ],
      },
    ];

    expect(buildResultAnalysisMetadataFacetItems(facets, { valueLimit: 2 })).toEqual([
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
    ]);
  });

  it("builds result-analysis query filters from metadata facet selections", () => {
    expect(buildResultAnalysisMetadataFacetQuery([
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

  it("composes facets, items, query, and compact counters for a filtered scope", () => {
    const readModel = buildResultAnalysisMetadataFacetReadModel([
      makeChain({
        chain_id: "chain-1",
        variant_params: {
          result_metadata: {
            target_name: "moisture",
            backend: "dag-ml",
            dimensions: {
              fold_index: 0,
              repetition_policy: "raw",
            },
          },
        },
      }),
      makeChain({
        chain_id: "chain-2",
        variant_params: {
          result_metadata: {
            target_name: "protein",
            backend: "dag-ml",
            dimensions: {
              fold_index: 1,
              repetition_policy: "raw",
            },
          },
        },
      }),
    ], {
      itemOptions: { valueLimit: 1 },
      selections: [
        { kind: "metadata", key: "backend", values: ["dag-ml"] },
        { kind: "dimension", key: "fold_index", values: ["0", "1"] },
      ],
    });

    expect(readModel.facets.map(facet => `${facet.kind}:${facet.key}`)).toEqual([
      "metadata:backend",
      "metadata:target_name",
      "dimension:fold_index",
      "dimension:repetition_policy",
    ]);
    expect(readModel.items).toEqual([
      {
        id: "metadata:backend",
        kind: "metadata",
        key: "backend",
        label: "Backend",
        valueCount: 1,
        totalCount: 2,
        values: [{ id: "metadata:backend:dag-ml", label: "dag-ml", count: 2 }],
        hiddenValueCount: 0,
      },
      {
        id: "metadata:target_name",
        kind: "metadata",
        key: "target_name",
        label: "Target Name",
        valueCount: 2,
        totalCount: 2,
        values: [{ id: "metadata:target_name:moisture", label: "moisture", count: 1 }],
        hiddenValueCount: 1,
      },
      {
        id: "dimension:fold_index",
        kind: "dimension",
        key: "fold_index",
        label: "Fold Index",
        valueCount: 2,
        totalCount: 2,
        values: [{ id: "dimension:fold_index:0", label: "0", count: 1 }],
        hiddenValueCount: 1,
      },
      {
        id: "dimension:repetition_policy",
        kind: "dimension",
        key: "repetition_policy",
        label: "Repetition Policy",
        valueCount: 1,
        totalCount: 2,
        values: [{ id: "dimension:repetition_policy:raw", label: "raw", count: 2 }],
        hiddenValueCount: 0,
      },
    ]);
    expect(readModel.query).toEqual({
      resultMetadata: { backend: ["dag-ml"] },
      dimensions: { fold_index: ["0", "1"] },
    });
    expect(readModel.counters.map(counter => [counter.id, counter.formattedValue])).toEqual([
      ["metadata.facets", "2"],
      ["dimension.facets", "2"],
      ["summary.uniqueValues", "6"],
      ["dimension:fold_index.values", "2 values"],
      ["metadata:target_name.values", "2 values"],
      ["metadata:backend.values", "1 value"],
    ]);
  });
});
