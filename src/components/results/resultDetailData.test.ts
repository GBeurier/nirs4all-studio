import { describe, expect, it } from "vitest";
import {
  buildResultArtifactSummary,
  buildResultExecutionTimeRows,
  buildResultHeaderStatus,
  buildResultLogRows,
  buildResultMetricCards,
  buildResultPipelineJson,
  buildResultPipelineJsonPayload,
  buildResultQuickFacts,
  buildResultRelatedLinks,
  buildResultScoreMetricCards,
  getResultEmptyMetricsMessage,
  getResultExportModelDescription,
  getResultExportModelLabel,
  getResultExecutionLogs,
  getResultLogLineTone,
  hasResultMetrics,
} from "./resultDetailData";
import type { PipelineRun } from "@/types/runs";

function pipeline(overrides: Partial<PipelineRun> = {}): PipelineRun {
  return {
    id: "run-pipeline",
    pipeline_id: "pipe",
    pipeline_name: "PLS baseline",
    model: "PLS",
    preprocessing: "SNV",
    split_strategy: "KFold",
    status: "completed",
    progress: 100,
    metrics: { r2: 0.91, rmse: 0.12 },
    val_score: 0.13,
    test_score: 0.12,
    has_refit: true,
    is_final_model: true,
    started_at: "2026-06-28T10:00:00Z",
    completed_at: "2026-06-28T10:05:00Z",
    ...overrides,
  };
}

describe("resultDetailData", () => {
  it("builds the JSON payload used by the detail sheet", () => {
    expect(buildResultPipelineJsonPayload(pipeline())).toEqual({
      name: "PLS baseline",
      model: "PLS",
      preprocessing: "SNV",
      split_strategy: "KFold",
      status: "completed",
      metrics: { r2: 0.91, rmse: 0.12 },
      val_score: 0.13,
      test_score: 0.12,
      has_refit: true,
      is_final_model: true,
      started_at: "2026-06-28T10:00:00Z",
      completed_at: "2026-06-28T10:05:00Z",
      artifact_refs: [{
        id: "pipeline-run:run-pipeline:metrics",
        kind: "metric_table",
        role: "primary-metrics",
        label: "Primary metrics",
        source: "pipeline-run",
        scope: "pipeline",
        status: "virtual",
        runId: "run-pipeline",
        pipelineId: "pipe",
        metric: null,
        format: "json",
        metadata: {
          metricKeys: ["r2", "rmse"],
          hasCvScore: true,
          hasTestScore: true,
        },
      }],
    });

    expect(JSON.parse(buildResultPipelineJson(pipeline()))).toMatchObject({
      name: "PLS baseline",
      status: "completed",
      metrics: { r2: 0.91 },
      artifact_refs: [
        expect.objectContaining({ kind: "metric_table", role: "primary-metrics" }),
      ],
    });
  });

  it("detects metrics and resolves empty-state copy", () => {
    expect(hasResultMetrics(pipeline({ metrics: undefined, score: null, val_score: null, test_score: null }))).toBe(false);
    expect(hasResultMetrics(pipeline({ metrics: undefined, score: 0.7, val_score: null, test_score: null }))).toBe(true);
    expect(getResultEmptyMetricsMessage("running")).toBe("Results will appear when training completes");
    expect(getResultEmptyMetricsMessage("queued")).toBe("Waiting to start...");
    expect(getResultEmptyMetricsMessage("failed")).toBe("No results available");
  });

  it("builds header status and quick facts", () => {
    expect(buildResultHeaderStatus(pipeline())).toEqual({
      label: "Completed",
      colorClass: "text-chart-1",
      bgClass: "bg-chart-1/10",
      iconClass: "",
      badgeVariant: "default",
      progress: null,
    });
    expect(buildResultHeaderStatus(pipeline({ status: "running", progress: 42 }))).toEqual({
      label: "Running",
      colorClass: "text-chart-2",
      bgClass: "bg-chart-2/10",
      iconClass: "animate-spin",
      badgeVariant: "secondary",
      progress: 42,
    });
    expect(buildResultQuickFacts(pipeline())).toEqual([
      { id: "model", label: "Model", value: "PLS", icon: "model" },
      { id: "preprocessing", label: "Preprocessing", value: "SNV", icon: "preprocessing" },
      { id: "split", label: "Split", value: "KFold", icon: "split" },
    ]);
  });

  it("builds metric cards for the result detail metrics tab", () => {
    expect(buildResultScoreMetricCards(pipeline())).toEqual([
      {
        id: "cv_score",
        label: "CV Score",
        value: 0.13,
        format: 4,
        icon: "target",
        variant: "secondary",
      },
      {
        id: "final_score",
        label: "Final Score",
        value: 0.12,
        format: 4,
        icon: "trophy",
        variant: "primary",
      },
    ]);

    expect(buildResultMetricCards(pipeline({
      metrics: { r2: 0.91, rmse: 0.12, mae: 0.08, rpd: 2.4, nrmse: 0.03 },
    }))).toEqual([
      { id: "r2", label: "R² Score", value: 0.91, format: 4, icon: "target", variant: "primary" },
      { id: "rmse", label: "RMSE", value: 0.12, format: 4, icon: "trending", variant: "secondary" },
      { id: "mae", label: "MAE", value: 0.08, format: 4, icon: "bar", variant: "default" },
      { id: "rpd", label: "RPD", value: 2.4, format: 2, icon: "trending", variant: "default" },
      { id: "nrmse", label: "nRMSE", value: 0.03, format: 4, icon: "bar", variant: "default" },
    ]);
  });

  it("builds legacy score cards when no CV score is present", () => {
    expect(buildResultMetricCards(pipeline({
      metrics: undefined,
      score: 0.77,
      score_metric: "accuracy",
      val_score: null,
    }))).toEqual([
      { id: "score", label: "ACCURACY", value: 0.77, format: 4, icon: "target", variant: "primary" },
    ]);
  });

  it("builds execution time rows and export copy", () => {
    expect(buildResultExecutionTimeRows(pipeline())).toEqual([
      { id: "started", label: "Started", value: "2026-06-28T10:00:00Z" },
      { id: "completed", label: "Completed", value: "2026-06-28T10:05:00Z" },
    ]);
    expect(buildResultExecutionTimeRows(pipeline({ started_at: undefined, completed_at: undefined }))).toEqual([]);
    expect(getResultExportModelLabel(true)).toBe("Export Final Model (.n4a)");
    expect(getResultExportModelLabel(false)).toBe("Export Model (.n4a)");
    expect(getResultExportModelDescription(true)).toBe("Exports the refit model trained on the full dataset");
    expect(getResultExportModelDescription(false)).toBeNull();
  });

  it("builds related links with encoded prediction targets", () => {
    expect(buildResultRelatedLinks(pipeline({ pipeline_name: "PLS & SNV" }), "Maize lot #1")).toEqual([
      {
        id: "predictions",
        label: "Predictions",
        to: "/predictions?dataset=Maize%20lot%20%231&config=PLS%20%26%20SNV",
        icon: "predictions",
      },
      {
        id: "runs",
        label: "Runs",
        to: "/runs",
        icon: "runs",
      },
    ]);
  });

  it("builds artifact summaries for result detail metrics", () => {
    expect(buildResultArtifactSummary(pipeline({
      config: { steps: [{ name: "SNV" }] },
      logs: ["[INFO] complete"],
      refit_model_id: "artifact-refit",
    }))).toEqual({
      totalCount: 4,
      totalCountLabel: "4 artifacts",
      kindItems: [
        { id: "kind:model", label: "Model", artifactCountLabel: "1 artifact" },
        { id: "kind:pipeline_config", label: "Pipeline configuration", artifactCountLabel: "1 artifact" },
        { id: "kind:metric_table", label: "Metric table", artifactCountLabel: "1 artifact" },
        { id: "kind:execution_log", label: "Execution log", artifactCountLabel: "1 artifact" },
      ],
      statusItems: [
        { id: "status:available", label: "Available", artifactCountLabel: "1 artifact" },
        { id: "status:virtual", label: "Virtual", artifactCountLabel: "3 artifacts" },
      ],
      groups: [{
        id: "source-scope:pipeline-run:pipeline",
        label: "Pipeline run / Pipeline",
        sourceLabel: "Pipeline run",
        scopeLabel: "Pipeline",
        artifactCountLabel: "4 artifacts",
        artifactLabels: [
          "Refit model",
          "Pipeline configuration",
          "Primary metrics",
          "Execution log",
        ],
      }],
      repositoryItems: [],
    });
  });

  it("includes repository provenance in artifact summaries", () => {
    expect(buildResultArtifactSummary({
      ...pipeline({
        metrics: undefined,
        val_score: null,
        test_score: null,
        score: null,
      }),
      artifact_refs: [{
        id: "repo-entry",
        kind: "repository_entry",
        role: "manifest-entry",
        label: "Repository result manifest",
        source: "result-repository",
        scope: "campaign",
        status: "available",
        contentAddress: "sha256:1234567890abcdef1234567890abcdef",
        metadata: {
          repository_id: "repo-1",
          source_ref: "manifests/result.json",
        },
      }],
    } as PipelineRun & { artifact_refs: unknown[] })).toEqual({
      totalCount: 1,
      totalCountLabel: "1 artifact",
      kindItems: [
        { id: "kind:repository_entry", label: "Repository entry", artifactCountLabel: "1 artifact" },
      ],
      statusItems: [
        { id: "status:available", label: "Available", artifactCountLabel: "1 artifact" },
      ],
      groups: [{
        id: "source-scope:result-repository:campaign",
        label: "Result repository / Campaign",
        sourceLabel: "Result repository",
        scopeLabel: "Campaign",
        artifactCountLabel: "1 artifact",
        artifactLabels: ["Repository result manifest"],
      }],
      repositoryItems: [{
        id: "repository-provenance:repo-entry",
        label: "Repository result manifest",
        sourceLabel: "Result repository",
        contentAddressLabel: "sha256:1234567890ab...abcdef",
        detailLabels: [
          "Content sha256:1234567890ab...abcdef",
          "Repository repo-1",
          "Source manifests/result.json",
        ],
      }],
    });
  });

  it("prefers real logs and falls back to status-specific generated logs", () => {
    expect(getResultExecutionLogs(pipeline({ logs: ["actual log"] }))).toEqual(["actual log"]);
    expect(getResultExecutionLogs(pipeline({ status: "queued", logs: [] }))).toEqual(["[INFO] Waiting in queue..."]);
    expect(getResultExecutionLogs(pipeline({ status: "failed" })).some((line) => line.includes("[ERROR]"))).toBe(true);
    expect(getResultExecutionLogs(pipeline({ status: "running", progress: 42 })).at(-1)).toBe(
      "[INFO] Cross-validation in progress... 42%",
    );
  });

  it("classifies result log rows for presentation", () => {
    expect(getResultLogLineTone("[ERROR] Broken")).toBe("error");
    expect(getResultLogLineTone("[INFO] Ready")).toBe("info");
    expect(getResultLogLineTone("raw log")).toBe("default");
    expect(buildResultLogRows(["[INFO] Ready", "[ERROR] Broken", "raw log"])).toEqual([
      { id: "0-[INFO] Ready", text: "[INFO] Ready", tone: "info" },
      { id: "1-[ERROR] Broken", text: "[ERROR] Broken", tone: "error" },
      { id: "2-raw log", text: "raw log", tone: "default" },
    ]);
  });
});
