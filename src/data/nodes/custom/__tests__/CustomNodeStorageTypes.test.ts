import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWED_PACKAGES,
  SOURCE_PRIORITY,
} from "../CustomNodeStorageTypes";
import {
  DEFAULT_ALLOWED_PACKAGES as REEXPORTED_DEFAULT_ALLOWED_PACKAGES,
  SOURCE_PRIORITY as REEXPORTED_SOURCE_PRIORITY,
} from "../CustomNodeStorage";

describe("CustomNodeStorageTypes", () => {
  it("exposes the default allowed package allowlist", () => {
    expect(DEFAULT_ALLOWED_PACKAGES).toEqual([
      "nirs4all",
      "sklearn",
      "scipy",
      "numpy",
      "pandas",
    ]);
  });

  it("orders source priority admin > workspace > local", () => {
    expect(SOURCE_PRIORITY.admin).toBeGreaterThan(SOURCE_PRIORITY.workspace);
    expect(SOURCE_PRIORITY.workspace).toBeGreaterThan(SOURCE_PRIORITY.local);
  });

  it("is re-exported identically from CustomNodeStorage (public surface unchanged)", () => {
    expect(REEXPORTED_DEFAULT_ALLOWED_PACKAGES).toBe(DEFAULT_ALLOWED_PACKAGES);
    expect(REEXPORTED_SOURCE_PRIORITY).toBe(SOURCE_PRIORITY);
  });
});
