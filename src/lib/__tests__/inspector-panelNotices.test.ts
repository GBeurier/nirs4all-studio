import { describe, expect, it } from "vitest";

import {
  getInspectorTaskPanelNotice,
  getInspectorTopologyPanelNotice,
} from "@/lib/inspector/panelNotices";

describe("inspector panel notices", () => {
  it("returns a neutral unavailable notice when no chains are focused", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Predicted vs observed",
      requiredTask: "regression",
      focus: { chainIds: [], task: "none" },
    })).toEqual({
      title: "Predicted vs observed unavailable",
      body: "No chains are available in the current scope.",
      tone: "default",
    });
  });

  it("returns regression and classification requirement notices", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Fold stability",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a"], task: "classification" },
    })).toEqual({
      title: "Fold stability requires regression",
      body: "Current focus is classification. Select or pin regression chains to populate this panel.",
      tone: "warning",
    });
    expect(getInspectorTaskPanelNotice({
      panelName: "Confusion matrix",
      requiredTask: "classification",
      focus: { chainIds: ["chain-a"], task: "regression" },
    })).toEqual({
      title: "Confusion matrix requires classification",
      body: "Current focus is regression. Select or pin classification chains to populate this panel.",
      tone: "warning",
    });
  });

  it("returns a mixed focus notice for incompatible mixed tasks", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Bias-variance",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a", "chain-b"], task: "mixed" },
    })).toEqual({
      title: "Bias-variance needs a coherent focus",
      body: "Selected chains mix regression and classification. Narrow the shared selection or rely on auto focus.",
      tone: "warning",
    });
  });

  it("returns no notice when the focus task matches the panel requirement", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Residuals",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a"], task: "regression" },
    })).toBeNull();
    expect(getInspectorTaskPanelNotice({
      panelName: "Confusion matrix",
      requiredTask: "classification",
      focus: { chainIds: ["chain-a"], task: "classification" },
    })).toBeNull();
  });

  it("returns topology notice only when no unique pipeline is available", () => {
    expect(getInspectorTopologyPanelNotice(null)).toEqual({
      title: "Topology needs one pipeline",
      body: "Select or pin chains from a single pipeline to inspect topology.",
      tone: "warning",
    });
    expect(getInspectorTopologyPanelNotice("pipe-1")).toBeNull();
  });
});
