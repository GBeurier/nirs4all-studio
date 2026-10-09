import { describe, expect, it } from "vitest";

import {
  getInspectorTaskPanelNotice,
  getInspectorTopologyPanelNotice,
} from "@/lib/inspector/panelNotices";
import { tStub } from "./helpers/i18nStub";

describe("inspector panel notices", () => {
  it("returns a neutral unavailable notice when no chains are focused", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Predicted vs observed",
      requiredTask: "regression",
      focus: { chainIds: [], task: "none" },
      t: tStub,
    })).toEqual({
      title: 'inspector.notices.unavailable {"panel":"Predicted vs observed"}',
      body: "inspector.notices.emptyFocus",
      tone: "default",
    });
  });

  it("returns regression and classification requirement notices", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Fold stability",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a"], task: "classification" },
      t: tStub,
    })).toEqual({
      title: 'inspector.notices.requires {"panel":"Fold stability","task":"inspector.notices.tasks.regression"}',
      body: 'inspector.notices.requiresBody {"current":"inspector.notices.tasks.classification","required":"inspector.notices.tasks.regression"}',
      tone: "warning",
    });
    expect(getInspectorTaskPanelNotice({
      panelName: "Confusion matrix",
      requiredTask: "classification",
      focus: { chainIds: ["chain-a"], task: "regression" },
      t: tStub,
    })).toEqual({
      title: 'inspector.notices.requires {"panel":"Confusion matrix","task":"inspector.notices.tasks.classification"}',
      body: 'inspector.notices.requiresBody {"current":"inspector.notices.tasks.regression","required":"inspector.notices.tasks.classification"}',
      tone: "warning",
    });
  });

  it("returns a mixed focus notice for incompatible mixed tasks", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Bias-variance",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a", "chain-b"], task: "mixed" },
      t: tStub,
    })).toEqual({
      title: 'inspector.notices.needsCoherentFocus {"panel":"Bias-variance"}',
      body: "inspector.notices.mixedFocusBody",
      tone: "warning",
    });
  });

  it("returns no notice when the focus task matches the panel requirement", () => {
    expect(getInspectorTaskPanelNotice({
      panelName: "Residuals",
      requiredTask: "regression",
      focus: { chainIds: ["chain-a"], task: "regression" },
      t: tStub,
    })).toBeNull();
    expect(getInspectorTaskPanelNotice({
      panelName: "Confusion matrix",
      requiredTask: "classification",
      focus: { chainIds: ["chain-a"], task: "classification" },
      t: tStub,
    })).toBeNull();
  });

  it("returns topology notice only when no unique pipeline is available", () => {
    expect(getInspectorTopologyPanelNotice(null, tStub)).toEqual({
      title: "inspector.notices.topologyTitle",
      body: "inspector.notices.topologyBody",
      tone: "warning",
    });
    expect(getInspectorTopologyPanelNotice("pipe-1", tStub)).toBeNull();
  });
});
