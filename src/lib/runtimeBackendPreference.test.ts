/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RUNTIME_BACKEND_PREFERENCE,
  RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY,
  clearRuntimeBackendPreference,
  getRuntimeBackendPreference,
  normalizeRuntimeBackendPreference,
  setRuntimeBackendPreference,
} from "./runtimeBackendPreference";

afterEach(() => {
  window.localStorage.clear();
});

describe("runtime backend preference", () => {
  it("defaults to native DAG-ML with fallback disabled", () => {
    expect(getRuntimeBackendPreference()).toEqual(
      DEFAULT_RUNTIME_BACKEND_PREFERENCE,
    );
  });

  it("persists a dag-ml preference with fallback enabled", () => {
    const saved = setRuntimeBackendPreference({
      engine: "dag-ml",
      allowFallback: true,
    });

    expect(saved).toEqual({ engine: "dag-ml", allowFallback: true });
    expect(getRuntimeBackendPreference()).toEqual({
      engine: "dag-ml",
      allowFallback: true,
    });
  });

  it("drops fallback outside dag-ml", () => {
    expect(
      normalizeRuntimeBackendPreference({
        engine: "legacy",
        allowFallback: true,
      }),
    ).toEqual({ engine: "legacy", allowFallback: false });

    expect(
      setRuntimeBackendPreference({
        engine: null,
        allowFallback: true,
      }),
    ).toEqual({ engine: null, allowFallback: false });
  });

  it("ignores corrupted storage and can clear the preference", () => {
    window.localStorage.setItem(
      RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY,
      "{invalid-json",
    );
    expect(getRuntimeBackendPreference()).toEqual(
      DEFAULT_RUNTIME_BACKEND_PREFERENCE,
    );

    setRuntimeBackendPreference({ engine: "legacy", allowFallback: false });
    clearRuntimeBackendPreference();
    expect(window.localStorage.getItem(RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY)).toBeNull();
    expect(getRuntimeBackendPreference()).toEqual(
      DEFAULT_RUNTIME_BACKEND_PREFERENCE,
    );
  });
});
