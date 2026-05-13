import { describe, expect, it } from "vitest";
import { buildStoredPipelinePreview, describeChainPipelineReload, describeRunPipelineReload, formatCVStrategy, formatLogLine } from "./runDetailUtils";

describe("runDetailUtils", () => {
  it("formats inferred CV strategies for display", () => {
    expect(formatCVStrategy("kfold")).toBe("K-Fold");
    expect(formatCVStrategy("stratified_shuffle_split")).toBe("Stratified Shuffle Split");
    expect(formatCVStrategy(undefined)).toBe("-");
  });

  it("builds a readable preview from stored native pipeline steps", () => {
    const preview = buildStoredPipelinePreview([
      { class: "sklearn.preprocessing._data.StandardScaler" },
      { class: "sklearn.model_selection._split.KFold", params: { n_splits: 5, shuffle: true } },
      { model: { class: "sklearn.linear_model._ridge.Ridge", params: { alpha: 1 } } },
    ]);

    expect(preview.totalSteps).toBeGreaterThanOrEqual(3);
    expect(preview.nodes.some((node) => /standard/i.test(node.label) || /scaler/i.test(node.label))).toBe(true);
    expect(preview.nodes.some((node) => node.kind === "model")).toBe(true);
  });

  it("describes reloads from the original authoring template", () => {
    expect(
      describeRunPipelineReload(
        {
          source: "authoring_template",
          is_editable_template: true,
          is_legacy_fallback: false,
        },
        4,
      )
    ).toEqual({
      title: "Original template loaded",
      description: "4 steps loaded from the original editable template.",
    });
  });

  it("describes legacy fallback reloads as expanded snapshots", () => {
    expect(
      describeRunPipelineReload(
        {
          source: "expanded_snapshot",
          is_editable_template: false,
          is_legacy_fallback: true,
        },
        2,
      )
    ).toEqual({
      title: "Legacy run snapshot loaded",
      description: "2 steps loaded from an expanded executed snapshot, not the original template.",
    });
  });

  it("describes chain reloads as chain snapshots", () => {
    expect(
      describeChainPipelineReload(
        {
          source: "chain_snapshot",
          selection_scope: "preprocessing_chain_plus_selected_model",
          is_editable_template: false,
        },
        3,
      )
    ).toEqual({
      title: "Chain snapshot loaded",
      description: "3 steps loaded from this chain snapshot (preprocessing chain + selected model), not the original template.",
    });
  });

  it("formats structured log rows into readable lines", () => {
    const line = formatLogLine({
      log_id: "log-1",
      step_idx: 2,
      operator_class: "KFold",
      event: "start",
      duration_ms: null,
      message: "Split started",
      details: { n_splits: 5 },
      level: "info",
      created_at: "2026-04-17T10:00:00Z",
    });

    expect(line).toContain("[INFO]");
    expect(line).toContain("step 2");
    expect(line).toContain("Split started");
    expect(line).toContain("\"n_splits\":5");
  });
});
