import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyPortablePathOverrides, resolvePortableLayout } from "./portable-paths";

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("portable path helpers", () => {
  it("returns null outside portable mode", () => {
    expect(resolvePortableLayout({})).toBeNull();
  });

  it.skipIf(process.platform !== "win32")("derives a stable portable layout from the portable executable", () => {
    const layout = resolvePortableLayout({
      PORTABLE_EXECUTABLE_FILE: "C:\\portable\\nirs4all Studio.exe",
    });

    expect(layout).not.toBeNull();
    expect(layout?.portableRoot).toBe(path.join("C:\\portable", ".nirs4all"));
    expect(layout?.userDataDir).toBe(path.join("C:\\portable", ".nirs4all", "userData"));
    expect(layout?.configDir).toBe(path.join("C:\\portable", ".nirs4all", "config"));
  });

  it("sets electron paths and backend env vars for portable runs", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-portable-"));
    tmpRoots.push(tempRoot);

    const env: NodeJS.ProcessEnv = {
      PORTABLE_EXECUTABLE_FILE: path.join(tempRoot, "nirs4all Studio.exe"),
    };
    const setPathCalls: Array<[string, string]> = [];
    const fakeApp = {
      setPath(name: string, value: string) {
        setPathCalls.push([name, value]);
      },
    };

    const layout = applyPortablePathOverrides(fakeApp, env);

    expect(layout).not.toBeNull();
    expect(env.NIRS4ALL_PORTABLE_ROOT).toBe(path.join(tempRoot, ".nirs4all"));
    expect(env.NIRS4ALL_CONFIG).toBe(path.join(tempRoot, ".nirs4all", "config"));
    expect(env.NIRS4ALL_BACKEND_DATA_DIR).toBe(path.join(tempRoot, ".nirs4all", "backend-data"));
    expect(env.NIRS4ALL_BACKEND_LOG_DIR).toBe(path.join(tempRoot, ".nirs4all", "logs"));
    expect(fs.existsSync(path.join(tempRoot, ".nirs4all", "userData"))).toBe(true);
    expect(setPathCalls).toEqual([
      ["userData", path.join(tempRoot, ".nirs4all", "userData")],
      ["sessionData", path.join(tempRoot, ".nirs4all", "userData", "sessionData")],
    ]);
  });

  it("migrates legacy shared state into the portable layout without overwriting existing files", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "n4a-portable-"));
    const roamingRoot = path.join(tempRoot, "Roaming");
    const localRoot = path.join(tempRoot, "Local");
    tmpRoots.push(tempRoot);

    const legacyUserDataDir = path.join(roamingRoot, "nirs4all-webapp");
    const legacyConfigDir = path.join(roamingRoot, "nirs4all");
    const legacyBackendDataDir = path.join(localRoot, "nirs4all", "nirs4all-webapp");

    fs.mkdirSync(legacyUserDataDir, { recursive: true });
    fs.mkdirSync(legacyConfigDir, { recursive: true });
    fs.mkdirSync(path.join(legacyBackendDataDir, "config_snapshots"), { recursive: true });

    fs.writeFileSync(path.join(legacyUserDataDir, "env-settings.json"), JSON.stringify({ pythonPath: "C:\\legacy\\python.exe" }));
    fs.writeFileSync(path.join(legacyConfigDir, "app_settings.json"), JSON.stringify({ version: "legacy" }));
    fs.writeFileSync(path.join(legacyBackendDataDir, "setup_status.json"), JSON.stringify({ selected_profile: "cpu" }));
    fs.writeFileSync(path.join(legacyBackendDataDir, "config_snapshots", "snapshot.json"), "{}");

    const env: NodeJS.ProcessEnv = {
      APPDATA: roamingRoot,
      LOCALAPPDATA: localRoot,
      PORTABLE_EXECUTABLE_FILE: path.join(tempRoot, "portable", "nirs4all Studio.exe"),
    };
    const fakeApp = {
      setPath() {
        // no-op
      },
    };

    const targetUserDataFile = path.join(tempRoot, "portable", ".nirs4all", "userData", "env-settings.json");
    fs.mkdirSync(path.dirname(targetUserDataFile), { recursive: true });
    fs.writeFileSync(targetUserDataFile, JSON.stringify({ pythonPath: "C:\\portable\\python.exe" }));

    const layout = applyPortablePathOverrides(fakeApp, env);

    expect(layout).not.toBeNull();
    expect(fs.readFileSync(targetUserDataFile, "utf-8")).toContain("portable");
    expect(fs.readFileSync(path.join(tempRoot, "portable", ".nirs4all", "config", "app_settings.json"), "utf-8")).toContain("legacy");
    expect(fs.readFileSync(path.join(tempRoot, "portable", ".nirs4all", "backend-data", "nirs4all-webapp", "setup_status.json"), "utf-8")).toContain("cpu");
    expect(fs.existsSync(path.join(tempRoot, "portable", ".nirs4all", "backend-data", "nirs4all-webapp", "config_snapshots", "snapshot.json"))).toBe(true);
  });
});
