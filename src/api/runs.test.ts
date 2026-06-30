import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelExecutionJobRecord,
  createRunGroup,
  ExecutionJobCommandError,
  getRunExecutionBackends,
  getRunExecutionJobRecord,
  getWorkspaceExecutionJobRecord,
  listRunExecutionJobRecords,
} from "./runs";
import {
  NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
  type NativeExperimentLaunchPayload,
} from "@/lib/experimentExecutionAdapter";
import { resetBackendUrl } from "./transport";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  resetBackendUrl();
  vi.unstubAllGlobals();
});

describe("runs API execution job records", () => {
  it("reads execution backend capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      default_backend: "local-python",
      backends: [
        {
          backend: "local-python",
          label: "Local Python",
          available: true,
          mode: "in-process",
          supports_progress: true,
          supports_cancellation: true,
          metadata: {},
        },
        {
          backend: "cluster",
          label: "Cluster",
          available: false,
          mode: "in-process",
          supports_progress: false,
          supports_cancellation: false,
          metadata: { reason: "driver_unavailable" },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await getRunExecutionBackends();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-backends",
      expect.any(Object),
    );
    expect(payload.backends).toHaveLength(2);
    expect(payload.backends[1]).toMatchObject({
      backend: "cluster",
      available: false,
      metadata: { reason: "driver_unavailable" },
    });
  });

  it("submits native run-group payloads without wrapping the body", async () => {
    const payload: NativeExperimentLaunchPayload = {
      legacyConfig: {
        name: "Campaign",
        dataset_ids: ["dataset-1"],
        pipeline_ids: ["pipeline-1"],
        execution_backend: "cluster",
      },
      manifest: {
        version: NATIVE_EXPERIMENT_LAUNCH_PAYLOAD_VERSION,
        legacyExperimentName: "Campaign",
        legacyDatasetCount: 1,
        legacyPipelineCount: 1,
        strictCampaignCount: 0,
        skippedRunCount: 0,
        sourceRunIds: [],
        skippedRunIds: [],
      },
      strictCampaignSpecs: {
        splitSpecs: [],
        skippedRunIds: [],
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "run-group-1" }));
    vi.stubGlobal("fetch", fetchMock);

    await createRunGroup(payload);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-groups",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  });

  it("lists execution job records with filters and normalizes the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      records: [
        {
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
          request: { requested_backend: "cluster" },
          driver: { backend: "local-python" },
          run_id: "run-1",
          run_name: "Cluster run",
          run_status: "running",
          scheduler_hint: "future",
        },
        { job_id: "invalid" },
      ],
      total: 2,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const payload = await listRunExecutionJobRecords({
      run_status: ["running", "completed"],
      execution_status: "running",
      requested_backend: "cluster",
      include_orphaned: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-job-records?run_status=running%2Ccompleted&execution_status=running&requested_backend=cluster&include_orphaned=true",
      expect.any(Object),
    );
    expect(payload.total).toBe(2);
    expect(payload.records).toHaveLength(1);
    expect(payload.records[0]).toMatchObject({
      job_id: "run-1",
      requested_backend: "cluster",
      scheduler_hint: "future",
    });
  });

  it("omits include_orphaned from the execution job records URL when false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      records: [],
      total: 0,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await listRunExecutionJobRecords({ include_orphaned: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-job-records",
      expect.any(Object),
    );
  });

  it("reads and normalizes one execution job record for a run", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      job_id: "run-2",
      job_type: "training",
      requested_backend: "wasm-local",
      execution_backend: "local-python",
      execution_mode: "in-process",
      status: "completed",
      progress: 100,
      progress_message: "done",
      created_at: "2026-06-30T11:00:00",
      started_at: "2026-06-30T11:00:01",
      completed_at: "2026-06-30T11:03:00",
      request: { requested_backend: "wasm-local" },
      driver: { backend: "local-python" },
      run_id: "run-2",
      run_name: "WASM run",
      run_status: "completed",
      is_orphaned: false,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const record = await getRunExecutionJobRecord("run-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/run-2/execution-job-record",
      expect.any(Object),
    );
    expect(record).toMatchObject({
      job_id: "run-2",
      requested_backend: "wasm-local",
      status: "completed",
      progress: 100,
      is_orphaned: false,
    });
  });

  it("reads and normalizes one workspace execution job record by job id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      job_id: "orphan-job",
      job_type: "training",
      requested_backend: "cluster",
      execution_backend: "cluster",
      execution_mode: "remote-worker",
      status: "failed",
      progress: 40,
      progress_message: "worker failed",
      created_at: "2026-06-30T12:00:00",
      started_at: "2026-06-30T12:00:05",
      completed_at: "2026-06-30T12:04:00",
      request: { run_name: "Orphaned cluster run" },
      driver: { backend: "cluster" },
      error: "boom",
      is_orphaned: true,
      run_id: "orphan-job",
      run_name: "Orphaned cluster run",
      run_status: "orphaned",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const record = await getWorkspaceExecutionJobRecord("orphan-job");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-job-records/orphan-job",
      expect.any(Object),
    );
    expect(record).toMatchObject({
      job_id: "orphan-job",
      requested_backend: "cluster",
      status: "failed",
      run_status: "orphaned",
      is_orphaned: true,
    });
  });

  it("cancels a workspace execution job record by job id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "cancel",
      job_id: "orphan-job",
      success: true,
      message: "Cancellation requested",
      backend: "cluster",
      run_id: null,
      metadata: {},
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await cancelExecutionJobRecord("orphan-job");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-job-records/orphan-job/cancel",
      expect.objectContaining({ method: "POST" }),
    );
    expect(response).toMatchObject({
      action: "cancel",
      job_id: "orphan-job",
      success: true,
      backend: "cluster",
    });
  });

  it("rejects with the command message when cancelling a missing execution job record", async () => {
    const commandMessage = "Execution job missing-job could not be found";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      action: "cancel",
      job_id: "missing-job",
      success: false,
      message: commandMessage,
      backend: null,
      run_id: null,
      metadata: {},
    }));
    vi.stubGlobal("fetch", fetchMock);

    let error: unknown;
    try {
      await cancelExecutionJobRecord("missing-job");
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeInstanceOf(ExecutionJobCommandError);
    expect(error).toMatchObject({
      detail: commandMessage,
      kind: "execution_job_command_error",
      response: {
        job_id: "missing-job",
        success: false,
        message: commandMessage,
      },
    });
    expect(error).not.toHaveProperty("status");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs/execution-job-records/missing-job/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
