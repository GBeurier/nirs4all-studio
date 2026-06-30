import { describe, expect, it } from "vitest";

import {
  buildExecutionJobRecordsQueryParams,
  buildExecutionJobRecordsUrl,
  EXECUTION_JOB_RECORDS_ENDPOINT,
  isExecutionJobRecordsListPayload,
  normalizeExecutionJobRecord,
  normalizeExecutionJobRecordsListPayload,
  type ExecutionJobRecord,
} from "@/lib/runs/executionJobRecords";

function executionJobRecord(overrides: Partial<ExecutionJobRecord> = {}): ExecutionJobRecord {
  return {
    job_id: "run-1",
    job_type: "training",
    requested_backend: "cluster",
    execution_backend: "local-python",
    execution_mode: "in-process",
    status: "running",
    progress: 25,
    progress_message: "training",
    created_at: "2026-06-30T10:00:00",
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
    run_name: "Cluster run",
    run_status: "running",
    is_orphaned: false,
    ...overrides,
  };
}

describe("runs execution job records contract", () => {
  it("normalizes list payloads into the frontend contract", () => {
    const payload = normalizeExecutionJobRecordsListPayload({
      records: [
        executionJobRecord({
          job_id: "run-2",
          requested_backend: "wasm-local",
          status: "completed",
          progress: 100,
          progress_message: "done",
          started_at: "2026-06-30T10:01:00",
          completed_at: "2026-06-30T10:03:00",
          request: { requested_backend: "wasm-local" },
          driver: { backend: "local-python", mode: "in-process" },
          run_id: "run-2",
          run_name: "WASM run",
          run_status: "completed",
        }),
      ],
      total: 1,
    });

    expect(payload).toEqual({
      records: [
        expect.objectContaining({
          job_id: "run-2",
          requested_backend: "wasm-local",
          status: "completed",
          progress: 100,
          progress_message: "done",
          request: { requested_backend: "wasm-local" },
          driver: { backend: "local-python", mode: "in-process" },
          run_id: "run-2",
          run_name: "WASM run",
          run_status: "completed",
        }),
      ],
      total: 1,
    });
    expect(isExecutionJobRecordsListPayload(payload)).toBe(true);
  });

  it("builds comma-separated query params for supported filters", () => {
    const params = buildExecutionJobRecordsQueryParams({
      run_status: [" completed ", "running", "completed", ""],
      execution_status: " running ",
      requested_backend: ["cluster", "wasm-local", "cluster"],
      include_orphaned: true,
    });

    expect(params.get("run_status")).toBe("completed,running");
    expect(params.get("execution_status")).toBe("running");
    expect(params.get("requested_backend")).toBe("cluster,wasm-local");
    expect(params.get("include_orphaned")).toBe("true");
    expect([...params.keys()]).toEqual([
      "run_status",
      "execution_status",
      "requested_backend",
      "include_orphaned",
    ]);
  });

  it("omits blank filters and builds the route URL", () => {
    expect(buildExecutionJobRecordsQueryParams({
      run_status: [],
      execution_status: " ",
      requested_backend: null,
      include_orphaned: false,
    }).toString()).toBe("");

    expect(buildExecutionJobRecordsUrl()).toBe(EXECUTION_JOB_RECORDS_ENDPOINT);
    expect(buildExecutionJobRecordsUrl({ requested_backend: "cluster" })).toBe(
      `${EXECUTION_JOB_RECORDS_ENDPOINT}?requested_backend=cluster`,
    );
    expect(buildExecutionJobRecordsUrl({ include_orphaned: true })).toBe(
      `${EXECUTION_JOB_RECORDS_ENDPOINT}?include_orphaned=true`,
    );
  });

  it("keeps unknown future fields and enum values while normalizing known fields", () => {
    const payload = normalizeExecutionJobRecordsListPayload({
      records: [
        executionJobRecord({
          job_id: "future-run",
          job_type: "batch-training",
          requested_backend: "gpu-grid",
          execution_backend: "gpu-grid",
          execution_mode: "remote",
          status: "retrying",
          progress: 42,
          request: { requested_backend: "gpu-grid", priority: "high" },
          driver: { backend: "gpu-grid", queue: "long" },
          run_id: "future-run",
          run_status: "paused",
          scheduler_attempt: 2,
          nested_future_field: { retained: true },
        }),
      ],
      total: 1,
      next_cursor: "cursor-1",
    });

    expect(payload.next_cursor).toBe("cursor-1");
    expect(payload.records[0]).toMatchObject({
      job_type: "batch-training",
      requested_backend: "gpu-grid",
      status: "retrying",
      run_status: "paused",
      scheduler_attempt: 2,
      nested_future_field: { retained: true },
      request: { requested_backend: "gpu-grid", priority: "high" },
      driver: { backend: "gpu-grid", queue: "long" },
    });
    expect(isExecutionJobRecordsListPayload(payload)).toBe(true);
  });

  it("accepts future records without progress fields and marks progress unavailable", () => {
    const cases: Array<[ExecutionJobRecord["status"], number]> = [
      ["completed", 100],
      ["running", 0],
      ["pending", 0],
      ["queued-on-runner", 0],
    ];

    cases.forEach(([status, expectedProgress]) => {
      const record: Record<string, unknown> = executionJobRecord({
        job_id: `future-${status}`,
        status,
      });
      delete record.progress;
      delete record.progress_message;

      expect(normalizeExecutionJobRecord(record)).toMatchObject({
        job_id: `future-${status}`,
        status,
        progress: expectedProgress,
        progress_message: "Progress unavailable",
        progress_unavailable: true,
      });
    });
  });

  it("preserves explicit progress unavailable markers from durable snapshots", () => {
    expect(normalizeExecutionJobRecord(executionJobRecord({
      job_id: "scheduler-marked-unavailable",
      progress: 35,
      progress_message: "last known progress",
      progress_unavailable: true,
    }))).toMatchObject({
      job_id: "scheduler-marked-unavailable",
      progress: 35,
      progress_message: "last known progress",
      progress_unavailable: true,
    });
  });

  it("accepts future orphan records without run metadata and infers safe run fields", () => {
    const record: Record<string, unknown> = executionJobRecord({
      job_id: "future-orphan-job",
      job_type: "remote-batch-training",
      status: "queued-on-runner",
      request: {
        requested_backend: "gpu-grid",
        run_name: "Remote batch run",
      },
    });
    delete record.run_id;
    delete record.run_name;
    delete record.run_status;
    delete record.is_orphaned;

    expect(normalizeExecutionJobRecord(record)).toMatchObject({
      job_id: "future-orphan-job",
      job_type: "remote-batch-training",
      status: "queued-on-runner",
      run_id: "future-orphan-job",
      run_name: "Remote batch run",
      run_status: "orphaned",
      is_orphaned: true,
    });
  });

  it("accepts future orphan records with null run metadata and infers safe run fields", () => {
    expect(normalizeExecutionJobRecord({
      ...executionJobRecord({
        job_id: "null-run-metadata-job",
        request: {
          requested_backend: "cluster",
          run_name: "Recovered run name",
        },
      }),
      run_id: null,
      run_name: null,
      run_status: null,
      is_orphaned: null,
    })).toMatchObject({
      job_id: "null-run-metadata-job",
      run_id: "null-run-metadata-job",
      run_name: "Recovered run name",
      run_status: "orphaned",
      is_orphaned: true,
    });
  });

  it("guards malformed payloads without throwing during normalization", () => {
    expect(isExecutionJobRecordsListPayload({
      records: [executionJobRecord({ request: [] as unknown as Record<string, unknown> })],
      total: 1,
    })).toBe(false);

    expect(normalizeExecutionJobRecordsListPayload({
      records: [
        { job_id: "missing-required-fields" },
        executionJobRecord({ job_id: "valid-run" }),
      ],
      total: "not-a-number",
    })).toMatchObject({
      records: [expect.objectContaining({ job_id: "valid-run" })],
      total: 1,
    });
  });
});
