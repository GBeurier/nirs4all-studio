import { describe, expect, it } from "vitest";

import { buildInspectorPanelQueryInputs } from "@/lib/inspector/panelQueries";
import type { InspectorPanelType, ScoreRef } from "@/types/inspector";

function activePanels(...panels: InspectorPanelType[]): ReadonlySet<InspectorPanelType> {
  return new Set(panels);
}

describe("inspector panel query inputs", () => {
  it("builds regression panel requests only for active regression-capable panels", () => {
    const queries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("scatter", "fold_stability", "bias_variance"),
      focus: {
        chainIds: ["chain-a", "chain-b"],
        task: "regression",
        topologyPipelineId: null,
      },
      partition: "test",
      scoreColumn: "cv_val_score",
      biasVarianceGroupBy: "model_class",
    });

    expect(queries.scatter).toEqual({ chain_ids: ["chain-a", "chain-b"], partition: "test" });
    expect(queries.foldStability).toEqual({
      chain_ids: ["chain-a", "chain-b"],
      score_column: "cv_val_score",
      partition: "test",
    });
    expect(queries.biasVariance).toEqual({
      chain_ids: ["chain-a", "chain-b"],
      score_column: "cv_val_score",
      group_by: "model_class",
    });
    expect(queries.confusion).toBeNull();
    expect(queries.topology).toBeNull();
  });

  it("uses residuals panel activity to drive the shared scatter request", () => {
    const queries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("residuals"),
      focus: {
        chainIds: ["chain-a"],
        task: "regression",
        topologyPipelineId: null,
      },
      partition: "train",
      scoreColumn: "final_test_score",
      biasVarianceGroupBy: "dataset_name",
    });

    expect(queries.scatter).toEqual({ chain_ids: ["chain-a"], partition: "train" });
  });

  it("builds classification diagnostics without enabling regression diagnostics", () => {
    const queries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("confusion", "scatter", "fold_stability", "bias_variance"),
      focus: {
        chainIds: ["chain-a"],
        task: "classification",
        topologyPipelineId: null,
      },
      partition: "validation",
      scoreColumn: "cv_test_score",
      biasVarianceGroupBy: "preprocessings",
    });

    expect(queries.confusion).toEqual({ chain_ids: ["chain-a"], partition: "validation" });
    expect(queries.scatter).toBeNull();
    expect(queries.foldStability).toBeNull();
    expect(queries.biasVariance).toBeNull();
  });

  it("attaches target_index to target-aware focused diagnostics", () => {
    const queries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("scatter", "confusion", "fold_stability", "bias_variance"),
      focus: {
        chainIds: ["chain-a"],
        task: "regression",
        topologyPipelineId: null,
      },
      partition: "test",
      targetIndex: 2,
      scoreColumn: "cv_test_score",
      biasVarianceGroupBy: "model_class",
    });

    expect(queries.scatter).toEqual({ chain_ids: ["chain-a"], partition: "test", target_index: 2 });
    expect(queries.foldStability).toEqual({
      chain_ids: ["chain-a"],
      score_column: "cv_test_score",
      partition: "test",
    });
    expect(queries.biasVariance).toEqual({
      chain_ids: ["chain-a"],
      score_column: "cv_test_score",
      group_by: "model_class",
    });
    expect(queries.confusion).toBeNull();

    const classificationQueries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("confusion"),
      focus: {
        chainIds: ["chain-c"],
        task: "classification",
        topologyPipelineId: null,
      },
      partition: "test",
      targetIndex: 1,
      scoreColumn: "cv_test_score",
      biasVarianceGroupBy: "model_class",
    });

    expect(classificationQueries.confusion).toEqual({
      chain_ids: ["chain-c"],
      partition: "test",
      target_index: 1,
    });
  });

  it("disables focused diagnostics for mixed or empty focus", () => {
    const mixed = buildInspectorPanelQueryInputs({
      activePanels: activePanels("confusion", "scatter", "fold_stability", "bias_variance"),
      focus: {
        chainIds: ["chain-a", "chain-b"],
        task: "mixed",
        topologyPipelineId: null,
      },
      partition: "test",
      scoreColumn: "cv_val_score",
      biasVarianceGroupBy: "model_class",
    });
    const empty = buildInspectorPanelQueryInputs({
      activePanels: activePanels("confusion", "scatter", "fold_stability", "bias_variance"),
      focus: {
        chainIds: [],
        task: "none",
        topologyPipelineId: null,
      },
      partition: "test",
      scoreColumn: "cv_val_score",
      biasVarianceGroupBy: "model_class",
    });

    expect(mixed.scatter).toBeNull();
    expect(mixed.confusion).toBeNull();
    expect(mixed.foldStability).toBeNull();
    expect(mixed.biasVariance).toBeNull();
    expect(empty.scatter).toBeNull();
    expect(empty.confusion).toBeNull();
    expect(empty.foldStability).toBeNull();
    expect(empty.biasVariance).toBeNull();
  });

  it("builds topology requests only when the topology panel is active and focus has one pipeline", () => {
    const inactive = buildInspectorPanelQueryInputs({
      activePanels: activePanels("scatter"),
      focus: {
        chainIds: ["chain-a"],
        task: "regression",
        topologyPipelineId: "pipe-1",
      },
      partition: "test",
      scoreColumn: "cv_val_score",
      biasVarianceGroupBy: "model_class",
    });
    const active = buildInspectorPanelQueryInputs({
      activePanels: activePanels("branch_topology"),
      focus: {
        chainIds: ["chain-a"],
        task: "regression",
        topologyPipelineId: "pipe-1",
      },
      partition: "test",
      scoreColumn: "cv_val_score",
      biasVarianceGroupBy: "model_class",
    });

    expect(inactive.topology).toBeNull();
    expect(active.topology).toEqual({ pipeline_id: "pipe-1", score_column: "cv_val_score" });
  });

  it("attaches the observed score-ref to score-dependent requests when available", () => {
    const scoreRef: ScoreRef = {
      key: "metric=rmse|protocol=final|partition=test|aggregation=final_model",
      metric: "rmse",
      protocol: "final",
      partition: "test",
      aggregation: "final_model",
      legacyScoreColumn: "final_test_score",
    };

    const queries = buildInspectorPanelQueryInputs({
      activePanels: activePanels("fold_stability", "bias_variance", "branch_topology"),
      focus: {
        chainIds: ["chain-a", "chain-b"],
        task: "regression",
        topologyPipelineId: "pipe-1",
      },
      partition: "test",
      scoreColumn: "final_test_score",
      scoreRef,
      biasVarianceGroupBy: "model_class",
    });

    expect(queries.foldStability).toEqual({
      chain_ids: ["chain-a", "chain-b"],
      score_column: "final_test_score",
      score_ref: scoreRef,
      partition: "test",
    });
    expect(queries.biasVariance).toEqual({
      chain_ids: ["chain-a", "chain-b"],
      score_column: "final_test_score",
      score_ref: scoreRef,
      group_by: "model_class",
    });
    expect(queries.topology).toEqual({
      pipeline_id: "pipe-1",
      score_column: "final_test_score",
      score_ref: scoreRef,
    });
  });
});
