/**
 * Low-level process helpers shared by the Python env discovery and installer
 * modules. These are intentionally free functions with no dependency on
 * EnvManager state — they only spawn/exec commands and manage filesystem
 * retries.
 */

import { spawn, execFile } from "node:child_process";
import fs from "node:fs";

const isWindows = process.platform === "win32";

export interface CommandOptions {
  retries?: number;
  /** Base delay (ms) for exponential backoff between retries. Default 2000. */
  retryBaseMs?: number;
  timeoutMs?: number;
}

/**
 * Run `command` to completion, capturing stdout/stderr but resolving to the
 * combined text only on success. Resolves `null` on any error (non-zero exit,
 * spawn failure, or timeout) so callers can treat discovery probes as
 * best-effort.
 */
export function execFileText(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: isWindows },
      (error, stdout, stderr) => {
        if (error) {
          resolve(null);
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

/** Run a command and wait for it to complete */
export function runCommand(command: string, args: string[], options?: CommandOptions): Promise<void> {
  const maxRetries = options?.retries ?? 0;
  const timeoutMs = options?.timeoutMs ?? 0;
  const commandLabel = `${command} ${args.join(" ")}`.trim();

  const exec = (): Promise<void> => new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: isWindows,
    });

    let stderr = "";
    let finished = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const complete = (error?: Error) => {
      if (finished) return;
      finished = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (error) reject(error);
      else resolve();
    };

    proc.stderr?.on("data", (data: Buffer) => { stderr += data.toString(); });

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        const timeoutError = new Error(
          `Command "${commandLabel}" timed out after ${Math.round(timeoutMs / 1000)}s`,
        );
        if (isWindows && proc.pid) {
          spawn("taskkill", ["/pid", proc.pid.toString(), "/t", "/f"]);
        } else {
          proc.kill("SIGKILL");
        }
        complete(timeoutError);
      }, timeoutMs);
    }

    proc.on("close", (code) => {
      if (finished) return;
      if (code === 0) complete();
      else complete(new Error(`Command "${commandLabel}" failed (code ${code}): ${stderr.slice(0, 500)}`));
    });

    proc.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`Failed to start command "${commandLabel}": ${message}`);
      if (error && typeof error === "object" && "code" in error) {
        Object.assign(wrapped, { code: (error as NodeJS.ErrnoException).code });
      }
      complete(wrapped);
    });
  });

  if (maxRetries <= 0) return exec();

  return (async () => {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          // Exponential backoff — gives antivirus time to release file locks.
          // Default base 2 s (2, 4, 8 s).  Callers can raise the base for
          // operations where AV scanning is expected to take longer.
          const baseMs = options?.retryBaseMs ?? 2000;
          await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, attempt - 1)));
        }
        await exec();
        return;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries) {
          console.warn(`[EnvManager] Command "${commandLabel}" failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying: ${lastError.message}`);
        }
      }
    }
    // Annotate EPERM errors with a likely cause on Windows
    if (isWindows && lastError && "code" in lastError && (lastError as NodeJS.ErrnoException).code === "EPERM") {
      lastError.message += " — this is usually caused by antivirus software blocking newly extracted files. "
        + "Try temporarily adding the install directory to your antivirus exclusions and retrying.";
    }
    throw lastError;
  })();
}

/**
 * Remove a directory with retry + exponential backoff.
 *
 * On Windows, antivirus (Defender) can temporarily lock freshly extracted
 * files for 10–30 s.  A bare `fs.rmSync` fails instantly with EPERM/EBUSY.
 * This wrapper retries with increasing delays so the AV scan has time to
 * finish before we give up.
 */
export async function rmWithRetry(dirPath: string, retries = 5, baseDelayMs = 2000): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const retryable = code === "EPERM" || code === "EBUSY" || code === "EACCES";

      if (!retryable || attempt === retries) {
        // Annotate the final error with a likely cause on Windows
        if (isWindows && err instanceof Error && retryable) {
          err.message += " — this is usually caused by antivirus software locking newly extracted files. "
            + "Try temporarily adding the install directory to your antivirus exclusions and retrying.";
        }
        throw err;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[EnvManager] rmSync "${dirPath}" failed (attempt ${attempt + 1}/${retries + 1}, ${code}), retrying in ${delayMs / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
