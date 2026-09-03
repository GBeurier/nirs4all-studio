import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("R2 transitional packaged runtime", () => {
  it("packages the executable Python HTTP backend used by the opt-in legacy fallback", () => {
    const main = source("electron/main.ts");
    const releaseBuilder = source("scripts/build-release.cjs");
    const archiveBuilder = source("scripts/build-archive-standalone.cjs");
    const installer = source("electron-builder.installer.yml");
    const runtimeConfig = source("scripts/python-runtime-config.cjs");

    expect(main).toContain('import { BackendManager, type BackendStatus } from "./backend-manager"');
    expect(main).toContain("const backendManager = new BackendManager()");
    expect(main).not.toContain("new NativeSidecarManager()");
    expect(releaseBuilder).toContain('"scripts/copy-backend-source.cjs", "--clean"');
    expect(archiveBuilder).toContain('path.join("scripts", "bake-standalone-backend.cjs")');
    expect(installer).toContain('- "api/**/*"');
    expect(installer).toContain('- "websocket/**/*"');
    expect(installer).toContain('- "main.py"');
    expect(runtimeConfig).toContain('"fastapi>=0.115.0"');
    expect(runtimeConfig).toContain('"uvicorn[standard]>=0.34.0"');
  });
});
