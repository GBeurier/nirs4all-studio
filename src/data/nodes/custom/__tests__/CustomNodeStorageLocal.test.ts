import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NodeDefinition } from "../../types";
import {
  readSecurityConfig,
  readStoredCustomNodes,
  readStoredVersion,
  readUserPackages,
  STORAGE_KEYS,
  writeSecurityConfig,
  writeStoredCustomNodes,
  writeUserPackages,
  type StoredCustomNodeSecurityConfig,
} from "../CustomNodeStorageLocal";

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
};

const node: NodeDefinition = {
  id: "custom.local_storage",
  name: "LocalStorageNode",
  type: "preprocessing",
  description: "Stored node",
  category: "Custom",
  source: "custom",
  classPath: "nirs4all.operators.LocalStorageNode",
  parameters: [],
};

const securityConfig: StoredCustomNodeSecurityConfig = {
  allowCustomNodes: true,
  allowedPackages: ["nirs4all"],
  requireApproval: false,
  allowUserPackages: true,
};

describe("CustomNodeStorageLocal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      localStorage: storage,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists custom node files and schema versions", () => {
    writeStoredCustomNodes([node], "1.2.3");

    expect(readStoredCustomNodes()).toEqual({
      version: "1.2.3",
      nodes: [node],
    });
    expect(readStoredVersion()).toBe("1.2.3");
  });

  it("returns null for missing or invalid custom node files", () => {
    expect(readStoredCustomNodes()).toBeNull();

    localStorage.setItem(STORAGE_KEYS.CUSTOM_NODES, "{bad-json");

    expect(readStoredCustomNodes()).toBeNull();
  });

  it("persists security config and falls back on invalid JSON", () => {
    const fallback: StoredCustomNodeSecurityConfig = {
      ...securityConfig,
      allowCustomNodes: false,
    };

    writeSecurityConfig(securityConfig);

    expect(readSecurityConfig(fallback)).toEqual(securityConfig);

    localStorage.setItem(STORAGE_KEYS.SECURITY_CONFIG, "{bad-json");

    expect(readSecurityConfig(fallback)).toEqual(fallback);
  });

  it("persists user package allowlists and falls back to an empty list", () => {
    expect(readUserPackages()).toEqual([]);

    writeUserPackages(["numpy", "scipy"]);

    expect(readUserPackages()).toEqual(["numpy", "scipy"]);

    localStorage.setItem(STORAGE_KEYS.USER_PACKAGES, "{bad-json");

    expect(readUserPackages()).toEqual([]);
  });
});
