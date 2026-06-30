import { describe, expect, it } from "vitest";
import {
  buildRunPageIdLookup,
  buildRunsExecutionJobListItems,
  buildRunsExecutionTaskPanelData,
  buildRunsStorageArtifactMetadata,
  buildRunsMetricSelectionContext,
  buildRunsPageItems,
  buildRunStorageArtifactMetadata,
  getExecutionJobRecordDetailRefetchInterval,
  summarizeRunsPageStats,
} from "../runs/pageData";
import type { EnrichedDatasetRun, EnrichedRun, TopChainResult } from "@/types/enriched-runs";
import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";
import type { Run } from "@/types/runs";

function enrichedRun(overrides: Partial<EnrichedRun> = {}): EnrichedRun {
  return {
    run_id: "history-run",
    name: "History run",
    status: "completed",
    project_id: null,
    created_at: "2026-04-17T08:00:00Z",
    completed_at: "2026-04-17T08:10:00Z",
    duration_seconds: 600,
    artifact_size_bytes: 1024,
    datasets_count: 1,
    pipeline_runs_count: 2,
    final_models_count: 1,
    total_models_trained: 2,
    total_folds: 10,
    datasets: [],
    ...overrides,
  };
}

function activeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: "active-run",
    name: "Active run",
    status: "running",
    created_at: "2026-04-17T08:00:00Z",
    completed_at: undefined,
    datasets: [],
    total_pipelines: 1,
    ...overrides,
  };
}

function chain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: "chain",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    avg_val_score: null,
    avg_test_score: null,
    avg_train_score: null,
    fold_count: 3,
    scores: {
      val: {},
      test: {},
    },
    final_test_score: null,
    final_train_score: null,
    final_scores: {},
    ...overrides,
  };
}

function dataset(overrides: Partial<EnrichedDatasetRun> = {}): EnrichedDatasetRun {
  return {
    dataset_name: "Corn",
    best_avg_val_score: null,
    best_avg_test_score: null,
    best_final_score: null,
    metric: null,
    task_type: null,
    gain_from_previous_best: null,
    pipeline_count: 1,
    top_5: [],
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
    progress_message: "training",
    created_at: "2026-06-30T10:00:00Z",
    started_at: null,
    completed_at: null,
    request: {},
    driver: {},
    metrics: {},
    error: null,
    run_id: "history-run",
    run_name: "History run",
    run_status: "running",
    is_orphaned: false,
    ...overrides,
  };
}

describe("runs page data projections", () => {
  it("merges enriched run history with queued and running API runs", () => {
    const runs = buildRunsPageItems(
      [
        enrichedRun({
          run_id: "store-run-1",
          name: "Persisted run",
          status: "completed",
        }),
      ],
      [
        activeRun({
          id: "runtime-run-1",
          store_run_id: "store-run-1",
          name: "Runtime mirror",
          status: "running",
        }),
        activeRun({
          id: "queued-only",
          name: "Queued only",
          status: "queued",
          datasets: [
            {
              dataset_id: "dataset-1",
              dataset_name: "Corn",
              pipelines: [],
            },
          ],
          total_pipelines: 3,
        }),
        activeRun({
          id: "completed-active",
          name: "Completed active source",
          status: "completed",
        }),
      ],
    );

    expect(runs.map(run => [run.run_id, run.name, run.status])).toEqual([
      ["queued-only", "Queued only", "queued"],
      ["store-run-1", "Persisted run", "running"],
    ]);
    expect(runs[0]).toMatchObject({
      completed_at: null,
      datasets_count: 1,
      pipeline_runs_count: 3,
      final_models_count: 0,
      total_models_trained: 0,
      total_folds: 0,
    });
  });

  it("carries active execution backend metadata into the runs display model", () => {
    const runs = buildRunsPageItems(
      [
        enrichedRun({
          run_id: "store-run-1",
          name: "Persisted run",
          config: {
            cv_folds: 5,
            execution_backend: "local-python",
          },
        }),
      ],
      [
        activeRun({
          id: "runtime-run-1",
          store_run_id: "store-run-1",
          status: "running",
          execution_backend: "cluster",
        }),
        activeRun({
          id: "cluster-only",
          name: "Cluster only",
          status: "queued",
          execution_backend: "cluster",
        }),
      ],
    );

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      run_id: "cluster-only",
      config: {
        execution_backend: "cluster",
      },
    });
    expect(runs[1]).toMatchObject({
      run_id: "store-run-1",
      status: "running",
      config: {
        cv_folds: 5,
        execution_backend: "cluster",
      },
    });
  });

  it("combines runs with durable execution job indicators for the list", () => {
    const items = buildRunsExecutionJobListItems(
      [
        enrichedRun({
          run_id: "store-run-1",
          config: {
            execution_backend: "cluster",
          },
        }),
        activeRun({
          id: "runtime-run-2",
          store_run_id: "store-run-2",
          execution_backend: "wasm-local",
        }),
      ],
      [
        executionJobRecord({
          run_id: "store-run-1",
          status: "queued",
          progress: 5,
          progress_message: "queued",
          created_at: "2026-06-30T10:00:00Z",
        }),
        executionJobRecord({
          run_id: "store-run-1",
          status: "running",
          progress: 48,
          progress_message: "training fold 2",
          created_at: "2026-06-30T10:01:00Z",
          started_at: "2026-06-30T10:03:00Z",
        }),
        executionJobRecord({
          run_id: "store-run-2",
          requested_backend: "cluster",
          execution_backend: "wasm-local",
          status: "pending",
          progress: 0,
          progress_message: "waiting for worker",
        }),
      ],
    );

    expect(items.map(item => item.runId)).toEqual(["store-run-1", "runtime-run-2"]);
    expect(items[0].execution).toEqual({
      latestJobId: "job-1",
      requestedBackend: "cluster",
      executionBackend: "local-python",
      executionStatus: "running",
      progress: 48,
      progressMessage: "training fold 2",
      progressUnavailable: false,
      hasDurableRecord: true,
      jobCount: 1,
      activeJobCount: 1,
      failedJobCount: 0,
      hasMultipleJobs: false,
    });
    expect(items[1].execution).toEqual({
      latestJobId: "job-1",
      requestedBackend: "cluster",
      executionBackend: "wasm-local",
      executionStatus: "pending",
      progress: 0,
      progressMessage: "waiting for worker",
      progressUnavailable: false,
      hasDurableRecord: true,
      jobCount: 1,
      activeJobCount: 1,
      failedJobCount: 0,
      hasMultipleJobs: false,
    });
  });

  it("falls back cleanly when execution records are absent and keeps future values", () => {
    const items = buildRunsExecutionJobListItems(
      [
        enrichedRun({
          run_id: "local-run",
          config: {
            execution_backend: "local-python",
          },
        }),
        enrichedRun({
          run_id: "future-run",
        }),
      ],
      [
        executionJobRecord({
          run_id: "future-run",
          requested_backend: "gpu-grid",
          execution_backend: "edge-accelerator",
          status: "retrying",
          progress: 101,
          progress_message: "retry scheduled",
        }),
      ],
    );

    expect(items[0].execution).toEqual({
      latestJobId: null,
      requestedBackend: "local-python",
      executionBackend: "local-python",
      executionStatus: null,
      progress: null,
      progressMessage: null,
      progressUnavailable: false,
      hasDurableRecord: false,
      jobCount: 0,
      activeJobCount: 0,
      failedJobCount: 0,
      hasMultipleJobs: false,
    });
    expect(items[1].execution).toEqual({
      latestJobId: "job-1",
      requestedBackend: "gpu-grid",
      executionBackend: "edge-accelerator",
      executionStatus: "retrying",
      progress: 101,
      progressMessage: "retry scheduled",
      progressUnavailable: false,
      hasDurableRecord: true,
      jobCount: 1,
      activeJobCount: 0,
      failedJobCount: 0,
      hasMultipleJobs: false,
    });
  });

  it("preserves unavailable progress telemetry in execution job list indicators", () => {
    const items = buildRunsExecutionJobListItems(
      [enrichedRun({ run_id: "telemetry-run" })],
      [
        executionJobRecord({
          run_id: "telemetry-run",
          progress: 0,
          progress_message: "Progress unavailable",
          progress_unavailable: true,
        }),
      ],
    );

    expect(items[0].execution.progress).toBe(0);
    expect(items[0].execution.progressMessage).toBe("Progress unavailable");
    expect(items[0].execution.progressUnavailable).toBe(true);
  });

  it("summarizes multiple execution jobs for one run without losing the latest job", () => {
    const items = buildRunsExecutionJobListItems(
      [enrichedRun({ run_id: "multi-job-run" })],
      [
        executionJobRecord({
          job_id: "training-job",
          run_id: "multi-job-run",
          status: "completed",
          progress: 100,
          progress_message: "training done",
          created_at: "2026-06-30T10:00:00Z",
        }),
        executionJobRecord({
          job_id: "prediction-job",
          run_id: "multi-job-run",
          job_type: "prediction",
          status: "running",
          progress: 35,
          progress_message: "batch prediction",
          created_at: "2026-06-30T10:05:00Z",
        }),
        executionJobRecord({
          job_id: "export-job",
          run_id: "multi-job-run",
          job_type: "export",
          status: "failed",
          progress: 10,
          progress_message: "export failed",
          created_at: "2026-06-30T10:03:00Z",
        }),
      ],
    );

    expect(items[0].execution).toMatchObject({
      latestJobId: "prediction-job",
      executionStatus: "running",
      progress: 35,
      progressMessage: "batch prediction",
      progressUnavailable: false,
      hasDurableRecord: true,
      jobCount: 3,
      activeJobCount: 1,
      failedJobCount: 1,
      hasMultipleJobs: true,
    });
  });

  it("builds a task-panel read model from durable execution records", () => {
    const panel = buildRunsExecutionTaskPanelData([
      executionJobRecord({
        run_id: "completed-run",
        run_name: "Completed run",
        requested_backend: "local-python",
        execution_backend: "local-python",
        status: "completed",
        progress: 72,
        created_at: "2026-06-30T10:00:00Z",
      }),
      executionJobRecord({
        run_id: "cluster-run",
        run_name: "Cluster run",
        requested_backend: "cluster",
        execution_backend: "local-python",
        status: "running",
        progress: 150,
        progress_message: "training fold 4",
        created_at: "2026-06-30T11:00:00Z",
      }),
      executionJobRecord({
        run_id: "future-run",
        run_name: "Future run",
        requested_backend: "gpu-grid",
        execution_backend: "gpu-grid",
        status: "retrying",
        progress: -5,
        progress_message: "scheduler retry",
        created_at: "2026-06-30T12:00:00Z",
      }),
    ]);

    expect(panel).toMatchObject({
      hasTasks: true,
      totalCount: 3,
      activeCount: 1,
      completedCount: 1,
      failedCount: 0,
      remoteRequestedCount: 2,
    });
    expect(panel.items.map((item) => item.runId)).toEqual([
      "cluster-run",
      "future-run",
      "completed-run",
    ]);
    expect(panel.groups.map((group) => group.runId)).toEqual([
      "cluster-run",
      "future-run",
      "completed-run",
    ]);
    expect(panel.items[0]).toMatchObject({
      requestedBackend: "cluster",
      executionStatus: "running",
      progress: 100,
      progressMessage: "training fold 4",
      isActive: true,
      isOrphaned: false,
      isRemoteRequested: true,
    });
    expect(panel.items[1]).toMatchObject({
      requestedBackend: "gpu-grid",
      executionStatus: "retrying",
      progress: 0,
      isActive: false,
      isOrphaned: false,
      isRemoteRequested: true,
    });
    expect(panel.items[2]).toMatchObject({
      executionStatus: "completed",
      progress: 100,
      isActive: false,
      isOrphaned: false,
      isRemoteRequested: false,
    });
  });

  it("groups execution task records by run for the task dashboard", () => {
    const panel = buildRunsExecutionTaskPanelData([
      executionJobRecord({
        job_id: "training-job",
        run_id: "multi-run",
        run_name: "Multi job run",
        status: "completed",
        progress: 100,
        progress_message: "training done",
        created_at: "2026-06-30T10:00:00Z",
      }),
      executionJobRecord({
        job_id: "prediction-job",
        run_id: "multi-run",
        run_name: "Multi job run",
        job_type: "prediction",
        status: "running",
        progress: 35,
        progress_message: "batch prediction",
        created_at: "2026-06-30T10:05:00Z",
      }),
      executionJobRecord({
        job_id: "export-job",
        run_id: "multi-run",
        run_name: "Multi job run",
        job_type: "export",
        status: "failed",
        progress: 10,
        progress_message: "export failed",
        created_at: "2026-06-30T10:03:00Z",
      }),
    ]);

    expect(panel.groups).toHaveLength(1);
    expect(panel.groups[0]).toMatchObject({
      groupId: "multi-run",
      runId: "multi-run",
      runName: "Multi job run",
      runStatus: "running",
      totalCount: 3,
      activeCount: 1,
      completedCount: 1,
      failedCount: 1,
      remoteRequestedCount: 3,
      latestItem: expect.objectContaining({
        jobId: "prediction-job",
        executionStatus: "running",
        progressMessage: "batch prediction",
      }),
    });
    expect(panel.groups[0].items.map(item => item.jobId)).toEqual([
      "prediction-job",
      "export-job",
      "training-job",
    ]);
  });

  it("carries orphaned execution snapshots as first-class task state", () => {
    const panel = buildRunsExecutionTaskPanelData([
      executionJobRecord({
        job_id: "scheduler-job-123",
        run_id: "orphan-job",
        run_name: "Orphaned scheduler job",
        run_status: "orphaned",
        is_orphaned: true,
      }),
    ]);

    expect(panel.items[0]).toMatchObject({
      jobId: "scheduler-job-123",
      runId: "orphan-job",
      runName: "Orphaned scheduler job",
      runStatus: "orphaned",
      isOrphaned: true,
    });
    expect(panel.groups[0]).toMatchObject({
      groupId: "orphan-job",
      runId: "orphan-job",
      runName: "Orphaned scheduler job",
      runStatus: "orphaned",
      isOrphaned: true,
      totalCount: 1,
      latestItem: expect.objectContaining({
        jobId: "scheduler-job-123",
      }),
    });
  });

  it("keeps job id distinct from run id for task detail lookups", () => {
    const panel = buildRunsExecutionTaskPanelData([
      executionJobRecord({
        job_id: "cluster-job-456",
        run_id: "known-run",
        run_name: "Known run",
        run_status: "running",
        is_orphaned: false,
      }),
    ]);

    expect(panel.items[0]).toMatchObject({
      jobId: "cluster-job-456",
      runId: "known-run",
      isOrphaned: false,
    });
    expect(panel.items[0].jobId).not.toBe(panel.items[0].runId);
  });

  it("polls execution job detail only while the record is unresolved or active", () => {
    expect(getExecutionJobRecordDetailRefetchInterval(null)).toBe(10_000);
    expect(getExecutionJobRecordDetailRefetchInterval(undefined)).toBe(10_000);
    expect(getExecutionJobRecordDetailRefetchInterval(executionJobRecord({ status: "pending" }))).toBe(10_000);
    expect(getExecutionJobRecordDetailRefetchInterval(executionJobRecord({ status: "running" }))).toBe(10_000);
    expect(getExecutionJobRecordDetailRefetchInterval(executionJobRecord({ status: "completed" }))).toBe(false);
    expect(getExecutionJobRecordDetailRefetchInterval(executionJobRecord({ status: "failed" }))).toBe(false);
  });

  it("builds the run detail route lookup from runtime and store ids", () => {
    const lookup = buildRunPageIdLookup([
      activeRun({
        id: "runtime-run-1",
        store_run_id: "store-run-1",
      }),
      activeRun({
        id: "runtime-run-2",
        store_run_id: undefined,
      }),
    ]);

    expect(lookup.get("runtime-run-1")).toBe("runtime-run-1");
    expect(lookup.get("store-run-1")).toBe("runtime-run-1");
    expect(lookup.get("runtime-run-2")).toBe("runtime-run-2");
  });

  it("projects run storage and artifact metadata into UI-ready labels", () => {
    const metadata = buildRunStorageArtifactMetadata({
      ...enrichedRun({
        run_id: "repository-run",
        artifact_size_bytes: 1536,
        config: {
          execution_backend: "cluster",
        },
      }),
      artifact_count: 3,
      manifest_path: "/workspace/runs/repository-run/manifest.json",
      repository_id: "repo-1",
      run_dir: "/workspace/runs/repository-run",
      storage_backend: "result-repository",
      store_run_id: "store-repository-run",
      workspace_id: "workspace-1",
    } as EnrichedRun & Record<string, unknown>);

    expect(metadata).toMatchObject({
      runId: "repository-run",
      artifactCount: 3,
      artifactCountLabel: "3 artifacts",
      artifactSizeBytes: 1536,
      artifactSizeLabel: "1.5 KB",
      executionBackend: "cluster",
      executionBackendLabel: "Cluster",
      storageBackend: "result-repository",
      storageBackendLabel: "Result repository",
      provenance: {
        manifestPath: "/workspace/runs/repository-run/manifest.json",
        repositoryId: "repo-1",
        runDirectory: "/workspace/runs/repository-run",
        storeRunId: "store-repository-run",
        workspaceId: "workspace-1",
      },
    });
    expect(metadata.fields).toEqual([
      { key: "artifact-count", label: "Artifacts", value: "3 artifacts" },
      { key: "artifact-size", label: "Artifact size", value: "1.5 KB" },
      { key: "execution-backend", label: "Execution backend", value: "Cluster" },
      { key: "storage-backend", label: "Storage backend", value: "Result repository" },
      { key: "store-run-id", label: "Store run ID", value: "store-repository-run" },
      { key: "manifest-path", label: "Manifest path", value: "/workspace/runs/repository-run/manifest.json" },
      { key: "run-directory", label: "Run directory", value: "/workspace/runs/repository-run" },
      { key: "repository-id", label: "Repository ID", value: "repo-1" },
      { key: "workspace-id", label: "Workspace ID", value: "workspace-1" },
    ]);
  });

  it("keeps missing optional storage metadata explicit and derives counts from artifact lists", () => {
    expect(buildRunStorageArtifactMetadata(enrichedRun({ artifact_size_bytes: 0 }))).toMatchObject({
      artifactCount: null,
      artifactCountLabel: "Not reported",
      artifactSizeBytes: 0,
      artifactSizeLabel: "0 B",
      executionBackend: null,
      storageBackend: null,
      provenance: {
        manifestPath: null,
        repositoryId: null,
        runDirectory: null,
        storeRunId: null,
        workspaceId: null,
      },
      fields: [
        { key: "artifact-count", label: "Artifacts", value: "Not reported" },
        { key: "artifact-size", label: "Artifact size", value: "0 B" },
      ],
    });

    expect(buildRunsStorageArtifactMetadata([
      {
        ...enrichedRun({ run_id: "manifest-list", artifact_size_bytes: 1024 }),
        artifacts: {
          items: ["model.joblib", "metrics.json"],
        },
        storage_mode: "workspace-store",
      } as EnrichedRun & Record<string, unknown>,
    ])).toEqual([
      expect.objectContaining({
        runId: "manifest-list",
        artifactCount: 2,
        artifactCountLabel: "2 artifacts",
        artifactSizeLabel: "1 KB",
        storageBackend: "workspace-store",
        storageBackendLabel: "Workspace store",
      }),
    ]);

    expect(buildRunStorageArtifactMetadata(activeRun({
      id: "runtime-cluster-run",
      execution_backend: "cluster",
      manifest_path: "/runtime/manifest.json",
      run_dir: "/runtime",
      store_run_id: "store-cluster-run",
    }))).toMatchObject({
      runId: "runtime-cluster-run",
      artifactCount: null,
      artifactSizeBytes: 0,
      executionBackend: "cluster",
      executionBackendLabel: "Cluster",
      provenance: {
        manifestPath: "/runtime/manifest.json",
        runDirectory: "/runtime",
        storeRunId: "store-cluster-run",
      },
    });
  });

  it("derives metric selection context from dataset summaries and chain scores", () => {
    const metricContext = buildRunsMetricSelectionContext([
      enrichedRun({
        datasets: [
          dataset({
            metric: "rmse",
            task_type: "regression",
            best_avg_val_score: 0.24,
            top_5: [
              chain({
                scores: {
                  val: { root_mean_squared_error: 0.24 },
                  test: { rmse: 0.26 },
                },
                final_scores: { r2: 0.91 },
              }),
            ],
          }),
          dataset({
            metric: "accuracy",
            task_type: "binary_classification",
            top_5: [
              chain({
                avg_val_score: 0.92,
                scores: {
                  val: { accuracy: 0.92 },
                  test: { accuracy: 0.9 },
                },
                final_agg_scores: {
                  test: { balanced_accuracy: 0.89 },
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(metricContext).toEqual({
      taskType: null,
      taskTypes: ["regression", "classification"],
      availableMetricKeys: ["r2", "rmse", "accuracy", "balanced_accuracy"],
    });
  });

  it("summarizes status counts and total pipeline count", () => {
    expect(summarizeRunsPageStats([
      enrichedRun({ status: "running", pipeline_runs_count: 2 }),
      enrichedRun({ status: "queued", pipeline_runs_count: 3 }),
      enrichedRun({ status: "completed", pipeline_runs_count: 5 }),
      enrichedRun({ status: "failed", pipeline_runs_count: 7 }),
      enrichedRun({ status: "partial", pipeline_runs_count: 11 }),
    ])).toEqual({
      runningCount: 1,
      queuedCount: 1,
      completedCount: 1,
      failedCount: 1,
      totalPipelines: 28,
    });
  });
});
