/**
 * Stateless installer primitives for provisioning the managed Python runtime:
 * downloading the python-build-standalone archive, extracting it, and clearing
 * the macOS Gatekeeper quarantine attribute.
 *
 * These are free functions with no dependency on EnvManager state. The
 * stateful orchestration (status transitions, venv creation, package install,
 * settings persistence) stays on EnvManager.setup(), which composes these.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

import { runCommand } from "./process-utils";

const isWindows = process.platform === "win32";

/**
 * Remove macOS Gatekeeper quarantine attribute from downloaded Python.
 * python-build-standalone binaries downloaded from GitHub are marked with
 * com.apple.quarantine which can block execution. Non-fatal if removal fails.
 */
export function removeQuarantine(dirPath: string): Promise<void> {
  if (process.platform !== "darwin") return Promise.resolve();
  return new Promise((resolve) => {
    execFile("xattr", ["-dr", "com.apple.quarantine", dirPath], (error) => {
      if (error) {
        console.warn(`[EnvManager] Could not remove quarantine attribute: ${error.message}`);
      } else {
        console.log(`[EnvManager] Removed quarantine attribute from ${dirPath}`);
      }
      resolve();
    });
  });
}

export interface DownloadOptions {
  timeoutMs?: number;
  maxDurationMs?: number;
  retries?: number;
  retryDelayMs?: number;
  maxRedirects?: number;
}

/** Publish only a complete download; interrupted attempts never poison the cache. */
export async function downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void, options: DownloadOptions = {}): Promise<void> {
  const { timeoutMs = 30_000, maxDurationMs = 15 * 60_000, retries = 2, retryDelayMs = 250, maxRedirects = 5 } = options;
  for (let attempt = 0; ; attempt += 1) {
    const partial = `${destPath}.${randomUUID()}.partial`;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(new Error("Download exceeded its time limit")), maxDurationMs);
    let response: http.IncomingMessage | undefined;
    try {
      let currentUrl = new URL(url);
      for (let redirects = 0; ; redirects += 1) {
        if (!["http:", "https:"].includes(currentUrl.protocol)) throw new Error("Unsupported download URL protocol");
        const protocol = currentUrl.protocol === "https:" ? https : http;
        response = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const request = protocol.get(currentUrl, { signal: controller.signal }, resolve);
          request.setTimeout(timeoutMs, () => request.destroy(new Error("Download timed out waiting for data")));
          request.once("error", reject);
        });
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const location = response.headers.location;
          response.destroy();
          if (redirects >= maxRedirects) throw new Error("Too many download redirects");
          currentUrl = new URL(location, currentUrl);
          continue;
        }
        break;
      }
      if (response.statusCode !== 200) throw new Error(`Download failed with status ${response.statusCode}`);
      const length = response.headers["content-length"];
      const totalBytes = length === undefined ? null : Number(length);
      let receivedBytes = 0;
      let lastReportedPercent = -1;
      response.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (totalBytes && onProgress) {
          const percent = Math.min(100, Math.floor(receivedBytes / totalBytes * 100));
          if (percent > lastReportedPercent) {
            lastReportedPercent = percent;
            try { onProgress(percent); } catch (error) { controller.abort(error); }
          }
        }
      });
      await pipeline(response, fs.createWriteStream(partial, { flags: "wx" }), { signal: controller.signal });
      if (totalBytes !== null && receivedBytes !== totalBytes) throw new Error("Incomplete download: response size does not match Content-Length");
      await fs.promises.rename(partial, destPath);
      return;
    } catch (error) {
      response?.destroy();
      await fs.promises.rm(partial, { force: true });
      if (attempt >= retries) throw error;
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
    await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
  }
}

/** Check if the system tar is GNU tar (vs Windows built-in bsdtar) */
function isGnuTar(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("tar", ["--version"], { windowsHide: isWindows }, (err, stdout) => {
      resolve(!err && stdout.includes("GNU tar"));
    });
  });
}

/** Extract a .tar.gz file */
export async function extractTarball(tarPath: string, destDir: string): Promise<void> {
  const archive = isWindows ? tarPath.replace(/\\/g, "/") : tarPath;
  const dest = isWindows ? destDir.replace(/\\/g, "/") : destDir;
  const args = ["-xzf", archive, "-C", dest];
  // GNU tar (from Git) interprets drive letters as remote hosts and needs --force-local.
  // Windows built-in bsdtar doesn't support --force-local but handles paths natively.
  if (isWindows && await isGnuTar()) args.push("--force-local");

  return runCommand("tar", args, {
    retries: 1,
  });
}
