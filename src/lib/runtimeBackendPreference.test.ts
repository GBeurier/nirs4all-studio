/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  RETIRED_RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY,
  STRICT_NATIVE_RUNTIME_ENGINE,
  migrateRetiredRuntimeBackendPreference,
} from "./runtimeBackendPreference";

afterEach(() => {
  window.localStorage.clear();
});

describe("strict native runtime backend", () => {
  it("exposes one immutable native engine", () => {
    expect(STRICT_NATIVE_RUNTIME_ENGINE).toBe("dag-ml");
  });

  it.each([
    { engine: "legacy", allowFallback: true },
    { engine: "dag-ml", allowFallback: true },
    "{invalid-json",
  ])("removes a retired preference without interpreting it", (retiredValue) => {
    window.localStorage.setItem(
      RETIRED_RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY,
      typeof retiredValue === "string" ? retiredValue : JSON.stringify(retiredValue),
    );

    migrateRetiredRuntimeBackendPreference();

    expect(
      window.localStorage.getItem(RETIRED_RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY),
    ).toBeNull();
  });
});
