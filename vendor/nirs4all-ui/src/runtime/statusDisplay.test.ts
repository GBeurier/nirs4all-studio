import { describe, expect, it } from "vitest";

import {
  buildRuntimeResultStatusView,
  getRuntimeResultEmptyMessage,
  getRuntimeResultStatusDisplay,
  getRuntimeResultStatusProgress,
  isBusyRuntimeResultStatus,
  isRuntimeResultStatus,
  resolveRuntimeResultStatus,
} from "./statusDisplay.js";

describe("runtime status display foundation", () => {
  it("recognizes and resolves runtime/result statuses", () => {
    expect(isRuntimeResultStatus("running")).toBe(true);
    expect(isRuntimeResultStatus("cancelled")).toBe(false);
    expect(isRuntimeResultStatus("toString")).toBe(false);
    expect(resolveRuntimeResultStatus("partial")).toBe("partial");
    expect(resolveRuntimeResultStatus("cancelled")).toBe("completed");
    expect(resolveRuntimeResultStatus(null, "failed")).toBe("failed");
  });

  it("projects reusable display tokens without React dependencies", () => {
    expect(getRuntimeResultStatusDisplay("running")).toEqual({
      status: "running",
      label: "Running",
      colorClass: "text-chart-2",
      bgClass: "bg-chart-2/10",
      iconClass: "animate-spin",
      icon: "refresh",
      badgeVariant: "secondary",
      isBusy: true,
    });

    expect(getRuntimeResultStatusDisplay("completed")).toMatchObject({
      icon: "check",
      badgeVariant: "default",
      isBusy: false,
    });
  });

  it("keeps busy-state and progress projection tied to active statuses", () => {
    expect(isBusyRuntimeResultStatus("queued")).toBe(true);
    expect(isBusyRuntimeResultStatus("running")).toBe(true);
    expect(isBusyRuntimeResultStatus("failed")).toBe(false);
    expect(isBusyRuntimeResultStatus("cancelled")).toBe(false);
    expect(getRuntimeResultStatusProgress("running", 42)).toBe(42);
    expect(getRuntimeResultStatusProgress("completed", 100)).toBeNull();
    expect(buildRuntimeResultStatusView("running", 15)).toMatchObject({
      status: "running",
      progress: 15,
    });
  });

  it("selects status-aware empty-state copy from caller-owned messages", () => {
    const messages = {
      queued: "Waiting",
      running: "Still running",
      fallback: "Nothing available",
    };

    expect(getRuntimeResultEmptyMessage("queued", messages)).toBe("Waiting");
    expect(getRuntimeResultEmptyMessage("running", messages)).toBe("Still running");
    expect(getRuntimeResultEmptyMessage("failed", messages)).toBe("Nothing available");
  });
});
