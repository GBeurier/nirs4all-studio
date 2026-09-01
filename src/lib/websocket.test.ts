/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getWebSocketBaseUrl } from "./websocket";

function selection(
  path: string,
  target: "native-sidecar" | "scientific-plugin" | "reject",
  reason = "test_selection",
) {
  return {
    schema_id: "nirs4all.studio-renderer-transport-selection-decision.v1",
    kind: "websocket",
    method: null,
    path,
    surface: target === "scientific-plugin" ? "unmigrated" : "job-websocket",
    target,
    base_url: target === "native-sidecar" ? "http://127.0.0.1:43123" : null,
    renderer_transport: target === "native-sidecar",
    scientific_execution: false,
    reason,
    fallback_after_native_selection: "none",
    status: target === "reject" ? 503 : 200,
  } as const;
}

function setElectronApi(
  getScientificPluginUrl: () => Promise<string>,
  preselectRendererTransport = vi.fn(async ({ path }: { path: string }) =>
    selection(path, "scientific-plugin")),
) {
  (window as unknown as {
    electronApi?: {
      isElectron: boolean;
      getScientificPluginUrl: () => Promise<string>;
      preselectRendererTransport: typeof preselectRendererTransport;
    };
  }).electronApi = {
    isElectron: true,
    getScientificPluginUrl,
    preselectRendererTransport,
  };
}

afterEach(() => {
  delete (window as unknown as { electronApi?: unknown }).electronApi;
});

describe("getWebSocketBaseUrl", () => {
  it("keeps the dynamically subscribed main socket on the scientific plugin", async () => {
    const acquire = vi.fn().mockResolvedValue("http://127.0.0.1:43123");
    setElectronApi(acquire);

    await expect(getWebSocketBaseUrl()).resolves.toBe("ws://127.0.0.1:43123");
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("selects a qualified job socket natively without acquiring Python", async () => {
    const acquire = vi.fn();
    const preselect = vi.fn().mockResolvedValue(
      selection("/ws/job/job-1", "native-sidecar"),
    );
    setElectronApi(acquire, preselect);

    await expect(getWebSocketBaseUrl("/ws/job/job-1")).resolves.toBe(
      "ws://127.0.0.1:43123",
    );
    expect(preselect).toHaveBeenCalledWith({
      kind: "websocket",
      path: "/ws/job/job-1",
    });
    expect(acquire).not.toHaveBeenCalled();
  });

  it("fails closed after a native WebSocket candidate is rejected", async () => {
    const acquire = vi.fn();
    setElectronApi(
      acquire,
      vi.fn().mockResolvedValue(
        selection("/ws/training/job-1", "reject", "capability_mismatch"),
      ),
    );

    await expect(
      getWebSocketBaseUrl("/ws/training/job-1"),
    ).rejects.toThrow("capability_mismatch");
    expect(acquire).not.toHaveBeenCalled();
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
