import { describe, expect, it } from "vitest";

import {
  getConfusionFillColor,
  getContrastTextColor,
  getPartitionColor,
  getPartitionPaletteColors,
  normalizeColorToHex,
} from "../palettes";

describe("prediction viewer palettes", () => {
  it("uses Playground default categorical colors for train, validation, and test", () => {
    expect(getPartitionPaletteColors("default")).toEqual({
      train: "#17cfb9",
      val: "#266bd9",
      test: "#1cca5b",
    });
  });

  it("resolves validation aliases and unknown partition fallbacks", () => {
    const colors = {
      train: "#111111",
      val: "#222222",
      test: "#333333",
    };

    expect(getPartitionColor("validation", "custom", colors)).toBe("#222222");
    expect(getPartitionColor("holdout", "custom", colors)).toBe("#64748b");
  });

  it("normalizes supported color strings to six-digit hex", () => {
    expect(normalizeColorToHex("#abc")).toBe("#aabbcc");
    expect(normalizeColorToHex("hsl(173, 80%, 45%)")).toBe("#17cfb9");
  });

  it("interpolates confusion gradients from the editable endpoints", () => {
    expect(getConfusionFillColor(0.5, { low: "#000000", high: "#ffffff" })).toBe("#808080");
  });

  it("picks readable text colors based on the actual fill", () => {
    expect(getContrastTextColor("#ffffff")).toBe("#0f172a");
    expect(getContrastTextColor("#1d4ed8")).toBe("#ffffff");
  });
});