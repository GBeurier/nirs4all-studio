import { describe, expect, it } from "vitest";

import {
  createInitialInspectorViewState,
  getInspectorVisiblePanelCount,
  getInspectorVisiblePanels,
  inspectorViewReducer,
  isInspectorPanelMinimized,
  isInspectorPanelVisible,
  restoreInspectorViewState,
} from "@/lib/inspector/viewState";

describe("inspector view state", () => {
  it("creates the default panel layout", () => {
    const state = createInitialInspectorViewState();

    expect(Array.from(getInspectorVisiblePanels(state.panelStates))).toEqual([
      "scatter",
      "rankings",
      "heatmap",
      "histogram",
      "candlestick",
      "preprocessing_impact",
    ]);
    expect(getInspectorVisiblePanelCount(state.panelStates)).toBe(6);
    expect(state.maximizedPanel).toBeNull();
    expect(state.focusedPanel).toBeNull();
    expect(state.layoutMode).toBe("auto");
  });

  it("keeps maximize operations exclusive and reversible", () => {
    const initial = createInitialInspectorViewState();
    const scatterMaximized = inspectorViewReducer(initial, {
      type: "MAXIMIZE_PANEL",
      panel: "scatter",
    });

    expect(scatterMaximized.maximizedPanel).toBe("scatter");
    expect(scatterMaximized.panelStates.scatter).toBe("maximized");

    const heatmapMaximized = inspectorViewReducer(scatterMaximized, {
      type: "MAXIMIZE_PANEL",
      panel: "heatmap",
    });

    expect(heatmapMaximized.maximizedPanel).toBe("heatmap");
    expect(heatmapMaximized.panelStates.scatter).toBe("visible");
    expect(heatmapMaximized.panelStates.heatmap).toBe("maximized");

    const restored = inspectorViewReducer(heatmapMaximized, {
      type: "MAXIMIZE_PANEL",
      panel: null,
    });

    expect(restored.maximizedPanel).toBeNull();
    expect(restored.panelStates.heatmap).toBe("visible");
  });

  it("separates visible and minimized panel selectors", () => {
    const minimized = inspectorViewReducer(createInitialInspectorViewState(), {
      type: "MINIMIZE_PANEL",
      panel: "scatter",
    });

    expect(isInspectorPanelVisible(minimized.panelStates, "scatter")).toBe(false);
    expect(isInspectorPanelMinimized(minimized.panelStates, "scatter")).toBe(true);
    expect(getInspectorVisiblePanels(minimized.panelStates).has("scatter")).toBe(true);
    expect(getInspectorVisiblePanelCount(minimized.panelStates)).toBe(5);
  });

  it("restores valid saved panel state while ignoring unknown or invalid entries", () => {
    const restored = restoreInspectorViewState({
      panelStates: {
        scatter: "hidden",
        heatmap: "maximized",
        unknown_panel: "visible",
        rankings: "invalid-state",
      },
      layoutMode: "grid-3",
    });

    expect(restored.panelStates.scatter).toBe("hidden");
    expect(restored.panelStates.heatmap).toBe("maximized");
    expect(restored.panelStates.rankings).toBe("visible");
    expect(restored.maximizedPanel).toBe("heatmap");
    expect(restored.layoutMode).toBe("grid-3");
  });

  it("resets and shows all panels through the reducer", () => {
    const hidden = inspectorViewReducer(createInitialInspectorViewState(), {
      type: "TOGGLE_PANEL",
      panel: "scatter",
    });
    expect(hidden.panelStates.scatter).toBe("hidden");

    const allVisible = inspectorViewReducer(hidden, { type: "SHOW_ALL" });
    expect(getInspectorVisiblePanelCount(allVisible.panelStates)).toBe(13);

    const reset = inspectorViewReducer(allVisible, { type: "RESET" });
    expect(getInspectorVisiblePanelCount(reset.panelStates)).toBe(6);
    expect(reset.panelStates.residuals).toBe("hidden");
  });
});
