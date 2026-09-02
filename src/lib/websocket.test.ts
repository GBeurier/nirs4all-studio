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
    surface: target === "scientific-plugin"
      ? "python-http-diagnostic"
      : "job-websocket",
    target,
    base_url: target === "native-sidecar" ? "http://127.0.0.1:43123" : null,
    renderer_transport: target === "native-sidecar",
    scientific_execution: false,
    reason: target === "scientific-plugin"
      ? "explicit_python_http_diagnostic_mode"
      : reason,
    fallback_after_native_selection: "none",
    status: target === "reject" ? 503 : 200,
  } as const;
}

function setElectronApi(
  preselectRendererTransport = vi.fn(async ({ path }: { path: string }) =>
    selection(path, "reject", "route_not_native_qualified_rust_only")),
) {
  (window as unknown as {
    electronApi?: {
      isElectron: boolean;
      preselectRendererTransport: typeof preselectRendererTransport;
    };
  }).electronApi = {
    isElectron: true,
    preselectRendererTransport,
  };
}

afterEach(() => {
  delete (window as unknown as { electronApi?: unknown }).electronApi;
});

describe("getWebSocketBaseUrl", () => {
  it("rejects the unmigrated main socket without acquiring Python in Rust-only mode", async () => {
    const acquire = vi.fn();
    setElectronApi(
      vi.fn().mockResolvedValue(
        selection("/ws", "reject", "route_not_native_qualified_rust_only"),
      ),
    );

    await expect(getWebSocketBaseUrl()).rejects.toThrow(
      "route_not_native_qualified_rust_only",
    );
    expect(acquire).not.toHaveBeenCalled();
  });

  it("rejects the removed Python HTTP target without acquisition", async () => {
    const acquire = vi.fn().mockResolvedValue("http://127.0.0.1:43123");
    setElectronApi(vi.fn().mockResolvedValue(selection("/ws", "scientific-plugin")));

    await expect(getWebSocketBaseUrl()).rejects.toThrow(
      "Unexpected renderer WebSocket transport target",
    );
    expect(acquire).not.toHaveBeenCalled();
  });

  it("refuses an implicit Python WebSocket target without acquisition", async () => {
    const acquire = vi.fn();
    setElectronApi(
      vi.fn().mockResolvedValue({
        ...selection("/ws", "scientific-plugin"),
        surface: "unmigrated",
        reason: "route_not_native_qualified",
      }),
    );

    await expect(getWebSocketBaseUrl()).rejects.toThrow(
      "Unexpected renderer WebSocket transport target",
    );
    expect(acquire).not.toHaveBeenCalled();
  });

  it("selects a qualified job socket natively without acquiring Python", async () => {
    const acquire = vi.fn();
    const preselect = vi.fn().mockResolvedValue(
      selection("/ws/job/job-1", "native-sidecar"),
    );
    setElectronApi(preselect);

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
    setElectronApi(vi.fn().mockRejectedValue(new Error("Native sidecar unavailable")));

    await expect(getWebSocketBaseUrl()).rejects.toThrow(
      "Native sidecar unavailable",
    );
  });
});
