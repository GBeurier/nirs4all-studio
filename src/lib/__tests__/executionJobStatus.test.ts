import { describe, expect, it } from "vitest";

import {
  isActiveExecutionStatus,
  isFailedExecutionStatus,
  isRetryableExecutionStatus,
} from "../runs/executionJobStatus";

describe("execution job status predicates", () => {
  it.each(["pending", "queued", "running"])("treats %s as active", (status) => {
    expect(isActiveExecutionStatus(status)).toBe(true);
    expect(isFailedExecutionStatus(status)).toBe(false);
    expect(isRetryableExecutionStatus(status)).toBe(false);
  });

  it.each(["failed", "cancelled"])("treats %s as failed and retryable", (status) => {
    expect(isActiveExecutionStatus(status)).toBe(false);
    expect(isFailedExecutionStatus(status)).toBe(true);
    expect(isRetryableExecutionStatus(status)).toBe(true);
  });

  it.each(["completed", "unknown-status", ""])("treats %s as neither active, failed, nor retryable", (status) => {
    expect(isActiveExecutionStatus(status)).toBe(false);
    expect(isFailedExecutionStatus(status)).toBe(false);
    expect(isRetryableExecutionStatus(status)).toBe(false);
  });
});
