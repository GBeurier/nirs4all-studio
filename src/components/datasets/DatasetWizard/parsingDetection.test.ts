import { describe, expect, it } from "vitest";
import { detectDelimiterFromContent } from "./parsingDetection";

describe("detectDelimiterFromContent", () => {
  it("falls back to semicolon with dot decimals for empty content", () => {
    expect(detectDelimiterFromContent("\n\n")).toEqual({
      delimiter: ";",
      decimal: ".",
    });
  });

  it("detects semicolon-delimited files with comma decimals", () => {
    expect(detectDelimiterFromContent("wl;sample_a;sample_b\n900;1,23;4,56\n901;1,24;4,57")).toEqual({
      delimiter: ";",
      decimal: ",",
    });
  });

  it("detects comma-delimited files with dot decimals", () => {
    expect(detectDelimiterFromContent("wl,sample_a,sample_b\n900,1.23,4.56\n901,1.24,4.57")).toEqual({
      delimiter: ",",
      decimal: ".",
    });
  });

  it("detects tab-delimited files", () => {
    expect(detectDelimiterFromContent("wl\tsample_a\tsample_b\n900\t1.23\t4.56\n901\t1.24\t4.57")).toEqual({
      delimiter: "\t",
      decimal: ".",
    });
  });
});
