import { describe, expect, it } from "vitest";

import { tEn } from "./support/enTranslator";

import {
  clampRunProgress,
  formatElapsedClock,
  formatRunProgress,
  formatRunTokenLabel,
  getElapsedSeconds,
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
    expect(formatRunTokenLabel("local-python", tEn)).toBe("Local Python");
    expect(formatRunTokenLabel("result_repository", tEn)).toBe("Result repository");
    expect(formatRunTokenLabel("wasm-local", tEn)).toBe("WASM local");
    expect(formatRunTokenLabel("gpu-grid", tEn)).toBe("Gpu grid");
    expect(formatRunTokenLabel("", tEn)).toBe("");
  });

  it("formats elapsed seconds as mm:ss, or h:mm:ss from one hour", () => {
    expect(formatElapsedClock(0)).toBe("00:00");
    expect(formatElapsedClock(65)).toBe("01:05");
    expect(formatElapsedClock(3599)).toBe("59:59");
    expect(formatElapsedClock(3600)).toBe("1:00:00");
    expect(formatElapsedClock(37_325)).toBe("10:22:05");
    expect(formatElapsedClock(-4)).toBe("00:00");
  });

  it("derives elapsed whole seconds from an ISO start timestamp", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(getElapsedSeconds("2026-10-09T11:58:55.500Z", now)).toBe(64);
    expect(getElapsedSeconds("2026-10-09T12:00:05Z", now)).toBe(0);
    expect(getElapsedSeconds(undefined, now)).toBeNull();
    expect(getElapsedSeconds("not a date", now)).toBeNull();
  });
});
