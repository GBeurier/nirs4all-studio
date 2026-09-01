/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebSocketBaseUrl } from "./websocket";

function setElectronApi(getScientificPluginUrl: () => Promise<string>) {
  (window as unknown as {
    electronApi?: {
      isElectron: boolean;
      getScientificPluginUrl: () => Promise<string>;
    };
  }).electronApi = { isElectron: true, getScientificPluginUrl };
}

afterEach(() => {
  delete (window as unknown as { electronApi?: unknown }).electronApi;
});

describe("getWebSocketBaseUrl", () => {
  it("lazily acquires the scientific plugin URL for Electron WebSockets", async () => {
    const acquire = vi.fn().mockResolvedValue("http://127.0.0.1:43123");
    setElectronApi(acquire);

    await expect(getWebSocketBaseUrl()).resolves.toBe("ws://127.0.0.1:43123");
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("fails closed instead of falling back to the renderer origin", async () => {
    setElectronApi(
      vi.fn().mockRejectedValue(new Error("Scientific plugin unavailable")),
    );

    await expect(getWebSocketBaseUrl()).rejects.toThrow(
      "Scientific plugin unavailable",
    );
  });
});
