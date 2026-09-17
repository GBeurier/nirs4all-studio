import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env/process-utils", () => ({ runCommand: vi.fn(), rmWithRetry: vi.fn() }));
vi.mock("./env/python-runtime-installer", () => ({ downloadFile: vi.fn(), extractTarball: vi.fn(), removeQuarantine: vi.fn() }));
vi.mock("./env/runtime-validation", () => ({ validatePythonRuntime: vi.fn() }));
import { rmWithRetry, runCommand } from "./env/process-utils";
import { downloadFile, extractTarball } from "./env/python-runtime-installer";
import { validatePythonRuntime } from "./env/runtime-validation";
import { provisionManagedRuntime } from "./env/provisioning";

const roots: string[] = [];
beforeEach(() => {
  vi.mocked(rmWithRetry).mockImplementation(async (directory) => { fs.rmSync(directory, { recursive: true, force: true }); });
});
afterEach(() => { vi.resetAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("managed provisioning readiness", () => {
  it("leaves setup incomplete when the installed runtime fails validation", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-provisioning-"));
    roots.push(root);
    vi.mocked(downloadFile).mockImplementation(async (_url, destination) => { fs.writeFileSync(destination, "archive"); });
    vi.mocked(extractTarball).mockImplementation(async (_archive, destination) => {
      const python = path.join(destination, process.platform === "win32" ? "python/python.exe" : "python/bin/python3");
      fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, "");
    });
    vi.mocked(runCommand).mockImplementation(async (_command, args) => {
      if (args.includes("venv")) {
        const python = path.join(root, process.platform === "win32" ? "venv/Scripts/python.exe" : "venv/bin/python");
        fs.mkdirSync(path.dirname(python), { recursive: true }); fs.writeFileSync(python, "");
      }
    });
    vi.mocked(validatePythonRuntime).mockRejectedValue(new Error("pip check: incompatible dependency"));
    const ctx = { envDir: root, setStatus: vi.fn(), setLastError: vi.fn(), setPythonPath: vi.fn(), saveSettings: vi.fn() };
    await expect(provisionManagedRuntime(ctx)).rejects.toThrow("incompatible dependency");
    expect(ctx.setStatus).toHaveBeenLastCalledWith("error");
    expect(ctx.setStatus).not.toHaveBeenCalledWith("ready");
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    expect(ctx.setPythonPath).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(root, "build_info.json"))).toBe(false);
  });

  it("discards an archive that fails extraction so the next attempt can download again", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-corrupt-archive-"));
    roots.push(root);
    let archive = "";
    vi.mocked(downloadFile).mockImplementation(async (_url, destination) => { archive = destination; fs.writeFileSync(destination, "corrupt"); });
    vi.mocked(extractTarball).mockRejectedValue(new Error("truncated tarball"));
    const ctx = { envDir: root, setStatus: vi.fn(), setLastError: vi.fn(), setPythonPath: vi.fn(), saveSettings: vi.fn() };
    await expect(provisionManagedRuntime(ctx)).rejects.toThrow("truncated tarball");
    expect(fs.existsSync(archive)).toBe(false);
    await expect(provisionManagedRuntime(ctx)).rejects.toThrow("truncated tarball");
    expect(downloadFile).toHaveBeenCalledTimes(2);
  });
});
