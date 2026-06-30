import { describe, expect, it } from "vitest";

import type { InspectorFocusState } from "@/lib/inspector/focus";

import {
  INSPECTOR_PANEL_RENDERER_CONFIGS,
  getInspectorPanelClassName,
  getInspectorPanelDiagnosticRenderState,
  getInspectorPanelItemCount,
} from "./inspectorPanelRegistry";

function focus(overrides: Partial<InspectorFocusState> = {}): Pick<InspectorFocusState, "chainIds" | "task" | "topologyPipelineId"> {
  return {
    chainIds: ["chain-1"],
    task: "regression",
    topologyPipelineId: "pipeline-1",
    ...overrides,
  };
}

describe("inspectorPanelRegistry", () => {
  it("keeps local and diagnostic count scopes explicit", () => {
    expect(getInspectorPanelItemCount(INSPECTOR_PANEL_RENDERER_CONFIGS.rankings, {
      filteredChainCount: 12,
      focusedChainCount: 3,
    })).toBe(12);
    expect(getInspectorPanelItemCount(INSPECTOR_PANEL_RENDERER_CONFIGS.scatter, {
      filteredChainCount: 12,
      focusedChainCount: 3,
    })).toBe(3);
  });

  it("applies compact panel classes only outside maximized mode", () => {
    const config = INSPECTOR_PANEL_RENDERER_CONFIGS.rankings;

    expect(getInspectorPanelClassName(config, false)).toBe("max-h-[560px] overflow-hidden");
    expect(getInspectorPanelClassName(config, true)).toBeUndefined();
  });

  it("builds task diagnostic notices before query errors", () => {
    const state = getInspectorPanelDiagnosticRenderState({
      config: INSPECTOR_PANEL_RENDERER_CONFIGS.scatter,
      focus: focus({ task: "classification" }),
      error: new Error("network failed"),
    });

    expect(state.kind).toBe("notice");
    expect(state.kind === "notice" ? state.notice.title : "").toContain("requires regression");
  });

  it("falls back to query errors when a diagnostic panel is otherwise ready", () => {
    const state = getInspectorPanelDiagnosticRenderState({
      config: INSPECTOR_PANEL_RENDERER_CONFIGS.confusion,
      focus: focus({ task: "classification" }),
      error: new Error("bad matrix"),
    });

    expect(state).toEqual({ kind: "error", message: "bad matrix" });
  });

  it("requires a single pipeline for topology panels", () => {
    const state = getInspectorPanelDiagnosticRenderState({
      config: INSPECTOR_PANEL_RENDERER_CONFIGS.branch_topology,
      focus: focus({ topologyPipelineId: null }),
      error: null,
    });

    expect(state.kind).toBe("notice");
    expect(state.kind === "notice" ? state.notice.title : "").toBe("Topology needs one pipeline");
  });
});
