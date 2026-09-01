import { describe, expect, it, vi } from "vitest";
import { startNativeSession } from "./native-session-lifecycle";

describe("startNativeSession", () => {
  it("starts the Rust control plane and window without an Uvicorn dependency", async () => {
    const events: string[] = [];
    const startUvicorn = vi.fn();

    await startNativeSession({
      startControlPlane: () => { events.push("control"); },
      createWindow: async () => { events.push("window"); },
    });

    expect(events).toEqual(["control", "window"]);
    expect(startUvicorn).not.toHaveBeenCalled();
  });
});
