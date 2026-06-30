import { describe, expect, it } from "vitest";

import {
  getInspectorPanelFieldLabel,
  INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS,
} from "@/lib/inspector/panelHeaderControls";

describe("inspector panel header controls", () => {
  it("maps known chain fields to user-facing labels", () => {
    expect(getInspectorPanelFieldLabel("model_class")).toBe("Model family");
    expect(getInspectorPanelFieldLabel("dataset_name")).toBe("Dataset");
    expect(getInspectorPanelFieldLabel("pipeline_id")).toBe("Pipeline");
  });

  it("keeps unknown future metadata fields visible", () => {
    expect(getInspectorPanelFieldLabel("backend_id")).toBe("backend_id");
  });

  it("exposes stable bias/variance grouping options", () => {
    expect(INSPECTOR_BIAS_VARIANCE_GROUP_OPTIONS.map(option => option.value)).toEqual([
      "model_class",
      "preprocessings",
      "dataset_name",
    ]);
  });
});
