/**
 * Required wheels that are not embedded in the application.
 *
 * Windows and Linux installers carry a `wheels/` directory. The macOS
 * application cannot (archives with unsigned binaries fail notarisation): it
 * carries `wheelhouse.json`, which names an archive of the same wheels. The
 * archive is downloaded once, verified, and kept under the user's data
 * directory, one directory per archive hash.
 */

import fs from "node:fs";
import path from "node:path";

import { appendInstallLog } from "./install-log";
import { downloadFile, extractTarball, verifySha256 } from "./python-runtime-installer";

export interface WheelhouseManifest {
  url: string;
  sha256: string;
  filename: string;
}

/** Where a downloaded wheelhouse is kept and how its download is announced. */
export interface WheelhouseCache {
  /** `<userData>/wheelhouse`. */
  directory: string;
  /** A status line for the running operation, while the archive is downloaded. */
  onProgress(detail: string): void;
}

/** A local archive that replaces the download (smoke tests before a release exists). */
const LOCAL_ARCHIVE_ENV = "NIRS4ALL_WHEELHOUSE_ARCHIVE";

/** Read the manifest shipped with the application. An invalid one is a packaging error, not "no wheelhouse". */
export function readWheelhouseManifest(manifestPath: string): WheelhouseManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = null;
  }
  const { url, sha256, filename } = (manifest && typeof manifest === "object" ? manifest : {}) as Record<string, unknown>;
  const valid = manifest !== null && typeof manifest === "object" && !Array.isArray(manifest)
    && Object.keys(manifest).sort().join() === "filename,sha256,url"
    && typeof url === "string" && /^https?:\/\/\S+$/.test(url)
    && typeof sha256 === "string" && /^[0-9a-f]{64}$/.test(sha256)
    && typeof filename === "string" && /^[^\\/]+\.tar\.gz$/.test(filename);
  if (!valid) {
    throw new Error("This Studio installation is damaged: the description of its required packages (wheelhouse.json) is invalid. Reinstall Studio.");
  }
  return { url, sha256, filename } as WheelhouseManifest;
}

function wheelsDirectory(manifest: WheelhouseManifest, cacheDirectory: string): string {
  return path.join(cacheDirectory, manifest.sha256, "wheels");
}

/** The wheel directory of an archive that is already in the cache, or null. */
export function cachedWheelhouse(manifest: WheelhouseManifest, cacheDirectory: string): string | null {
  const wheels = wheelsDirectory(manifest, cacheDirectory);
  return fs.existsSync(wheels) ? wheels : null;
}

/**
 * The wheel directory of the manifest's archive, downloaded on first use. The
 * archive is verified and extracted aside, then renamed into place: a
 * directory in the cache is always complete. Caches of other archives (earlier
 * Studio versions) are removed once the new one is in place.
 */
export async function ensureWheelhouse(manifest: WheelhouseManifest, cache: WheelhouseCache): Promise<string> {
  const cached = cachedWheelhouse(manifest, cache.directory);
  if (cached) return cached;

  let staging: string | null = null;
  try {
    fs.mkdirSync(cache.directory, { recursive: true });
    staging = fs.mkdtempSync(path.join(cache.directory, ".incoming-"));
    const archive = path.join(staging, manifest.filename);
    const localArchive = process.env[LOCAL_ARCHIVE_ENV]?.trim();
    cache.onProgress("Downloading the required packages…");
    if (localArchive) {
      // Verified as a copy: a mismatching file is deleted, and the original is not Studio's.
      await fs.promises.copyFile(localArchive, archive);
    } else {
      await downloadFile(manifest.url, archive, (percent) => {
        cache.onProgress(`Downloading the required packages… ${percent}%`);
      });
    }
    await verifySha256(archive, manifest.sha256);
    const extracted = path.join(staging, "extracted");
    fs.mkdirSync(extracted);
    await extractTarball(archive, extracted);
    if (!fs.existsSync(path.join(extracted, "wheels"))) throw new Error("The archive has no wheels/ directory.");
    const target = path.dirname(wheelsDirectory(manifest, cache.directory));
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(extracted, target);
  } catch (error) {
    appendInstallLog(`Required packages archive: ${error instanceof Error ? error.message : String(error)}`);
    // Never continue with the package index alone: where the wheels are not
    // embedded, some required packages are not published there.
    throw new Error("Studio could not download its required packages. Check the internet connection and try again.", { cause: error });
  } finally {
    if (staging) fs.rmSync(staging, { recursive: true, force: true });
  }

  for (const entry of fs.readdirSync(cache.directory)) {
    if (entry !== manifest.sha256) fs.rmSync(path.join(cache.directory, entry), { recursive: true, force: true });
  }
  return wheelsDirectory(manifest, cache.directory);
}
