import { describe, expect, it } from "vitest";

import { getExecutionJobRecordRefetchInterval, getRunDetailRefetchInterval } from "./polling";

describe("getRunDetailRefetchInterval", () => {
  it("polls active runs every second and slows down while the WebSocket is connected", () => {
    expect(getRunDetailRefetchInterval("running", false)).toBe(1000);
    expect(getRunDetailRefetchInterval("queued", false)).toBe(1000);
    expect(getRunDetailRefetchInterval("running", true)).toBe(10_000);
  });

  it("stops polling for finished or unknown runs", () => {
    expect(getRunDetailRefetchInterval("completed", false)).toBe(false);
    expect(getRunDetailRefetchInterval(undefined, false)).toBe(false);
  });
});

describe("getExecutionJobRecordRefetchInterval", () => {
  const base = { queryStatus: "success", dataUpdateCount: 1, wsConnected: false } as const;

  it("stops polling a job whose record stays missing (404 resolves to null)", () => {
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: null })).toBe(1000);
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: null, dataUpdateCount: 11 })).toBe(false);
  });

  it("does not hammer the endpoint while the first read is pending, and backs off after errors", () => {
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: undefined, queryStatus: "pending" })).toBe(false);
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: undefined, queryStatus: "error" })).toBe(5000);
  });

  it("polls running and pending jobs, slower once the WebSocket is connected", () => {
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: { status: "running" } })).toBe(1000);
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: { status: "pending" }, wsConnected: true })).toBe(10_000);
  });

  it("stops polling terminal jobs", () => {
    expect(getExecutionJobRecordRefetchInterval({ ...base, record: { status: "completed" } })).toBe(false);
  });
});
