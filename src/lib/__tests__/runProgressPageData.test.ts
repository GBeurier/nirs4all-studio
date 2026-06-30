import { describe, expect, it } from "vitest";

import {
  buildRunDerivedLogs,
  buildRunExecutionProgressDisplayData,
  buildRunLogLines,
  buildRunProgressDisplayData,
} from "@/lib/run-progress/pageData";
import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";
import type { PipelineRun, Run } from "@/types/runs";

function pipeline(overrides: Partial<PipelineRun>): PipelineRun {
  return {
    id: "pipeline-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline 1",
    model: "PLSRegression",
    preprocessing: "SNV",
    split_strategy: "kfold",
    status: "queued",
    progress: 0,
    ...overrides,
  };
}

function run(overrides: Partial<Run>): Run {
  return {
    id: "run-1",
    name: "Run 1",
    status: "running",
    created_at: "2026-06-29T08:00:00Z",
    datasets: [{
      dataset_id: "dataset-1",
      dataset_name: "Dataset 1",
      pipelines: [],
    }],
    ...overrides,
  };
}

function executionJobRecord(overrides: Partial<ExecutionJobRecord> = {}): ExecutionJobRecord {
  return {
    job_id: "job-1",
    job_type: "training",
    requested_backend: "cluster",
    execution_backend: "local-python",
    execution_mode: "in-process",
    status: "running",
    progress: 25,
    progress_message: "Training models",
    created_at: "2026-06-30T10:00:00Z",
    started_at: null,
    completed_at: null,
    request: { run_id: "run-1" },
    driver: { backend: "local-python" },
    metrics: {},
    error: null,
    run_id: "run-1",
    run_name: "Run 1",
    run_status: "running",
    is_orphaned: false,
    ...overrides,
  };
}

describe("run progress page data", () => {
  it("builds derived logs from datasets, pipelines, fold averages, and final metrics", () => {
    const lines = buildRunDerivedLogs(run({
      datasets: [{
        dataset_id: "dataset-1",
        dataset_name: "Dataset 1",
        pipelines: [
          pipeline({
            pipeline_name: "PLS",
            model: "PLSRegression",
            fold_metrics: {
              1: { r2: 0.8, rmse: 0.2, mae: 0.1, rpd: 2.1 },
              2: { r2: 0.6, rmse: 0.4, mae: 0.2, rpd: 2.3 },
            },
            metrics: { r2: 0.9, rmse: 0.1, mae: 0.05, rpd: 3.4 },
          }),
        ],
      }],
    }));

    expect(lines).toEqual([
      "[INFO] Dataset 1/1: Dataset 1",
      "[INFO] Pipeline 1/1: PLS (model=PLSRegression)",
      "[INFO] Fold averages (2 folds): R2=0.7000 | RMSE=0.3000 | MAE=0.1500 | RPD=2.200",
      "[INFO] Final metrics: R2=0.9000 | RMSE=0.1000 | MAE=0.0500 | RPD=3.400",
    ]);
  });

  it("keeps zero final R2 while omitting non-positive fold-average R2", () => {
    const lines = buildRunDerivedLogs(run({
      datasets: [{
        dataset_id: "dataset-1",
        dataset_name: "Dataset 1",
        pipelines: [
          pipeline({
            fold_metrics: {
              1: { r2: 0, rmse: 0.2 },
              2: { r2: 0, rmse: 0.4 },
            },
            metrics: { r2: 0, rmse: 0.1 },
          }),
        ],
      }],
    }));

    expect(lines).toContain("[INFO] Fold averages (2 folds): RMSE=0.3000");
    expect(lines).toContain("[INFO] Final metrics: R2=0.0000 | RMSE=0.1000");
  });

  it("summarizes active run progress from completed and running pipelines", () => {
    const data = buildRunProgressDisplayData(run({
      total_pipelines: 2,
      datasets: [{
        dataset_id: "dataset-1",
        dataset_name: "Dataset 1",
        pipelines: [
          pipeline({ id: "completed", status: "completed", progress: 100 }),
          pipeline({
            id: "running",
            status: "running",
            progress: 50,
            fold_count: 5,
            total_model_count: 10,
            variant_description: "backend=sklearn",
          }),
        ],
      }],
    }), "backend=n4a-methods");

    expect(data.completedCount).toBe(1);
    expect(data.currentPipeline?.id).toBe("running");
    expect(data.currentPipelineIndex).toBe(2);
    expect(data.overallProgress).toBe(75);
    expect(data.progressOverviewPrimaryText).toBe("2/2 · 10 fits");
    expect(data.summaryLabel).toBe("Current pipeline");
    expect(data.summaryVariantText).toBe("backend=n4a-methods");
  });

  it("selects the best completed pipeline for completed runs", () => {
    const data = buildRunProgressDisplayData(run({
      status: "completed",
      datasets: [{
        dataset_id: "dataset-1",
        dataset_name: "Dataset 1",
        pipelines: [
          pipeline({ id: "a", status: "completed", metrics: { r2: 0.7 } }),
          pipeline({ id: "b", status: "completed", metrics: { r2: 0.9 } }),
          pipeline({ id: "failed", status: "failed" }),
        ],
      }],
    }));

    expect(data.failedCount).toBe(1);
    expect(data.summaryPipeline?.id).toBe("b");
    expect(data.summaryLabel).toBe("Best completed");
    expect(data.summaryMetrics).toEqual({ r2: 0.9 });
  });

  it("merges derived, persisted, runtime, and streaming logs without duplicates", () => {
    const lines = buildRunLogLines({
      run: run({
        datasets: [{
          dataset_id: "dataset-1",
          dataset_name: "Dataset 1",
          pipelines: [
            pipeline({
              pipeline_name: "PLS",
              logs: ["runtime", "persisted"],
            }),
          ],
        }],
      }),
      persistedLogs: ["persisted"],
      streamingLogs: ["streaming", "runtime"],
    });

    expect(lines).toEqual([
      "[INFO] Dataset 1/1: Dataset 1",
      "[INFO] Pipeline 1/1: PLS (model=PLSRegression)",
      "persisted",
      "runtime",
      "streaming",
    ]);
  });

  it("uses an execution job record as the progress display source when present", () => {
    const data = buildRunExecutionProgressDisplayData(
      run({ status: "queued" }),
      executionJobRecord({
        status: "running",
        progress: 125,
        progress_message: "Training fold 3/5",
      }),
    );

    expect(data).toEqual({
      status: "running",
      progress: 100,
      message: "Training fold 3/5",
    });
  });

  it("surfaces execution job errors for failed or cancelled job records", () => {
    const data = buildRunExecutionProgressDisplayData(
      run({ status: "running" }),
      executionJobRecord({
        status: "failed",
        progress: 40,
        progress_message: "Training models",
        error: "Worker exited unexpectedly",
      }),
    );

    expect(data).toEqual({
      status: "failed",
      progress: 40,
      message: "Worker exited unexpectedly",
    });
  });

  it("falls back to legacy run progress when no execution job record is available", () => {
    const data = buildRunExecutionProgressDisplayData(run({
      total_pipelines: 2,
      datasets: [{
        dataset_id: "dataset-1",
        dataset_name: "Dataset 1",
        pipelines: [
          pipeline({ id: "completed", status: "completed", progress: 100 }),
          pipeline({ id: "running", status: "running", progress: 50 }),
        ],
      }],
    }));

    expect(data.status).toBe("running");
    expect(data.progress).toBe(75);
    expect(data.message).toContain("2/2");
    expect(data.message).toContain("PLSRegression");
  });

  it("falls back to a readable job status message when the job record has no message", () => {
    const data = buildRunExecutionProgressDisplayData(
      run({ status: "running" }),
      executionJobRecord({
        status: "retrying",
        progress: -10,
        progress_message: " ",
      }),
    );

    expect(data).toEqual({
      status: "retrying",
      progress: 0,
      message: "Job retrying",
    });
  });
});
