import { describe, expect, it } from "vitest";

import {
  getInspectorPanelGridClassName,
  getInspectorPanelIdsToRender,
} from "@/lib/inspector/panelLayout";
import type { InspectorPanelType, InspectorViewState } from "@/types/inspector";

function panelStates(
  states: Partial<Record<InspectorPanelType, InspectorViewState>>,
): Partial<Record<InspectorPanelType, InspectorViewState>> {
  return states;
}

describe("inspector panel layout", () => {
  it("renders non-hidden panels sorted by registry priority", () => {
    expect(getInspectorPanelIdsToRender({
      panelStates: panelStates({
        scatter: "visible",
        rankings: "visible",
        histogram: "hidden",
        heatmap: "minimized",
      }),
      hasMaximized: false,
      maximizedPanel: null,
    })).toEqual(["rankings", "heatmap", "scatter"]);
  });

  it("renders only the maximized panel when one is active", () => {
    expect(getInspectorPanelIdsToRender({
      panelStates: panelStates({
        rankings: "visible",
        heatmap: "visible",
        scatter: "hidden",
      }),
      hasMaximized: true,
      maximizedPanel: "scatter",
    })).toEqual(["scatter"]);
  });

  it("returns the workspace grid class for each layout mode", () => {
    expect(getInspectorPanelGridClassName({ hasMaximized: true, layoutMode: "auto" })).toBe("grid grid-cols-1");
    expect(getInspectorPanelGridClassName({ hasMaximized: false, layoutMode: "single-column" })).toBe("grid grid-cols-1 gap-4");
    expect(getInspectorPanelGridClassName({ hasMaximized: false, layoutMode: "grid-2" })).toBe("grid grid-cols-1 gap-4 xl:grid-cols-2");
    expect(getInspectorPanelGridClassName({ hasMaximized: false, layoutMode: "grid-3" })).toBe("grid grid-cols-1 gap-4 xl:grid-cols-3");
    expect(getInspectorPanelGridClassName({ hasMaximized: false, layoutMode: "auto" })).toBe("grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3");
  });
});
