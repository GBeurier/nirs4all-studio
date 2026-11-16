/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import "@/lib/i18n";
import { scientificRuntimeErrorMessage } from "./scientificRuntimeError";

describe("scientific runtime error messages", () => {
  it("explains an unsupported nirs4all version and points to the Python settings", () => {
    const message = scientificRuntimeErrorMessage("scientific_distribution_version_unsupported");
    expect(message).toContain("unsupported nirs4all version");
    expect(message).toContain("Settings → Python");
    expect(message).not.toMatch(/nirs4all \d+\.\d+/);
  });

  it.each([
    ["scientific_distribution_missing", "nirs4all is not installed"],
    ["scientific_library_import_failed", "nirs4all could not be loaded"],
    ["studio_adapters_unavailable", "Studio could not load its Python components"],
  ])("explains %s in plain words and points to the Python settings", (code, text) => {
    const message = scientificRuntimeErrorMessage(code);
    expect(message).toContain(text);
    expect(message).toContain("Settings → Python");
    expect(message).not.toContain(code);
  });

  it("preserves other errors", () => {
    expect(scientificRuntimeErrorMessage("Reader failed")).toBe("Reader failed");
    expect(scientificRuntimeErrorMessage("scientific_callable_unavailable")).toBe("scientific_callable_unavailable");
    expect(scientificRuntimeErrorMessage("")).toBe("");
    expect(scientificRuntimeErrorMessage(null)).toBeNull();
  });
});
