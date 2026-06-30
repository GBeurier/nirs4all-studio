import { describe, expect, it } from "vitest";

import { buildInspectorTargetOptions } from "@/lib/inspector/targetSelection";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(
  chainId: string,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: null,
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "dataset-a",
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

describe("inspector target selection", () => {
  it("derives target options from result metadata dimensions", () => {
    const options = buildInspectorTargetOptions([
      makeChain("a", {
        variant_params: {
          result_metadata: {
            target_name: "moisture",
            dimensions: { target_index: 0 },
          },
        },
      }),
      makeChain("b", {
        variant_params: {
          result_metadata: {
            target_name: "protein",
            dimensions: { target_index: "1" },
          },
        },
      }),
      makeChain("c", {
        variant_params: {
          result_metadata: {
            target_name: "protein",
            dimensions: { target_index: 1 },
          },
        },
      }),
    ]);

    expect(options).toEqual([
      {
        value: "0",
        index: 0,
        label: "moisture (Target 1)",
        count: 1,
        targetNames: ["moisture"],
      },
      {
        value: "1",
        index: 1,
        label: "protein (Target 2)",
        count: 2,
        targetNames: ["protein"],
      },
    ]);
  });

  it("prefers backend-provided target catalog when available", () => {
    const options = buildInspectorTargetOptions(
      [makeChain("a")],
      2,
      [
        {
          index: 0,
          label: "moisture (Target 1)",
          count: 3,
          target_names: ["moisture"],
        },
        {
          index: 1,
          label: "",
          count: 2,
          target_names: ["protein"],
        },
      ],
    );

    expect(options).toEqual([
      {
        value: "0",
        index: 0,
        label: "moisture (Target 1)",
        count: 3,
        targetNames: ["moisture"],
      },
      {
        value: "1",
        index: 1,
        label: "protein (Target 2)",
        count: 2,
        targetNames: ["protein"],
      },
      {
        value: "2",
        index: 2,
        label: "Target 3",
        count: 0,
        targetNames: [],
      },
    ]);
  });

  it("keeps labels conservative when one target index carries mixed names", () => {
    const options = buildInspectorTargetOptions([
      makeChain("a", {
        variant_params: {
          result_metadata: {
            target_name: "moisture",
            dimensions: { target_index: 0 },
          },
        },
      }),
      makeChain("b", {
        variant_params: {
          result_metadata: {
            target_name: "protein",
            dimensions: { target_index: 0 },
          },
        },
      }),
    ]);

    expect(options).toEqual([
      {
        value: "0",
        index: 0,
        label: "Target 1 (2 names)",
        count: 2,
        targetNames: ["moisture", "protein"],
      },
    ]);
  });

  it("falls back to the selected target when metadata does not expose target indexes", () => {
    expect(buildInspectorTargetOptions([makeChain("a")], 2)).toEqual([
      {
        value: "2",
        index: 2,
        label: "Target 3",
        count: 0,
        targetNames: [],
      },
    ]);
  });

  it("treats target names without indexes as the first target", () => {
    expect(buildInspectorTargetOptions([
      makeChain("a", {
        variant_params: {
          result_metadata: {
            target_name: "moisture",
          },
        },
      }),
    ])).toEqual([
      {
        value: "0",
        index: 0,
        label: "moisture (Target 1)",
        count: 1,
        targetNames: ["moisture"],
      },
    ]);
  });
});
