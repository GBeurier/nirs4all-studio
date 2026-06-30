import { describe, expect, it } from "vitest";
import { formatParamValue } from "./ChainDetailPipelineIdentityFormatting";

describe("formatParamValue", () => {
  it("formats missing and primitive parameter values", () => {
    expect(formatParamValue(null)).toBe("-");
    expect(formatParamValue(undefined)).toBe("-");
    expect(formatParamValue("SNV")).toBe("SNV");
    expect(formatParamValue(true)).toBe("true");
    expect(formatParamValue(false)).toBe("false");
  });

  it("formats numeric parameter values using the existing compact rules", () => {
    expect(formatParamValue(4)).toBe("4");
    expect(formatParamValue(0.125)).toBe("0.125");
    expect(formatParamValue(0.00012)).toBe("1.20e-4");
    expect(formatParamValue(10000)).toBe("1.00e+4");
    expect(formatParamValue(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });

  it("serializes object-like values and falls back when JSON cannot handle them", () => {
    expect(formatParamValue({ alpha: 0.1 })).toBe("{\"alpha\":0.1}");
    expect(formatParamValue(BigInt(12))).toBe("12");
  });
});
