/**
 * Persistent file logger for Electron main process.
 *
 * Writes all console output to rotating log files in {userData}/logs/.
 * Log files are named nirs4all-YYYY-MM-DD.log and old files are pruned
 * to keep disk usage under control.
 */

import fs from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-require-imports */
const electron = require("electron") as typeof import("electron");
const { app } = electron;

const MAX_LOG_FILES = 7;
let logStream: fs.WriteStream | null = null;
let logFilePath: string | null = null;
let logDir: string | null = null;

function getTimestamp(): string {
  return new Date().toISOString();
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => {
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    if (typeof a === "object" && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(" ");
}

function writeToLog(level: string, args: unknown[]): void {
  if (!logStream) return;
  const line = `${getTimestamp()} [${level}] ${formatArgs(args)}\n`;
  logStream.write(line);
}

function pruneOldLogs(): void {
  if (!logDir) return;
  try {
    const files = fs.readdirSync(logDir)
      .filter((f) => f.startsWith("nirs4all-") && f.endsWith(".log"))
      .sort()
      .reverse();
    for (const file of files.slice(MAX_LOG_FILES)) {
      try { fs.unlinkSync(path.join(logDir, file)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/**
 * Initialize the file logger. Patches console.log/warn/error to also write to disk.
 * Must be called after app is ready (or at least after userData is accessible).
 */
export function initLogger(): void {
  logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  logFilePath = path.join(logDir, `nirs4all-${date}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: "a" });

  writeToLog("INFO", [`--- nirs4all Studio started (v${app.getVersion()}, ${process.platform}-${process.arch}) ---`]);

  // Patch console methods to also write to the log file
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => { origLog(...args); writeToLog("INFO", args); };
  console.warn = (...args: unknown[]) => { origWarn(...args); writeToLog("WARN", args); };
  console.error = (...args: unknown[]) => { origError(...args); writeToLog("ERROR", args); };

  // Capture uncaught exceptions and unhandled rejections
  process.on("uncaughtException", (error) => {
    writeToLog("FATAL", ["Uncaught exception:", error]);
    origError("Uncaught exception:", error);
  });

  process.on("unhandledRejection", (reason) => {
    writeToLog("FATAL", ["Unhandled rejection:", reason]);
    origError("Unhandled rejection:", reason);
  });

  pruneOldLogs();
}

/** Get the current log file path (for showing to the user or copying). */
export function getLogFilePath(): string | null {
  return logFilePath;
}

/** Get the log directory path. */
export function getLogDir(): string | null {
  return logDir;
}
