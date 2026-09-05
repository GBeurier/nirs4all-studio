import { describe, expect, it } from "vitest";

import { BackendManager } from "./backend-manager";

describe("BackendManager outside the Electron runtime", () => {
  it("can notify status and readiness without an available BrowserWindow", () => {
    // No Electron mock: Node resolves the binary path (or the optional module
    // is absent in CI), neither of which provides BrowserWindow.
    const manager = new BackendManager();
    expect(() => manager["notifyRenderer"]()).not.toThrow();
    expect(() => manager["notifyMlReady"](true, undefined, true)).not.toThrow();
    expect(() => manager["notifyMlReady"](false, "Startup failed")).not.toThrow();
  });
});
