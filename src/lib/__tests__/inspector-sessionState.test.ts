import { describe, expect, it } from "vitest";

import {
  clearInspectorSessionState,
  createDefaultInspectorSessionState,
  INSPECTOR_SESSION_MAX_AGE_MS,
  INSPECTOR_SESSION_STORAGE_KEY,
  mergeInspectorSessionState,
  migrateInspectorSessionState,
  readInspectorSessionState,
  writeInspectorSessionState,
  type InspectorSessionState,
} from "@/lib/inspector/sessionState";

class MemoryStorage {
  readonly items = new Map<string, string>();

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }
}

function session(overrides: Partial<InspectorSessionState> = {}): InspectorSessionState {
  return {
    ...createDefaultInspectorSessionState(1000),
    ...overrides,
  };
}

describe("inspector session state", () => {
  it("creates the default session state", () => {
    expect(createDefaultInspectorSessionState(42)).toEqual({
      filters: {},
      groupMode: "by_variable",
      groupBy: "model_class",
      rangeConfig: null,
      topKConfig: null,
      expressionConfig: null,
      scoreColumn: "cv_val_score",
      selectedScoreRefKey: null,
      partition: "val",
      targetIndex: 0,
      panelStates: {},
      layoutMode: "auto",
      savedAt: 42,
    });
  });

  it("merges partial updates over current or default state", () => {
    const merged = mergeInspectorSessionState(
      session({ partition: "test", scoreColumn: "cv_test_score", targetIndex: 1 }),
      { groupBy: "dataset_name", partition: "train", targetIndex: 2 },
      2000,
    );

    expect(merged).toMatchObject({
      groupBy: "dataset_name",
      partition: "train",
      scoreColumn: "cv_test_score",
      selectedScoreRefKey: null,
      targetIndex: 2,
      savedAt: 2000,
    });

    expect(mergeInspectorSessionState(null, { partition: "test" }, 3000)).toMatchObject({
      groupBy: "model_class",
      partition: "test",
      savedAt: 3000,
    });
  });

  it("migrates legacy scalar filter fields without mutating the source session", () => {
    const legacy = session({
      filters: {
        run_id: "run-1",
        dataset_name: "Corn",
        model_class: "PLSRegression",
      } as unknown as InspectorSessionState["filters"],
    });

    const migrated = migrateInspectorSessionState(legacy);

    expect(migrated.filters).toEqual({
      run_ids: ["run-1"],
      dataset_names: ["Corn"],
      model_classes: ["PLSRegression"],
    });
    expect(legacy.filters).toHaveProperty("run_id", "run-1");
  });

  it("normalizes missing or blank selected score-ref keys during migration", () => {
    const legacy = session({ selectedScoreRefKey: "   " });
    expect(migrateInspectorSessionState(legacy).selectedScoreRefKey).toBeNull();

    const current = session({ selectedScoreRefKey: "metric=rmse|protocol=final|partition=test|aggregation=final_model" });
    expect(migrateInspectorSessionState(current).selectedScoreRefKey).toBe(current.selectedScoreRefKey);
  });

  it("reads, migrates, and expires persisted sessions", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      INSPECTOR_SESSION_STORAGE_KEY,
      JSON.stringify(session({
        savedAt: 1000,
        filters: { run_id: "run-1" } as unknown as InspectorSessionState["filters"],
      })),
    );

    expect(readInspectorSessionState(storage, { now: 1000 + INSPECTOR_SESSION_MAX_AGE_MS })).toMatchObject({
      filters: { run_ids: ["run-1"] },
      savedAt: 1000,
    });

    expect(readInspectorSessionState(storage, { now: 1001 + INSPECTOR_SESSION_MAX_AGE_MS })).toBeNull();
    expect(storage.getItem(INSPECTOR_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("returns null for missing or invalid persisted data", () => {
    const storage = new MemoryStorage();
    expect(readInspectorSessionState(storage, { now: 1000 })).toBeNull();

    storage.setItem(INSPECTOR_SESSION_STORAGE_KEY, "{bad-json");
    expect(readInspectorSessionState(storage, { now: 1000 })).toBeNull();
  });

  it("writes and clears persisted sessions", () => {
    const storage = new MemoryStorage();
    const state = session({ partition: "test", savedAt: 5000 });

    writeInspectorSessionState(storage, state);
    expect(JSON.parse(storage.getItem(INSPECTOR_SESSION_STORAGE_KEY) ?? "{}")).toMatchObject({
      partition: "test",
      savedAt: 5000,
    });

    clearInspectorSessionState(storage);
    expect(storage.getItem(INSPECTOR_SESSION_STORAGE_KEY)).toBeNull();
  });
});
