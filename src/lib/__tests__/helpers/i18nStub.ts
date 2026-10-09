import type { TFunction } from "i18next";

/**
 * Deterministic `t` stand-in for unit tests: returns the key, followed by the
 * JSON-encoded interpolation options when there are any.
 */
export const tStub = ((key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;
