import { describe, expect, it } from "vitest";

import {
  getInspectorPanelRenderState,
  getInspectorQueryErrorMessage,
} from "@/lib/inspector/panelRenderState";

describe("inspector panel render state", () => {
  it("prefers a panel notice over query errors", () => {
    expect(getInspectorPanelRenderState({
      notice: {
        title: "Needs regression",
        body: "Select regression chains.",
        tone: "warning",
      },
      error: new Error("network failed"),
      errorFallback: "Fallback",
    })).toEqual({
      kind: "notice",
      notice: {
        title: "Needs regression",
        body: "Select regression chains.",
        tone: "warning",
      },
    });
  });

  it("returns a normalized error state when no notice exists", () => {
    expect(getInspectorPanelRenderState({
      notice: null,
      error: { detail: "Backend detail" },
      errorFallback: "Fallback",
    })).toEqual({
      kind: "error",
      message: "Backend detail",
    });
  });

  it("falls back for unknown error shapes and reports ready without notice or error", () => {
    expect(getInspectorQueryErrorMessage({ detail: "" }, "Fallback")).toBe("Fallback");
    expect(getInspectorPanelRenderState({
      notice: null,
      error: null,
      errorFallback: "Fallback",
    })).toEqual({ kind: "ready" });
  });
});
