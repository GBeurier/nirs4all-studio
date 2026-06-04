/**
 * DEV-gated console logger.
 *
 * `log` / `debug` / `info` / `warn` forward to the matching `console` method
 * only when `import.meta.env.DEV` is true, so they are no-ops in production
 * builds and keep the console quiet for end users. `error` always forwards to
 * `console.error` so real failures still surface in production.
 */
type LogFn = (...args: unknown[]) => void;

const noop: LogFn = () => {};

const isDev = import.meta.env.DEV;

export const logger: {
  log: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
} = {
  log: isDev ? (...args) => console.log(...args) : noop,
  debug: isDev ? (...args) => console.debug(...args) : noop,
  info: isDev ? (...args) => console.info(...args) : noop,
  warn: isDev ? (...args) => console.warn(...args) : noop,
  error: (...args) => console.error(...args),
};
