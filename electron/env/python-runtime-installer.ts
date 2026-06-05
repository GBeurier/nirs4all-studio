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

/** Download a file with redirect support and progress reporting */
export function downloadFile(url: string, destPath: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl: string) => {
      const protocol = requestUrl.startsWith("https") ? https : http;
      protocol.get(requestUrl, (response) => {
        // Follow redirects (GitHub returns 302)
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return makeRequest(response.headers.location);
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const totalBytes = parseInt(response.headers["content-length"] || "0", 10);
        let receivedBytes = 0;
        let lastReportedPercent = -1;

        const file = fs.createWriteStream(destPath);
        response.pipe(file);

        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (totalBytes > 0 && onProgress) {
            const percent = Math.floor((receivedBytes / totalBytes) * 100);
            if (percent > lastReportedPercent) {
              lastReportedPercent = percent;
              onProgress(percent);
            }
          }
        });

        file.on("finish", () => {
          file.close();
          resolve();
        });

        file.on("error", (err) => {
          try { fs.unlinkSync(destPath); } catch { /* ignore */ }
          reject(err);
        });
      }).on("error", reject);
    };

    makeRequest(url);
  });
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
