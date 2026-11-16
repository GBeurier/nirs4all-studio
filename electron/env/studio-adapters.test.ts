import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const installRuntimeAdapters = vi.hoisted(() => vi.fn());
vi.mock("./external-config", () => ({
  loadRuntimeAdapterInstaller: () => ({ installer: { installRuntimeAdapters }, root: "/checkout" }),
}));
import { resolveStudioAdaptersDir } from "./studio-adapters";

describe("Studio document adapters location", () => {
  it("uses the adapters shipped in the packaged resources", () => {
    expect(resolveStudioAdaptersDir({ packaged: true, resourcesPath: "/app/resources", cacheDir: "/data/studio-adapters" }))
      .toBe(path.join("/app/resources", "backend", "adapters"));
    expect(installRuntimeAdapters).not.toHaveBeenCalled();
  });

  it("materialises the adapters once into Studio's own cache directory in development", () => {
    const options = { packaged: false, resourcesPath: "/electron/resources", cacheDir: "/data/studio-adapters" };
    expect(resolveStudioAdaptersDir(options)).toBe("/data/studio-adapters");
    expect(resolveStudioAdaptersDir(options)).toBe("/data/studio-adapters");
    expect(installRuntimeAdapters).toHaveBeenCalledTimes(1);
    expect(installRuntimeAdapters).toHaveBeenCalledWith("/checkout", "/data/studio-adapters");
  });
});
