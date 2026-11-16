// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./python-runtime-installer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./python-runtime-installer")>()),
  downloadFile: vi.fn(),
}));
import { downloadFile } from "./python-runtime-installer";
import { cachedWheelhouse, ensureWheelhouse, readWheelhouseManifest } from "./wheelhouse";
import type { WheelhouseManifest } from "./wheelhouse";

const DOWNLOAD_FAILED = "Studio could not download its required packages. Check the internet connection and try again.";
const WHEEL = "nirs4all_methods-1.3.15-cp311-cp311-macosx_11_0_arm64.whl";
let root: string;
let cacheDirectory: string;
let archive: string;
let manifest: WheelhouseManifest;
let progress: string[];

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** A `.tar.gz` whose single top-level directory is `directory`. */
function makeArchive(name: string, directory: string): string {
  const source = fs.mkdtempSync(path.join(root, "source-"));
  fs.mkdirSync(path.join(source, directory));
  fs.writeFileSync(path.join(source, directory, WHEEL), `wheel bytes of ${name}`);
  const target = path.join(root, name);
  expect(spawnSync("tar", ["-czf", target, "-C", source, directory]).status).toBe(0);
  return target;
}

function cache() {
  return { directory: cacheDirectory, onProgress: (detail: string) => { progress.push(detail); } };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-wheelhouse-"));
  cacheDirectory = path.join(root, "user-data", "wheelhouse");
  archive = makeArchive("wheels-macos-arm64.tar.gz", "wheels");
  manifest = { url: "https://example.test/releases/wheels-macos-arm64.tar.gz", sha256: sha256(archive), filename: "wheels-macos-arm64.tar.gz" };
  progress = [];
  vi.mocked(downloadFile).mockImplementation(async (_url, destination, onProgress) => {
    onProgress?.(50);
    fs.copyFileSync(archive, destination);
  });
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  delete process.env.NIRS4ALL_WHEELHOUSE_ARCHIVE;
  vi.restoreAllMocks();
  vi.mocked(downloadFile).mockReset();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("downloaded wheelhouse", () => {
  it("downloads, verifies and extracts the archive into place, then reuses it", async () => {
    expect(cachedWheelhouse(manifest, cacheDirectory)).toBeNull();

    const wheels = await ensureWheelhouse(manifest, cache());

    expect(wheels).toBe(path.join(cacheDirectory, manifest.sha256, "wheels"));
    expect(fs.readdirSync(wheels)).toEqual([WHEEL]);
    expect(vi.mocked(downloadFile).mock.calls[0][0]).toBe(manifest.url);
    expect(progress).toEqual(["Downloading the required packages…", "Downloading the required packages… 50%"]);
    // Only the complete directory remains: no archive, no staging directory.
    expect(fs.readdirSync(cacheDirectory)).toEqual([manifest.sha256]);
    expect(fs.readdirSync(path.join(cacheDirectory, manifest.sha256))).toEqual(["wheels"]);

    progress.length = 0;
    expect(await ensureWheelhouse(manifest, cache())).toBe(wheels);
    expect(cachedWheelhouse(manifest, cacheDirectory)).toBe(wheels);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([]);
  });

  it("removes the caches of earlier Studio versions once the new one is in place", async () => {
    const earlier = path.join(cacheDirectory, "a".repeat(64), "wheels");
    const interrupted = path.join(cacheDirectory, ".incoming-crashed");
    fs.mkdirSync(earlier, { recursive: true });
    fs.mkdirSync(interrupted);

    await ensureWheelhouse(manifest, cache());

    expect(fs.readdirSync(cacheDirectory)).toEqual([manifest.sha256]);
  });

  it("leaves no cache when the checksum does not match", async () => {
    const earlier = path.join(cacheDirectory, "a".repeat(64), "wheels");
    fs.mkdirSync(earlier, { recursive: true });
    vi.mocked(downloadFile).mockImplementation(async (_url, destination) => { fs.writeFileSync(destination, "truncated"); });

    await expect(ensureWheelhouse(manifest, cache())).rejects.toThrow(DOWNLOAD_FAILED);

    expect(cachedWheelhouse(manifest, cacheDirectory)).toBeNull();
    // Nothing half-made, and the earlier cache is only removed by a successful replacement.
    expect(fs.readdirSync(cacheDirectory)).toEqual(["a".repeat(64)]);
  });

  it("fails with the same clear message when the download fails", async () => {
    vi.mocked(downloadFile).mockRejectedValue(new Error("Download failed with status 404"));

    const failure = await ensureWheelhouse(manifest, cache()).then(() => null, (error: Error) => error);

    expect(failure?.message).toBe(DOWNLOAD_FAILED);
    expect((failure?.cause as Error).message).toBe("Download failed with status 404");
    expect(fs.readdirSync(cacheDirectory)).toEqual([]);
  });

  it("refuses an archive that does not contain the wheels directory", async () => {
    archive = makeArchive("other.tar.gz", "packages");
    manifest = { ...manifest, sha256: sha256(archive) };

    await expect(ensureWheelhouse(manifest, cache())).rejects.toThrow(DOWNLOAD_FAILED);
    expect(fs.readdirSync(cacheDirectory)).toEqual([]);
  });

  it("uses a local archive instead of the download, verified against the same checksum", async () => {
    process.env.NIRS4ALL_WHEELHOUSE_ARCHIVE = archive;

    const wheels = await ensureWheelhouse(manifest, cache());

    expect(fs.readdirSync(wheels)).toEqual([WHEEL]);
    expect(downloadFile).not.toHaveBeenCalled();
    expect(fs.existsSync(archive)).toBe(true);
  });

  it("refuses a local archive with another checksum and leaves that file alone", async () => {
    const other = makeArchive("other-build.tar.gz", "wheels");
    process.env.NIRS4ALL_WHEELHOUSE_ARCHIVE = other;

    await expect(ensureWheelhouse(manifest, cache())).rejects.toThrow(DOWNLOAD_FAILED);

    expect(fs.existsSync(other)).toBe(true);
    expect(cachedWheelhouse(manifest, cacheDirectory)).toBeNull();
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

describe("wheelhouse manifest", () => {
  function manifestFile(content: string): string {
    const file = path.join(root, "wheelhouse.json");
    fs.writeFileSync(file, content);
    return file;
  }

  it("reads the archive's address, checksum and file name", () => {
    expect(readWheelhouseManifest(manifestFile(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it.each([
    ["not JSON", "{"],
    ["a list", "[]"],
    ["a missing checksum", JSON.stringify({ url: "https://example.test/w.tar.gz", filename: "w.tar.gz" })],
    ["a short checksum", JSON.stringify({ url: "https://example.test/w.tar.gz", sha256: "abc", filename: "w.tar.gz" })],
    ["an upper-case checksum", JSON.stringify({ url: "https://example.test/w.tar.gz", sha256: "A".repeat(64), filename: "w.tar.gz" })],
    ["a local address", JSON.stringify({ url: "file:///tmp/w.tar.gz", sha256: "a".repeat(64), filename: "w.tar.gz" })],
    ["a file name with a directory", JSON.stringify({ url: "https://example.test/w.tar.gz", sha256: "a".repeat(64), filename: "../w.tar.gz" })],
    ["another archive type", JSON.stringify({ url: "https://example.test/w.zip", sha256: "a".repeat(64), filename: "w.zip" })],
    ["an unknown field", JSON.stringify({ url: "https://example.test/w.tar.gz", sha256: "a".repeat(64), filename: "w.tar.gz", size: 1 })],
  ])("treats %s as a damaged installation", (_label, content) => {
    expect(() => readWheelhouseManifest(manifestFile(content))).toThrow("This Studio installation is damaged");
  });
});
