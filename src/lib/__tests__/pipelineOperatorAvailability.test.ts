import { describe, expect, it } from "vitest";

import type { PreflightIssue, PreflightResult } from "@/api/runs";

import {
  formatPreflightIssueMessages,
  resolvePreflightIssues,
} from "../pipelineOperatorAvailability";

const missingModuleIssue: PreflightIssue = {
  type: "missing_module",
  message: "Missing module nirs4all.methods",
  details: {
    pipeline_id: "p1",
    pipeline_name: "PLS",
    step_id: "step-1",
  },
};

const envMismatchIssue: PreflightIssue = {
  type: "env_mismatch",
  message: "Configured Python does not match running Python",
};

function resolve(preflight: PreflightResult) {
  return resolvePreflightIssues(preflight);
}

describe("pipelineOperatorAvailability preflight resolution", () => {
  it("marks ready preflight results as ready", () => {
    expect(resolve({ ready: true, issues: [] })).toEqual({
      status: "ready",
      missingIssues: [],
      blockingIssues: [],
      message: "",
    });
  });

  it("separates missing operator issues from blocking preflight failures", () => {
    const resolution = resolve({
      ready: false,
      issues: [missingModuleIssue],
    });

    expect(resolution.status).toBe("missing_operators");
    expect(resolution.missingIssues).toEqual([missingModuleIssue]);
    expect(resolution.blockingIssues).toEqual([]);
    expect(resolution.message).toBe("Missing module nirs4all.methods");
  });

  it("keeps all messages when blocking issues are present", () => {
    const resolution = resolve({
      ready: false,
      issues: [missingModuleIssue, envMismatchIssue],
    });

    expect(resolution.status).toBe("blocking");
    expect(resolution.missingIssues).toEqual([missingModuleIssue]);
    expect(resolution.blockingIssues).toEqual([envMismatchIssue]);
    expect(resolution.message).toBe([
      "Missing module nirs4all.methods",
      "Configured Python does not match running Python",
    ].join("\n"));
  });

  it("formats preflight issue messages with newline separators", () => {
    expect(formatPreflightIssueMessages([missingModuleIssue, envMismatchIssue])).toBe([
      "Missing module nirs4all.methods",
      "Configured Python does not match running Python",
    ].join("\n"));
  });
});
