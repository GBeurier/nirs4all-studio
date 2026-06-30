import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientStorageKeys,
  createClientStoragePersistenceStorage,
  defineClientStorageKey,
  listClientStorageKeys,
  listClientStorageItemKeys,
  readClientStorageJson,
  readClientStorageString,
  readVersionedClientStorageJson,
  removeClientStorageItem,
  writeClientStorageJson,
  writeClientStorageString,
  writeVersionedClientStorageJson,
} from "../index";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    clear: vi.fn(() => {
      values.clear();
    }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    values,
    get length() {
      return values.size;
    },
  };
}

describe("clientStorage", () => {
  let localStorage: ReturnType<typeof createMemoryStorage>;
  let sessionStorage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    localStorage = createMemoryStorage();
    sessionStorage = createMemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps registered key strings unique", () => {
    const keys = listClientStorageKeys().map((entry) => `${entry.area}:${entry.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("reads and writes raw string values without changing the persisted format", () => {
    writeClientStorageString(clientStorageKeys.telemetryConsent, "accepted");

    expect(localStorage.values.get("nirs4all-telemetry-consent")).toBe("accepted");
    expect(readClientStorageString(clientStorageKeys.telemetryConsent)).toBe("accepted");
  });

  it("reads and writes raw JSON values without a version envelope", () => {
    const payload = { unavailable: ["missing.operator"] };

    writeClientStorageJson(clientStorageKeys.pipelineOperatorAvailability, payload);

    expect(localStorage.values.get("pipelineEditor.operatorAvailability.v2")).toBe(JSON.stringify(payload));
    expect(readClientStorageJson(clientStorageKeys.pipelineOperatorAvailability)).toEqual(payload);
  });

  it("supports versioned JSON records and migrations for future keys", () => {
    const key = defineClientStorageKey<{ enabled: boolean }>("feature.preference", {
      area: "local",
      scope: "user",
      version: 2,
      description: "Test feature preference.",
    });

    localStorage.values.set("feature.preference", JSON.stringify({
      value: "yes",
      version: 1,
    }));

    expect(readVersionedClientStorageJson(key, {
      migrations: {
        1: (value) => ({ enabled: value === "yes" }),
      },
    })).toEqual({ enabled: true });

    writeVersionedClientStorageJson(key, { enabled: false });
    expect(JSON.parse(localStorage.values.get("feature.preference") ?? "")).toEqual({
      value: { enabled: false },
      version: 2,
    });
  });

  it("removes items through the key registry", () => {
    writeClientStorageString(clientStorageKeys.telemetryConsent, "declined");

    removeClientStorageItem(clientStorageKeys.telemetryConsent);

    expect(readClientStorageString(clientStorageKeys.telemetryConsent)).toBeNull();
  });

  it("adapts a registered key to the Storage-like session persistence contract", () => {
    const storage = createClientStoragePersistenceStorage(clientStorageKeys.inspectorSessionState);

    storage.setItem("other-key", "ignored");
    expect(sessionStorage.values.has("other-key")).toBe(false);

    storage.setItem(clientStorageKeys.inspectorSessionState.key, '{"savedAt":1}');
    expect(sessionStorage.values.get("inspector-session-state")).toBe('{"savedAt":1}');
    expect(storage.getItem(clientStorageKeys.inspectorSessionState.key)).toBe('{"savedAt":1}');
    expect(storage.getItem("other-key")).toBeNull();

    storage.removeItem(clientStorageKeys.inspectorSessionState.key);
    expect(storage.getItem(clientStorageKeys.inspectorSessionState.key)).toBeNull();
  });

  it("lists storage item keys for prefix-based cache cleanup", () => {
    writeClientStorageString(clientStorageKeys.telemetryConsent, "declined");
    localStorage.values.set("n4a:cache:workspaces:abc:scores", "{}");

    expect(listClientStorageItemKeys("local")).toEqual([
      "nirs4all-telemetry-consent",
      "n4a:cache:workspaces:abc:scores",
    ]);
  });

  it("returns fallbacks when storage access throws", () => {
    const onError = vi.fn();
    localStorage.getItem.mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(readClientStorageString(clientStorageKeys.telemetryConsent, {
      fallback: "unset",
      onError,
    })).toBe("unset");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
