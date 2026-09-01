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

  it("does not create the product window when the Rust backend fails closed", async () => {
    const createWindow = vi.fn(async () => undefined);
    await expect(
      startNativeSession({
        startControlPlane: async () => {
          throw new Error("packaged sidecar integrity mismatch");
        },
        createWindow,
      }),
    ).rejects.toThrow("packaged sidecar integrity mismatch");
    expect(createWindow).not.toHaveBeenCalled();
  });
});
