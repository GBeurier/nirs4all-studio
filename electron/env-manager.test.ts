import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const fakeApp = {
  getPath: vi.fn(),
  getVersion: vi.fn(() => "0.3.1"),
};

vi.mock("electron", () => ({
  default: {
    app: fakeApp,
  },
  app: fakeApp,
}));

const tempDirs: string[] = [];

function makeUserDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-env-"));
  tempDirs.push(dir);
  (globalThis as { __NIRS4ALL_TEST_APP__?: typeof fakeApp }).__NIRS4ALL_TEST_APP__ =
    fakeApp;
  fakeApp.getPath.mockImplementation(() => dir);
  return dir;
}

afterEach(() => {
  vi.resetModules();
  fakeApp.getPath.mockReset();
  fakeApp.getVersion.mockReset();
  fakeApp.getVersion.mockReturnValue("0.3.1");

  delete process.env.PORTABLE_EXECUTABLE_FILE;
  delete (globalThis as { __NIRS4ALL_TEST_APP__?: typeof fakeApp })
    .__NIRS4ALL_TEST_APP__;

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("EnvManager", () => {
  it("clears a stale saved custom python path instead of treating it as ready", async () => {
    const userDataDir = makeUserDataDir();
    const settingsPath = path.join(userDataDir, "env-settings.json");

    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        pythonPath: path.join(userDataDir, "missing", "python.exe"),
        appVersion: "0.3.1",
      }),
    );

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    expect(manager.isReady()).toBe(false);
    expect(manager.validateConfiguredState()).toBe(false);
    expect(manager.shouldShowWizard()).toBe(true);

    const saved = JSON.parse(fs.readFileSync(settingsPath, "utf-8")) as {
      pythonPath?: string;
    };
    expect(saved.pythonPath).toBeUndefined();
  });

  it("fails fast when backend package repair is requested without a usable runtime", async () => {
    makeUserDataDir();

    const { EnvManager } = await import("./env-manager");
    const manager = new EnvManager();

    await expect(manager.ensureBackendPackages()).rejects.toThrow(
      "Python environment is not configured or is missing",
    );
  });
});
