import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readEnvSettings, writeEnvSettings } from "./env-settings";

const directories: string[] = [];
function settingsFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-env-settings-"));
  directories.push(dir);
  return path.join(dir, "env-settings.json");
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("persisted Python selection", () => {
  it("retains a complete selection after an interrupted replacement", () => {
    const file = settingsFile();
    const first = { pythonPath: "C:/env/python.exe", appVersion: "0.15.3" };
    writeEnvSettings(file, first);
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk is read-only"); });
    expect(() => writeEnvSettings(file, { pythonPath: "C:/other/python.exe" })).toThrow("Could not save");
    expect(readEnvSettings(file)).toEqual(first);
    expect(fs.readdirSync(path.dirname(file)).some(name => name.endsWith(".tmp"))).toBe(false);
  });

  it.each(["{", "[]", '{"pythonPath":42}', '{"skipWizardOnLaunch":"false"}'])("recovers a damaged settings file (%s) and can save again", content => {
    const file = settingsFile();
    const original = { pythonPath: "C:/env/python.exe", skipWizardOnLaunch: false };
    writeEnvSettings(file, original);
    writeEnvSettings(file, original);
    fs.writeFileSync(file, content);
    expect(readEnvSettings(file)).toEqual(original);
    writeEnvSettings(file, original);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(original);
  });

  it("round-trips Unicode paths, version updates and explicit false preferences", () => {
    const file = settingsFile();
    const state = { pythonPath: "D:/Données essais/été/python.exe", appVersion: "0.15.4", skipWizardOnLaunch: false };
    writeEnvSettings(file, state);
    expect(readEnvSettings(file)).toEqual(state);
  });
});
