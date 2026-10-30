import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./env/process-utils", () => ({ execFileText: vi.fn() }));
import { execFileText } from "./env/process-utils";
import { checkRuntimePackageVersions } from "./env/runtime-version-check";

const directories: string[] = [];
function fixture() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-version-check-"));
  directories.push(userDataDir);
  const root = path.join(userDataDir, "venv");
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.mkdirSync(path.join(root, "lib", "python3.11", "site-packages"), { recursive: true });
  fs.writeFileSync(path.join(root, "pyvenv.cfg"), "version = 3.11");
  return { userDataDir, pythonPath: path.join(root, "bin", "python"), appVersion: "0.15.4", reused: true };
}
afterEach(() => {
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("startup package version check", () => {
  it("checks once, reuses the result on restart, and checks after an app update or env change", async () => {
    const options = fixture();
    vi.mocked(execFileText).mockResolvedValue({ stdout: "[]", stderr: "" });
    await expect(checkRuntimePackageVersions(options)).resolves.toBeNull();
    await expect(checkRuntimePackageVersions(options)).resolves.toBeNull();
    expect(execFileText).toHaveBeenCalledTimes(1);
    await expect(checkRuntimePackageVersions({ ...options, appVersion: "0.15.5" })).resolves.toBeNull();
    expect(execFileText).toHaveBeenCalledTimes(2);
    await expect(checkRuntimePackageVersions({ ...options, pythonPath: "/other/python" })).resolves.toBeNull();
    expect(execFileText).toHaveBeenCalledTimes(3);
  });

  it("retains the installed and required versions and offers an update without installing anything", async () => {
    const options = fixture();
    vi.mocked(execFileText).mockResolvedValue({ stdout: '["nirs4all 1.0.3 is installed; 1.4.13 is required"]', stderr: "" });
    const error = await checkRuntimePackageVersions(options);
    expect(error).toContain("nirs4all 1.0.3 is installed; 1.4.13 is required");
    expect(error).toContain("Install the required versions");
    expect(error).toContain("can downgrade newer packages");
    await expect(checkRuntimePackageVersions(options)).resolves.toBe(error);
    expect(execFileText).toHaveBeenCalledTimes(1);
    vi.mocked(execFileText).mockResolvedValue({ stdout: "[]", stderr: "" });
    await expect(checkRuntimePackageVersions({ ...options, force: true })).resolves.toBeNull();
    await expect(checkRuntimePackageVersions(options)).resolves.toBeNull();
    expect(execFileText).toHaveBeenCalledTimes(2);
  });

  it("does not probe the immutable bundled runtime", async () => {
    await expect(checkRuntimePackageVersions({ ...fixture(), reused: false })).resolves.toBeNull();
    expect(execFileText).not.toHaveBeenCalled();
  });

  it("rechecks when external pip changes the selected site-packages directory", async () => {
    const options = fixture();
    vi.mocked(execFileText).mockResolvedValue({ stdout: "[]", stderr: "" });
    await checkRuntimePackageVersions(options);
    const sitePackages = path.join(options.userDataDir, "venv", "lib", "python3.11", "site-packages");
    fs.utimesSync(sitePackages, new Date(), new Date(Date.now() + 5000));
    vi.mocked(execFileText).mockResolvedValue({ stdout: '["nirs4all 1.0.3 is installed; 1.4.13 is required"]', stderr: "" });
    expect(await checkRuntimePackageVersions(options)).toContain("1.0.3 is installed");
    expect(execFileText).toHaveBeenCalledTimes(2);
  });

  it("retries a failed probe instead of caching it as ready", async () => {
    const options = fixture();
    vi.mocked(execFileText).mockResolvedValue(null);
    await expect(checkRuntimePackageVersions(options)).resolves.toBeNull();
    vi.mocked(execFileText).mockResolvedValue({ stdout: "[]", stderr: "" });
    await expect(checkRuntimePackageVersions(options)).resolves.toBeNull();
    expect(execFileText).toHaveBeenCalledTimes(2);
  });
});
