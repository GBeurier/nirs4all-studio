import { describe, expect, it } from "vitest";

import {
  clampRunProgress,
  formatRunProgress,
  formatRunTokenLabel,
} from "../runs/format";

describe("runs format helpers", () => {
  it("formats progress as clamped rounded percentages", () => {
    expect(formatRunProgress(-5)).toBe("0%");
    expect(formatRunProgress(150)).toBe("100%");
    expect(formatRunProgress(42.6)).toBe("43%");
  });

  it("clamps numeric progress for run read models", () => {
    expect(clampRunProgress(-5)).toBe(0);
    expect(clampRunProgress(150)).toBe(100);
    expect(clampRunProgress(12.5)).toBe(12.5);
  });

  it("formats known run tokens and future fallback values", () => {
    expect(formatRunTokenLabel("local-python")).toBe("Local Python");
    expect(formatRunTokenLabel("result_repository")).toBe("Result repository");
    expect(formatRunTokenLabel("wasm-local")).toBe("WASM local");
    expect(formatRunTokenLabel("gpu-grid")).toBe("Gpu grid");
    expect(formatRunTokenLabel("")).toBe("");
  });
});
