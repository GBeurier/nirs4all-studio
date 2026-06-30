import { describe, expect, it, vi } from "vitest";

import {
  clearPlaygroundSessionState,
  createDefaultPlaygroundSessionState,
  DEFAULT_CHART_VISIBILITY,
  mergePlaygroundSessionState,
  PLAYGROUND_SESSION_MAX_AGE_MS,
  PLAYGROUND_SESSION_STORAGE_KEY,
  readPlaygroundSessionState,
  writePlaygroundSessionState,
  type PlaygroundSessionState,
} from "@/lib/playground/sessionState";

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

function session(overrides: Partial<PlaygroundSessionState> = {}): PlaygroundSessionState {
  return {
    ...createDefaultPlaygroundSessionState(1000),
    ...overrides,
  };
}

describe("playground session state", () => {
  it("creates the default playground session state", () => {
    expect(createDefaultPlaygroundSessionState(42)).toEqual({
      datasetId: null,
      datasetName: null,
      dataSource: null,
      chartVisibility: DEFAULT_CHART_VISIBILITY,
      renderMode: "auto",
      savedAt: 42,
    });
  });

  it("merges partial updates over current or default state", () => {
    const merged = mergePlaygroundSessionState(
      session({ datasetId: "old", datasetName: "Old", dataSource: "workspace" }),
      { datasetId: "demo-corn", datasetName: "Corn", dataSource: "demo" },
      2000,
    );

    expect(merged).toMatchObject({
      datasetId: "demo-corn",
      datasetName: "Corn",
      dataSource: "demo",
      renderMode: "auto",
      savedAt: 2000,
    });

    expect(mergePlaygroundSessionState(null, { renderMode: "canvas" }, 3000)).toMatchObject({
      datasetId: null,
      renderMode: "canvas",
      savedAt: 3000,
    });
  });

  it("reads and expires persisted sessions", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      PLAYGROUND_SESSION_STORAGE_KEY,
      JSON.stringify(session({ datasetId: "corn", savedAt: 1000 })),
    );

    expect(readPlaygroundSessionState(storage, { now: 1000 + PLAYGROUND_SESSION_MAX_AGE_MS })).toMatchObject({
      datasetId: "corn",
      savedAt: 1000,
    });

    expect(readPlaygroundSessionState(storage, { now: 1001 + PLAYGROUND_SESSION_MAX_AGE_MS })).toBeNull();
    expect(storage.getItem(PLAYGROUND_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("returns null for missing or invalid persisted data and reports parse errors", () => {
    const storage = new MemoryStorage();
    expect(readPlaygroundSessionState(storage, { now: 1000 })).toBeNull();

    const onError = vi.fn();
    storage.setItem(PLAYGROUND_SESSION_STORAGE_KEY, "{bad-json");
    expect(readPlaygroundSessionState(storage, { now: 1000, onError })).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("writes and clears persisted sessions", () => {
    const storage = new MemoryStorage();
    const state = session({ datasetName: "Corn", savedAt: 5000 });

    writePlaygroundSessionState(storage, state);
    expect(JSON.parse(storage.getItem(PLAYGROUND_SESSION_STORAGE_KEY) ?? "{}")).toMatchObject({
      datasetName: "Corn",
      savedAt: 5000,
    });

    clearPlaygroundSessionState(storage);
    expect(storage.getItem(PLAYGROUND_SESSION_STORAGE_KEY)).toBeNull();
  });
});
