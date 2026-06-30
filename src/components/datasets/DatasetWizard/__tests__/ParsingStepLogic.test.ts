import { describe, expect, it } from "vitest";
import type { ParsingDetectionDefaults } from "../ParsingStepLogic";
import {
  toAutoDetectedParsingOptions,
  toClientDetectedParsingOptions,
  toLegacyDetectedParsingOptions,
} from "../ParsingStepLogic";

const defaults: ParsingDetectionDefaults = {
  delimiter: ";",
  decimal_separator: ".",
  has_header: true,
  header_unit: "cm-1",
  signal_type: "auto",
};

describe("ParsingStep detection option mapping", () => {
  it("maps client-side delimiter detection to parsing options", () => {
    expect(toClientDetectedParsingOptions({ delimiter: "\t", decimal: "," })).toEqual({
      delimiter: "\t",
      decimal_separator: ",",
    });
  });

  it("maps full auto-detection results while preserving explicit false booleans", () => {
    expect(
      toAutoDetectedParsingOptions(
        {
          delimiter: ",",
          decimal_separator: ".",
          has_header: false,
          header_unit: "nm",
          signal_type: "reflectance",
          encoding: "latin-1",
        },
        defaults
      )
    ).toEqual({
      delimiter: ",",
      decimal_separator: ".",
      has_header: false,
      header_unit: "nm",
      signal_type: "reflectance",
      encoding: "latin-1",
    });
  });

  it("fills missing auto-detection fields from defaults", () => {
    expect(
      toAutoDetectedParsingOptions(
        {
          delimiter: "",
          decimal_separator: null,
          has_header: null,
          header_unit: "",
          signal_type: undefined,
          encoding: "",
        },
        defaults
      )
    ).toEqual({
      delimiter: ";",
      decimal_separator: ".",
      has_header: true,
      header_unit: "cm-1",
      signal_type: "auto",
      encoding: "utf-8",
    });
  });

  it("maps legacy format detection fallback results", () => {
    expect(
      toLegacyDetectedParsingOptions(
        {
          detected_delimiter: "|",
          detected_decimal: ",",
          has_header: false,
        },
        defaults
      )
    ).toEqual({
      delimiter: "|",
      decimal_separator: ",",
      has_header: false,
    });
  });

  it("fills missing legacy fallback fields from defaults", () => {
    expect(toLegacyDetectedParsingOptions({}, defaults)).toEqual({
      delimiter: ";",
      decimal_separator: ".",
      has_header: true,
    });
  });
});
