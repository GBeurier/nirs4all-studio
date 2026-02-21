/**
 * Centralized logging for nirs4all webapp frontend.
 *
 * Replaces scattered console.* calls with a structured, level-aware logger
 * that respects development/production mode.
 *
 * Usage:
 *   import { createLogger } from "@/lib/logger";
 *
 *   const logger = createLogger("ModuleName");
 *   logger.info("Loaded %d samples", count);
 *   logger.warn("Feature not available:", reason);
 *   logger.error("Failed to fetch:", err);
 *   logger.debug("Render took %dms", elapsed);  // suppressed in production
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = import.meta.env.DEV ? "debug" : "warn";

/** Change the minimum log level at runtime. */
export function setLogLevel(level: LogLevel) {
  currentLevel = level;
}

/** Return the current minimum log level. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Create a named logger instance.
 *
 * Messages below the current log level are suppressed.
 * Errors are always emitted regardless of level.
 */
export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;

  return {
    debug(...args: unknown[]) {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.debug)
        console.debug(prefix, ...args);
    },
    info(...args: unknown[]) {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.info)
        console.log(prefix, ...args);
    },
    warn(...args: unknown[]) {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.warn)
        console.warn(prefix, ...args);
    },
    error(...args: unknown[]) {
      // Errors are always shown
      console.error(prefix, ...args);
    },
  };
}
