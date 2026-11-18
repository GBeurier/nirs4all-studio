import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./env/process-utils", () => ({ rmWithRetry: vi.fn() }));
vi.mock("./env/python-runtime-installer", () => ({ downloadFile: vi.fn(), extractTarball: vi.fn(), removeQuarantine: vi.fn(), verifySha256: vi.fn() }));
vi.mock("./env/uv", () => ({
  createVenv: vi.fn(),
  installRecommendedPackages: vi.fn(),
  installRequiredPackages: vi.fn(),
  resolveUvPayload: vi.fn(),
}));
import { REQUIRED_PACKAGES } from "./env/catalogue";
import { rmWithRetry } from "./env/process-utils";
import { downloadFile, extractTarball, verifySha256 } from "./env/python-runtime-installer";
import { createStudioEnvironment } from "./env/provisioning";
import { getStandalonePythonPath, getVenvPythonPath } from "./env/runtime-paths";
import { createVenv, installRecommendedPackages, installRequiredPackages, resolveUvPayload } from "./env/uv";

const { getArchiveFilename } = createRequire(import.meta.url)("../scripts/python-runtime-config.cjs") as {
  getArchiveFilename(platform: string, arch: string): string;
};
const roots: string[] = [];
const steps: string[] = [];

function baseDirectory(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-provisioning-"));
  roots.push(root);
  return path.join(root, "python-env");
}

beforeEach(() => {
  vi.mocked(rmWithRetry).mockImplementation(async (directory) => { fs.rmSync(directory, { recursive: true, force: true }); });
  vi.mocked(resolveUvPayload).mockReturnValue({ wheelhouse: null, offline: null });
  vi.mocked(downloadFile).mockImplementation(async (_url, destination, onProgress) => {
    steps.push("download");
    onProgress?.(50);
    fs.writeFileSync(destination, "archive");
  });
  vi.mocked(extractTarball).mockImplementation(async (_archive, destination) => {
    steps.push("extract");
    const python = getStandalonePythonPath(destination);
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(python, "");
  });
  vi.mocked(createVenv).mockImplementation(async (venvDir) => {
    steps.push("venv");
    const python = getVenvPythonPath(path.dirname(venvDir));
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(python, "");
  });
  vi.mocked(installRequiredPackages).mockImplementation(async () => { steps.push("required"); });
  vi.mocked(installRecommendedPackages).mockImplementation(async () => { steps.push("recommended"); });
});
afterEach(() => {
  vi.resetAllMocks();
  steps.length = 0;
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Studio environment creation", () => {
  it("downloads the pinned runtime, creates the environment and installs required then chosen packages", async () => {
    const baseDir = baseDirectory();
    const progress = vi.fn();

    const pythonPath = await createStudioEnvironment(baseDir, ["torch"], progress);

    expect(pythonPath).toBe(getVenvPythonPath(baseDir));
    expect(steps).toEqual(["download", "extract", "venv", "required", "recommended"]);
    expect(vi.mocked(downloadFile).mock.calls[0][0]).toMatch(/^https:\/\/github\.com\/astral-sh\/python-build-standalone\/releases\/download\/\d+\/cpython-3\.11\./);
    expect(createVenv).toHaveBeenCalledWith(path.join(baseDir, "venv"), getStandalonePythonPath(baseDir));
    expect(installRequiredPackages).toHaveBeenCalledWith(pythonPath);
    // Resolved together with the exact cohort that was just installed.
    expect(installRecommendedPackages).toHaveBeenCalledWith(pythonPath, ["torch"], REQUIRED_PACKAGES.map((spec) => `${spec.name}==${spec.install}`));
    const percents = progress.mock.calls.map(([percent]) => percent as number);
    expect(percents).toEqual([...percents].sort((left, right) => left - right));
    expect(percents.at(-1)).toBe(100);
    // Only the runtime and the environment remain.
    expect(fs.readdirSync(baseDir).sort()).toEqual(["python", "venv"]);
  });

  it("uses the offline payload's runtime archive without any download", async () => {
    const baseDir = baseDirectory();
    const offline = path.join(path.dirname(baseDir), "offline");
    fs.mkdirSync(offline);
    vi.mocked(resolveUvPayload).mockReturnValue({ wheelhouse: null, offline });
    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("offline installer does not contain the Python runtime");

    const archive = path.join(offline, getArchiveFilename(process.platform, process.arch));
    fs.writeFileSync(archive, "archive");
    await createStudioEnvironment(baseDir, [], vi.fn());

    expect(downloadFile).not.toHaveBeenCalled();
    expect(vi.mocked(extractTarball).mock.calls[0][0]).toBe(archive);
    expect(installRecommendedPackages).not.toHaveBeenCalled();
    // The shipped archive belongs to the installation and is kept.
    expect(fs.existsSync(archive)).toBe(true);
  });

  it("refuses to overwrite an existing environment", async () => {
    const baseDir = baseDirectory();
    const existing = getVenvPythonPath(baseDir);
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, "user environment");

    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("already exists in this folder");

    expect(fs.readFileSync(existing, "utf8")).toBe("user environment");
    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("removes a half-created environment but keeps the download for the next attempt", async () => {
    const baseDir = baseDirectory();
    vi.mocked(installRequiredPackages).mockRejectedValueOnce(new Error("resolver conflict"));

    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("resolver conflict");
    expect(fs.existsSync(path.join(baseDir, "venv"))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, "python"))).toBe(false);

    await createStudioEnvironment(baseDir, [], vi.fn());
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it("refuses a download that does not match its pinned checksum", async () => {
    const baseDir = baseDirectory();
    vi.mocked(verifySha256).mockRejectedValueOnce(new Error("corrupt"));

    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("corrupt");

    expect(verifySha256).toHaveBeenCalledWith(expect.stringContaining(baseDir), expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(extractTarball).not.toHaveBeenCalled();
  });

  it("discards an archive that fails extraction so the next attempt downloads again", async () => {
    const baseDir = baseDirectory();
    vi.mocked(extractTarball).mockRejectedValue(new Error("truncated tarball"));

    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("truncated tarball");
    await expect(createStudioEnvironment(baseDir, [], vi.fn())).rejects.toThrow("truncated tarball");

    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(createVenv).not.toHaveBeenCalled();
  });
});
