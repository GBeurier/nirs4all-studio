import { describe, expect, it } from "vitest";

import {
  buildExecutionJobRecordDetail,
  type ExecutionJobRecordDetail,
  type ExecutionJobRecordDetailAction,
} from "../runs/executionJobRecordDetail";
import type { ExecutionJobRecord } from "../runs/executionJobRecords";

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
    request: {
      run_id: "run-1",
      requested_backend: "cluster",
    },
    driver: {
      backend: "local-python",
      mode: "in-process",
    },
    metrics: {},
    error: null,
    run_id: "run-1",
    run_name: "Calibration run",
    run_status: "running",
    is_orphaned: false,
    ...overrides,
  };
}

function buildDetail(record: ExecutionJobRecord): ExecutionJobRecordDetail {
  return buildExecutionJobRecordDetail(record);
}

function summaryValues(detail: ExecutionJobRecordDetail): Record<string, unknown> {
  return Object.fromEntries(detail.fields.map(field => [field.id, field.value]));
}

function jsonSectionValues(detail: ExecutionJobRecordDetail): Record<string, Record<string, unknown>> {
  return Object.fromEntries(detail.jsonSections.map(section => [section.id, section.value]));
}

function actionById(
  detail: ExecutionJobRecordDetail,
  id: ExecutionJobRecordDetailAction["id"],
): ExecutionJobRecordDetailAction {
  const action = detail.actions.find(item => item.id === id);
  expect(action).toBeDefined();
  return action!;
}

function expectTokenValuePreserved(value: unknown, expectedToken: string): void {
  const normalizedValue = String(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
  expect(normalizedValue).toBe(expectedToken);
}

describe("execution job record detail", () => {
  it("builds summary fields from the execution job and linked run", () => {
    const detail = buildDetail(executionJobRecord({
      job_id: "job-42",
      requested_backend: "cluster",
      execution_backend: "local-python",
      status: "running",
      progress: 42,
      progress_message: "training fold 2/5",
      created_at: "2026-06-30T10:00:00Z",
      started_at: "2026-06-30T10:01:00Z",
      completed_at: "2026-06-30T10:12:00Z",
      error: "Worker throttled",
      run_id: "run-42",
      run_name: "Spectral calibration",
      run_status: "running",
    }));

    expect(detail.fields.map(field => field.id)).toEqual(expect.arrayContaining([
      "job_id",
      "run_id",
      "run_name",
      "run_status",
      "requested_backend",
      "execution_backend",
      "status",
      "created_at",
      "started_at",
      "completed_at",
      "progress",
      "error",
    ]));
    expect(summaryValues(detail)).toMatchObject({
      job_id: "job-42",
      run_id: "run-42",
      run_name: "Spectral calibration",
      error: "Worker throttled",
    });
    expect(String(summaryValues(detail).created_at)).not.toBe("");
    expect(String(summaryValues(detail).started_at)).not.toBe("");
    expect(String(summaryValues(detail).completed_at)).not.toBe("");
    expect(String(summaryValues(detail).progress)).toContain("42");
  });

  it("builds JSON sections for non-empty request, driver, metadata, and metrics payloads", () => {
    const detail = buildDetail(executionJobRecord({
      request: {
        run_id: "run-1",
        dataset_id: "dataset-1",
        options: { folds: 5 },
      },
      driver: {
        backend: "cluster",
        worker_id: "worker-1",
      },
      metadata: {
        queue: "gpu",
        attempt: 2,
      },
      metrics: {
        r2: 0.91,
        rmse: 0.12,
      },
    }));

    expect(jsonSectionValues(detail)).toEqual({
      request: {
        run_id: "run-1",
        dataset_id: "dataset-1",
        options: { folds: 5 },
      },
      driver: {
        backend: "cluster",
        worker_id: "worker-1",
      },
      metadata: {
        queue: "gpu",
        attempt: 2,
      },
      metrics: {
        r2: 0.91,
        rmse: 0.12,
      },
    });
  });

  it("omits empty JSON sections", () => {
    const detail = buildDetail(executionJobRecord({
      request: {},
      driver: {},
      metadata: {},
      metrics: {},
    }));

    expect(detail.jsonSections).toEqual([]);
  });

  it.each([
    ["pending", "run-1", true, true],
    ["queued", "run-1", true, true],
    ["running", "run-1", true, true],
    ["completed", "run-1", false, false],
    ["failed", "run-1", false, false],
    ["cancelled", "run-1", false, false],
    ["running", "", true, true],
  ] as const)(
    "sets cancel action visibility for %s jobs with run id %s",
    (status, runId, visible, enabled) => {
      const detail = buildDetail(executionJobRecord({ status, run_id: runId }));

      expect(actionById(detail, "cancel")).toMatchObject({
        visible,
        enabled,
      });
    },
  );

  it("keeps cancel hidden and disabled for active execution records without a job id", () => {
    const detail = buildDetail(executionJobRecord({
      job_id: "",
      run_id: "run-1",
      status: "running",
    }));

    expect(actionById(detail, "cancel")).toMatchObject({
      visible: false,
      enabled: false,
      availability: "unavailable",
      jobId: "",
    });
  });

  it("exposes job cancel but not run retry for orphaned active execution records", () => {
    const detail = buildDetail(executionJobRecord({
      is_orphaned: true,
      run_id: "orphan-run",
      status: "running",
    }));

    expect(actionById(detail, "cancel")).toMatchObject({
      visible: true,
      enabled: true,
      availability: "available",
      jobId: "job-1",
      runId: null,
    });
    expect(actionById(detail, "retry")).toMatchObject({
      visible: false,
      enabled: false,
      availability: "unavailable",
    });
  });

  it.each([
    ["failed", "run-1", true, true],
    ["cancelled", "run-1", true, true],
    ["pending", "run-1", false, false],
    ["running", "run-1", false, false],
    ["completed", "run-1", false, false],
    ["failed", "", false, false],
  ] as const)(
    "sets retry action visibility for %s jobs with run id %s",
    (status, runId, visible, enabled) => {
      const detail = buildDetail(executionJobRecord({ status, run_id: runId }));

      expect(actionById(detail, "retry")).toMatchObject({
        visible,
        enabled,
      });
    },
  );

  it("keeps worker logs visible but unavailable when no logs URL or payload is present", () => {
    const detail = buildDetail(executionJobRecord());

    expect(actionById(detail, "workerLogs")).toMatchObject({
      visible: true,
      enabled: false,
    });
    expect(actionById(detail, "workerLogs").reason).toEqual(expect.any(String));
  });

  it("marks worker logs available when a logs URL is present", () => {
    const detail = buildDetail(executionJobRecord({
      driver: {
        backend: "cluster",
        worker_logs_url: "https://cluster.example/logs/job-1",
      },
    }));

    expect(actionById(detail, "workerLogs")).toMatchObject({
      visible: true,
      enabled: true,
      availability: "available",
      href: "https://cluster.example/logs/job-1",
      reason: null,
    });
  });

  it("preserves future unknown values without throwing", () => {
    const record = executionJobRecord({
      job_type: "batch-training",
      requested_backend: "gpu-grid",
      execution_backend: "edge-worker",
      status: "retrying",
      run_status: "paused",
      progress: 7,
      progress_message: "waiting for future scheduler",
    });

    expect(() => buildDetail(record)).not.toThrow();

    const detail = buildDetail(record);
    const values = summaryValues(detail);

    expectTokenValuePreserved(values.requested_backend, "gpu-grid");
    expectTokenValuePreserved(values.execution_backend, "edge-worker");
    expectTokenValuePreserved(values.status, "retrying");
    expectTokenValuePreserved(values.run_status, "paused");
    expect(String(values.progress)).toContain("7");
  });
});
