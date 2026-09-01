import { describe, expect, it, vi } from "vitest";
import type { BackendInfo } from "./backend-manager";
import {
  ScientificPluginLifecycle,
  type ScientificPluginBackend,
} from "./scientific-plugin-lifecycle";

function makeBackend() {
  let info: BackendInfo = {
    status: "stopped",
    port: 0,
    url: "http://127.0.0.1:0",
    restartCount: 0,
  };
  const backend: ScientificPluginBackend = {
    start: vi.fn(async () => {
      info = {
        ...info,
        status: "running",
        port: 43123,
        url: "http://127.0.0.1:43123",
      };
      return info.port;
    }),
    restart: vi.fn(async () => {
      info = {
        ...info,
        status: "running",
        port: 43124,
        url: "http://127.0.0.1:43124",
      };
      return info.port;
    }),
    stop: vi.fn(async () => {
      info = { ...info, status: "stopped", port: 0 };
    }),
    getInfo: vi.fn(() => info),
    getUrl: vi.fn(() => info.url),
  };
  return { backend, setInfo: (next: BackendInfo) => { info = next; } };
}

describe("ScientificPluginLifecycle", () => {
  it("keeps Python inactive until a scientific URL is explicitly acquired", () => {
    const { backend } = makeBackend();
    const prepare = vi.fn(async () => undefined);
    const lifecycle = new ScientificPluginLifecycle(backend, prepare);

    expect(lifecycle.getInfo()).toMatchObject({
      role: "scientific-plugin",
      status: "stopped",
      ready: false,
      requested: false,
      port: null,
      url: null,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(backend.start).not.toHaveBeenCalled();
  });

  it("single-flights concurrent lazy acquisitions and waits for readiness", async () => {
    const { backend } = makeBackend();
    const prepare = vi.fn(async () => undefined);
    const lifecycle = new ScientificPluginLifecycle(backend, prepare);

    const [first, second] = await Promise.all([
      lifecycle.getUrl(),
      lifecycle.getUrl(),
    ]);

    expect(first).toBe("http://127.0.0.1:43123");
    expect(second).toBe(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("fails closed when runtime preparation fails", async () => {
    const { backend } = makeBackend();
    const lifecycle = new ScientificPluginLifecycle(
      backend,
      vi.fn().mockRejectedValue(new Error("Python runtime is not configured")),
    );

    await expect(lifecycle.getUrl()).rejects.toThrow(
      "Python runtime is not configured",
    );
    expect(backend.start).not.toHaveBeenCalled();
    expect(lifecycle.getInfo().url).toBeNull();
  });

  it("does not retry a missing Python host until runtime selection changes", async () => {
    const { backend } = makeBackend();
    const prepare = vi.fn().mockRejectedValueOnce(
      new Error("Python plugin host is not configured"),
    ).mockResolvedValue(undefined);
    const lifecycle = new ScientificPluginLifecycle(backend, prepare);

    await expect(lifecycle.getUrl()).rejects.toThrow(
      "Python plugin host is not configured",
    );
    await expect(lifecycle.getUrl()).rejects.toThrow(
      "Python plugin host is not configured",
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(backend.start).not.toHaveBeenCalled();

    lifecycle.clearFailure();
    await expect(lifecycle.getUrl()).resolves.toBe(
      "http://127.0.0.1:43123",
    );
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(backend.start).toHaveBeenCalledTimes(1);
  });

  it("restarts only the scientific backend", async () => {
    const { backend } = makeBackend();
    const prepare = vi.fn(async () => undefined);
    const lifecycle = new ScientificPluginLifecycle(backend, prepare);

    await expect(lifecycle.restart()).resolves.toBe(43124);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(backend.restart).toHaveBeenCalledTimes(1);
  });
});
