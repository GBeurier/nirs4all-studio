import { describe, expect, it } from "vitest";

import {
  createInitialInspectorSelectionState,
  createInspectorSavedSelection,
  getInspectorSelectionDerivedState,
  inspectorSelectionReducer,
  restoreInspectorSelectionState,
} from "@/lib/inspector/selectionState";

function sortedIds(ids: ReadonlySet<string>): string[] {
  return Array.from(ids).sort();
}

describe("inspector selection state", () => {
  it("creates and restores selection state", () => {
    const initial = createInitialInspectorSelectionState();
    expect(initial.selectedChains.size).toBe(0);
    expect(initial.pinnedChains.size).toBe(0);
    expect(initial.selectionMode).toBe("replace");
    expect(initial.selectionToolMode).toBe("click");
    expect(getInspectorSelectionDerivedState(initial)).toEqual({
      selectedCount: 0,
      hasSelection: false,
      canUndo: false,
      canRedo: false,
      pinnedCount: 0,
    });

    const restored = restoreInspectorSelectionState({
      selected: ["a", "b"],
      pinned: ["pinned"],
      savedSelections: [
        createInspectorSavedSelection({
          chainIds: ["saved"],
          createdAt: "2026-06-28T00:00:00.000Z",
          id: "saved-1",
          name: "Saved",
        }),
      ],
    });

    expect(sortedIds(restored.selectedChains)).toEqual(["a", "b"]);
    expect(sortedIds(restored.pinnedChains)).toEqual(["pinned"]);
    expect(restored.savedSelections).toHaveLength(1);
  });

  it("applies selection modes and undo/redo history", () => {
    let state = createInitialInspectorSelectionState();

    state = inspectorSelectionReducer(state, { type: "SELECT", chainIds: ["a", "b"] });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "b"]);
    expect(getInspectorSelectionDerivedState(state).canUndo).toBe(true);

    state = inspectorSelectionReducer(state, { type: "SELECT", chainIds: ["c"], mode: "add" });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "b", "c"]);

    state = inspectorSelectionReducer(state, { type: "SELECT", chainIds: ["b", "d"], mode: "toggle" });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "c", "d"]);

    state = inspectorSelectionReducer(state, { type: "UNDO" });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "b", "c"]);

    state = inspectorSelectionReducer(state, { type: "REDO" });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "c", "d"]);
  });

  it("selects all, inverts, clears, and tracks derived counts", () => {
    let state = createInitialInspectorSelectionState();
    state = inspectorSelectionReducer(state, { type: "SELECT_ALL", chainIds: ["a", "b", "c"] });
    expect(getInspectorSelectionDerivedState(state).selectedCount).toBe(3);

    state = inspectorSelectionReducer(state, { type: "INVERT", allChainIds: ["a", "b", "c", "d"] });
    expect(sortedIds(state.selectedChains)).toEqual(["d"]);

    state = inspectorSelectionReducer(state, { type: "CLEAR" });
    expect(getInspectorSelectionDerivedState(state).hasSelection).toBe(false);

    const unchanged = inspectorSelectionReducer(state, { type: "CLEAR" });
    expect(unchanged).toBe(state);
  });

  it("manages pins without changing selection history", () => {
    let state = createInitialInspectorSelectionState();
    state = inspectorSelectionReducer(state, { type: "PIN", chainIds: ["a", "b"] });
    expect(sortedIds(state.pinnedChains)).toEqual(["a", "b"]);
    expect(getInspectorSelectionDerivedState(state).canUndo).toBe(false);

    state = inspectorSelectionReducer(state, { type: "TOGGLE_PIN", chainId: "b" });
    expect(sortedIds(state.pinnedChains)).toEqual(["a"]);

    state = inspectorSelectionReducer(state, { type: "UNPIN", chainIds: ["a"] });
    expect(state.pinnedChains.size).toBe(0);
  });

  it("saves, loads, and deletes named selections", () => {
    let state = createInitialInspectorSelectionState();
    state = inspectorSelectionReducer(state, { type: "SELECT", chainIds: ["a", "b"] });
    const saved = createInspectorSavedSelection({
      chainIds: state.selectedChains,
      color: "#ff0000",
      createdAt: "2026-06-28T00:00:00.000Z",
      id: "sel-1",
      name: "Selection",
    });

    state = inspectorSelectionReducer(state, { type: "SAVE_SELECTION", selection: saved });
    expect(state.savedSelections).toEqual([saved]);

    state = inspectorSelectionReducer(state, { type: "CLEAR" });
    state = inspectorSelectionReducer(state, { type: "LOAD_SELECTION", id: "sel-1" });
    expect(sortedIds(state.selectedChains)).toEqual(["a", "b"]);

    state = inspectorSelectionReducer(state, { type: "DELETE_SAVED_SELECTION", id: "sel-1" });
    expect(state.savedSelections).toHaveLength(0);
  });
});
