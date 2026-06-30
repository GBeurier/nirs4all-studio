import { describe, expect, it } from "vitest";
import {
  getExecutionTaskGroupKey,
  getExecutionTaskItemKey,
  getVisibleExecutionTaskGroups,
  getVisibleExecutionTaskItems,
} from "../runs/executionTaskView";
import type {
  RunsExecutionTaskGroup,
  RunsExecutionTaskItem,
} from "../runs/pageData";

function executionTask(id: string, overrides: Partial<RunsExecutionTaskItem> = {}): RunsExecutionTaskItem {
  return {
    jobId: `job-${id}`,
    runId: `run-${id}`,
    runName: `Run ${id}`,
    runStatus: "running",
    requestedBackend: "cluster",
    executionBackend: "local-python",
    executionStatus: "running",
    progress: 25,
    progressMessage: "training",
    progressUnavailable: false,
    isActive: true,
    isOrphaned: false,
    isRemoteRequested: false,
    createdAt: "2026-06-30T10:00:00Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function executionGroup(id: string, overrides: Partial<RunsExecutionTaskGroup> = {}): RunsExecutionTaskGroup {
  const latestItem = executionTask(id);

  return {
    groupId: `group-${id}`,
    runId: latestItem.runId,
    runName: latestItem.runName,
    runStatus: latestItem.runStatus,
    isOrphaned: false,
    totalCount: 2,
    activeCount: 1,
    completedCount: 0,
    failedCount: 0,
    remoteRequestedCount: 0,
    latestItem,
    items: [latestItem],
    ...overrides,
  };
}

describe("execution task view helpers", () => {
  it("builds a stable item key from jobId, runId, createdAt, and executionStatus", () => {
    const item = executionTask("stable", {
      jobId: "job-a",
      runId: "run-a",
      createdAt: "2026-06-30T12:34:56Z",
      executionStatus: "queued",
    });
    const sameKeyItem = executionTask("changed-display-fields", {
      jobId: "job-a",
      runId: "run-a",
      runName: "Renamed run",
      progress: 90,
      progressMessage: "updated",
      createdAt: "2026-06-30T12:34:56Z",
      executionStatus: "queued",
    });

    expect(getExecutionTaskItemKey(item)).toBe("job-a:run-a:2026-06-30T12:34:56Z:queued");
    expect(getExecutionTaskItemKey(sameKeyItem)).toBe(getExecutionTaskItemKey(item));
  });

  it("uses the groupId as the group key", () => {
    expect(getExecutionTaskGroupKey(executionGroup("run-a", { groupId: "group-a" }))).toBe("group-a");
  });

  it("keeps the first four items, then adds non-visible orphaned items up to six total", () => {
    const first = executionTask("1");
    const second = executionTask("2", { isOrphaned: true });
    const third = executionTask("3");
    const fourth = executionTask("4");
    const alreadyVisibleDuplicate = executionTask("duplicate", {
      jobId: second.jobId,
      runId: second.runId,
      createdAt: second.createdAt,
      executionStatus: second.executionStatus,
      isOrphaned: true,
    });
    const fifth = executionTask("5", { isOrphaned: true });
    const nonOrphaned = executionTask("6");
    const seventh = executionTask("7", { isOrphaned: true });
    const eighth = executionTask("8", { isOrphaned: true });

    expect(getVisibleExecutionTaskItems([
      first,
      second,
      third,
      fourth,
      alreadyVisibleDuplicate,
      fifth,
      nonOrphaned,
      seventh,
      eighth,
    ])).toEqual([
      first,
      second,
      third,
      fourth,
      fifth,
      seventh,
    ]);
  });

  it("keeps only grouped task groups and limits the result to three groups", () => {
    const visibleGroups = getVisibleExecutionTaskGroups([
      executionGroup("single", { totalCount: 1 }),
      executionGroup("two", { totalCount: 2 }),
      executionGroup("three", { totalCount: 3 }),
      executionGroup("also-single", { totalCount: 1 }),
      executionGroup("four", { totalCount: 4 }),
      executionGroup("five", { totalCount: 5 }),
    ]);

    expect(visibleGroups.map(getExecutionTaskGroupKey)).toEqual([
      "group-two",
      "group-three",
      "group-four",
    ]);
  });
});
