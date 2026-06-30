import { describe, expect, it } from "vitest";

import { parseJsonRecord, parseScoreNumber } from "@/ui/score/scoreValues";

describe("scoreValues", () => {
  it("parses finite score numbers from numbers and numeric strings", () => {
    expect(parseScoreNumber(0.42)).toBe(0.42);
    expect(parseScoreNumber("0.42")).toBe(0.42);
    expect(parseScoreNumber(Number.NaN)).toBeNull();
    expect(parseScoreNumber("n/a")).toBeNull();
    expect(parseScoreNumber(null)).toBeNull();
  });

  it("parses JSON object records and rejects arrays or invalid strings", () => {
    const record = { rmse: 0.2 };
    expect(parseJsonRecord(record)).toBe(record);
    expect(parseJsonRecord('{"rmse":0.2}')).toEqual({ rmse: 0.2 });
    expect(parseJsonRecord("[1,2,3]")).toBeNull();
    expect(parseJsonRecord([1, 2, 3])).toBeNull();
    expect(parseJsonRecord("not-json")).toBeNull();
    expect(parseJsonRecord(null)).toBeNull();
  });
});
