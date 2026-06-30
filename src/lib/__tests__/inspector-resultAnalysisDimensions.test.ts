import { describe, expect, it } from "vitest";

import {
  getResultAnalysisAxisLabel,
  getResultAnalysisGroupLabel,
  getResultAnalysisMetadata,
  matchesResultAnalysisDimensions,
  matchesResultAnalysisMetadataFields,
  normalizedResultAnalysisString,
} from "@/lib/inspector/resultAnalysisDimensions";
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

describe("result analysis dimensions", () => {
  it("normalizes scalar display values and axis fallbacks", () => {
    expect(normalizedResultAnalysisString("  dag-ml  ")).toBe("dag-ml");
    expect(normalizedResultAnalysisString(null)).toBe("");
    expect(normalizedResultAnalysisString(42)).toBe("42");
    expect(getResultAnalysisAxisLabel(makeChain({ pipeline_name: "" }), "pipeline_name")).toBe("pipe-1");
    expect(getResultAnalysisAxisLabel(makeChain({ dataset_name: null }), "dataset_name")).toBe("(empty)");
    expect(getResultAnalysisAxisLabel(makeChain({ preprocessings: "SNV" }), "preprocessings")).toBe("SNV");
  });

  it("reads result metadata only from valid variant params payloads", () => {
    const metadata = {
      target_name: "moisture",
      backend: "dag-ml",
      content_address: "sha256:a",
      dimensions: { source: "nir", repetition_policy: "aggregate" },
    };

    expect(getResultAnalysisMetadata(makeChain({ variant_params: { result_metadata: metadata } }))).toBe(metadata);
    expect(getResultAnalysisMetadata(makeChain({ variant_params: null }))).toEqual({});
    expect(getResultAnalysisMetadata(makeChain({ variant_params: { result_metadata: [] } }))).toEqual({});
  });

  it("builds group labels from result metadata and chain fields", () => {
    const chain = makeChain({
      task_type: "classification",
      variant_params: {
        result_metadata: {
          target_name: "protein",
          backend: "sklearn",
          content_address: "sha256:b",
        },
      },
    });

    expect(getResultAnalysisGroupLabel(chain, "target_name")).toBe("protein");
    expect(getResultAnalysisGroupLabel(chain, "backend")).toBe("sklearn");
    expect(getResultAnalysisGroupLabel(chain, "content_address")).toBe("sha256:b");
    expect(getResultAnalysisGroupLabel(chain, "task_type")).toBe("classification");
    expect(getResultAnalysisGroupLabel(chain, "model_class")).toBe("PLSRegression");
    expect(getResultAnalysisGroupLabel(makeChain({ variant_params: null }), "backend")).toBe("(empty)");
  });

  it("matches arbitrary result metadata dimensions by normalized values", () => {
    const metadata = getResultAnalysisMetadata(makeChain({
      variant_params: {
        result_metadata: {
          dimensions: {
            source: " nir ",
            target_index: 2,
          },
        },
      },
    }));

    expect(matchesResultAnalysisDimensions(metadata, {
      source: ["nir"],
      target_index: ["2"],
    })).toBe(true);
    expect(matchesResultAnalysisDimensions(metadata, {
      source: ["lab"],
    })).toBe(false);
    expect(matchesResultAnalysisDimensions(metadata, {
      emptyFilter: [],
    })).toBe(true);
    expect(matchesResultAnalysisDimensions({}, {
      source: ["nir"],
    })).toBe(false);
  });

  it("matches top-level result metadata fields by normalized values", () => {
    const metadata = getResultAnalysisMetadata(makeChain({
      variant_params: {
        result_metadata: {
          source_ref: " benchmark-a ",
          template_id: "template-a",
          refit: true,
          artifact_count: 3,
          dimensions: { source: "nir" },
        },
      },
    }));

    expect(matchesResultAnalysisMetadataFields(metadata, {
      source_ref: ["benchmark-a"],
      template_id: ["template-a"],
      refit: ["true"],
      artifact_count: ["3"],
    })).toBe(true);
    expect(matchesResultAnalysisMetadataFields(metadata, {
      refit: [true],
      artifact_count: [3],
    })).toBe(true);
    expect(matchesResultAnalysisMetadataFields(metadata, {
      template_id: ["template-b"],
    })).toBe(false);
    expect(matchesResultAnalysisMetadataFields(metadata, {
      emptyFilter: [],
    })).toBe(true);
    expect(matchesResultAnalysisMetadataFields({}, {
      template_id: ["template-a"],
    })).toBe(false);
  });
});
