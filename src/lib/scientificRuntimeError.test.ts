/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { scientificRuntimeErrorMessage } from "./scientificRuntimeError";

describe("scientific runtime error messages", () => {
  it("explains incompatible versions without claiming package tampering", () => {
    const message = scientificRuntimeErrorMessage("scientific_distribution_version_unsupported");
    expect(message).toContain("unsupported nirs4all version");
    expect(message).toContain("Settings");
    expect(message).toContain("1.4.8");
    expect(message).not.toContain("integrity");
  });

  it("keeps integrity failures distinct and preserves other errors", () => {
    expect(scientificRuntimeErrorMessage("scientific_distribution_tampered")).toContain("integrity check");
    expect(scientificRuntimeErrorMessage("Reader failed")).toBe("Reader failed");
    expect(scientificRuntimeErrorMessage(null)).toBeNull();
  });
});
