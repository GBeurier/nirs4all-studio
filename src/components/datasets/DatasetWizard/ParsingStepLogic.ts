import type { ParsingOptions } from "@/types/datasets";

export type ParsingDetectionDefaults = Pick<
  ParsingOptions,
  "delimiter" | "decimal_separator" | "has_header" | "header_unit" | "signal_type"
>;

export interface ClientDelimiterDetection {
  delimiter: string;
  decimal: string;
}

export interface AutoDetectParsingResult {
  delimiter?: string | null;
  decimal_separator?: string | null;
  has_header?: boolean | null;
  header_unit?: string | null;
  signal_type?: string | null;
  encoding?: string | null;
}

export interface LegacyFormatDetectionResult {
  detected_delimiter?: string | null;
  detected_decimal?: string | null;
  has_header?: boolean | null;
}

const DEFAULT_ENCODING = "utf-8";

export function toClientDetectedParsingOptions(
  detected: ClientDelimiterDetection
): Partial<ParsingOptions> {
  return {
    delimiter: detected.delimiter,
    decimal_separator: detected.decimal,
  };
}

export function toAutoDetectedParsingOptions(
  result: AutoDetectParsingResult,
  defaults: ParsingDetectionDefaults
): Partial<ParsingOptions> {
  return {
    delimiter: result.delimiter || defaults.delimiter,
    decimal_separator: result.decimal_separator || defaults.decimal_separator,
    has_header: result.has_header ?? defaults.has_header,
    header_unit: (result.header_unit || defaults.header_unit) as ParsingOptions["header_unit"],
    signal_type: (result.signal_type || defaults.signal_type) as ParsingOptions["signal_type"],
    encoding: result.encoding || DEFAULT_ENCODING,
  };
}

export function toLegacyDetectedParsingOptions(
  result: LegacyFormatDetectionResult,
  defaults: ParsingDetectionDefaults
): Partial<ParsingOptions> {
  return {
    delimiter: result.detected_delimiter || defaults.delimiter,
    decimal_separator: result.detected_decimal || defaults.decimal_separator,
    has_header: result.has_header ?? defaults.has_header,
  };
}

/** Options shared by inspection, preview and persistence. */
export function effectiveFileParsing(
  role: string,
  global: Partial<ParsingOptions>,
  overrides: Partial<ParsingOptions> = {},
): Partial<ParsingOptions> {
  const effective = { ...global, ...overrides };
  if (role === "metadata" && (!effective.na_policy || effective.na_policy === "auto")) {
    effective.na_policy = "ignore";
  }
  return effective;
}
