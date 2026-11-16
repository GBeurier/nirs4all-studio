import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSelectedPythonPath, writeSelectedPythonPath } from "./env-settings";

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
  it("stores only the interpreter path", () => {
    const file = settingsFile();
    expect(readSelectedPythonPath(file)).toBeNull();
    writeSelectedPythonPath(file, "D:/Données essais/été/python.exe");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ pythonPath: "D:/Données essais/été/python.exe" });
    expect(readSelectedPythonPath(file)).toBe("D:/Données essais/été/python.exe");
    writeSelectedPythonPath(file, null);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({});
    expect(readSelectedPythonPath(file)).toBeNull();
  });

  it("reads the interpreter of a file written by an earlier release and nothing else", () => {
    const file = settingsFile();
    fs.writeFileSync(file, JSON.stringify({ pythonPath: "C:/env/python.exe", appVersion: "0.15.3", skipWizardOnLaunch: true }));
    expect(readSelectedPythonPath(file)).toBe("C:/env/python.exe");
    // The included runtime of earlier releases no longer exists: nothing is selected.
    fs.writeFileSync(file, JSON.stringify({ runtime: "bundled", appVersion: "0.15.11" }));
    expect(readSelectedPythonPath(file)).toBeNull();
  });

  it("retains a complete selection after an interrupted replacement", () => {
    const file = settingsFile();
    writeSelectedPythonPath(file, "C:/env/python.exe");
    vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("disk is read-only"); });
    expect(() => writeSelectedPythonPath(file, "C:/other/python.exe")).toThrow("Could not save");
    expect(readSelectedPythonPath(file)).toBe("C:/env/python.exe");
    expect(fs.readdirSync(path.dirname(file)).some(name => name.endsWith(".tmp"))).toBe(false);
  });

  it.each(["{", "[]", '{"pythonPath":42}', '{"pythonPath":""}'])("recovers a damaged settings file (%s) and can save again", content => {
    const file = settingsFile();
    writeSelectedPythonPath(file, "C:/env/python.exe");
    writeSelectedPythonPath(file, "C:/env/python.exe");
    fs.writeFileSync(file, content);
    expect(readSelectedPythonPath(file)).toBe("C:/env/python.exe");
    writeSelectedPythonPath(file, "C:/env/python.exe");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ pythonPath: "C:/env/python.exe" });
  });
});
