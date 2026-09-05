import { describe, expect, it } from "vitest";

import type {
  ArchiveV2ArrayPredictionResponse,
  ArchiveV2ConformalPresentation,
} from "@/types/archiveV2Prediction";

import { buildArchiveV2PredictionCsv } from "./archiveV2PredictionCsv";

const result: ArchiveV2ArrayPredictionResponse = {
  schema_version: 1,
  operation: "archive_v2_predict",
  archive_id: "archive:test",
  archive_sha256: "a".repeat(64),
  engine: "core_rust_methods",
  fallback_used: false,
  sample_ids: ["sample,one", "sample-two"],
  target_names: ["protein", "moisture"],
  values: [[1.5, 12], [2.5, 14]],
  provenance: {
    executor: `nirs4all-core@0.3.30+libn4m-abi-2.5:${"b".repeat(64)}`,
    archive_ref: "models/test.n4a",
    workspace_id: "workspace:test",
  },
};

const conformal = {
  sample_ids: result.sample_ids,
  target_names: result.target_names,
  interval_block: {
    sample_ids: result.sample_ids,
    intervals: [
      {
        coverage: 0.8,
        cells: [
          [{ status: "finite", lower: 1, upper: 2 }, { status: "unbounded" }],
          [{ status: "finite", lower: 2, upper: 3 }, { status: "finite", lower: 13, upper: 15 }],
        ],
      },
      {
        coverage: 0.95,
        cells: [
          [{ status: "finite", lower: 0.5, upper: 2.5 }, { status: "finite", lower: 10, upper: 14 }],
          [{ status: "unbounded" }, { status: "finite", lower: 12, upper: 16 }],
        ],
      },
    ],
  },
} as unknown as ArchiveV2ConformalPresentation;

describe("Archive V2 prediction CSV", () => {
  it("exports exact sample IDs, multi-target points, coverage and finite bounds", () => {
    const csv = buildArchiveV2PredictionCsv(result, conformal);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "sample_id,coverage,target,point_prediction,lower,upper,interval_status",
    );
    expect(lines).toHaveLength(9);
    expect(lines).toContain('"sample,one",0.8,protein,1.5,1,2,finite');
    expect(lines).toContain("sample-two,0.95,moisture,14,12,16,finite");
  });

  it("keeps unbounded intervals explicit without fabricated numeric bounds", () => {
    const lines = buildArchiveV2PredictionCsv(result, conformal).split("\n");

    expect(lines).toContain('"sample,one",0.8,moisture,12,,,unbounded');
    expect(lines).toContain("sample-two,0.95,protein,2.5,,,unbounded");
  });

  it("neutralizes spreadsheet formulas in identities without changing negative numbers", () => {
    const hostile: ArchiveV2ArrayPredictionResponse = {
      ...result,
      sample_ids: ["-A1", "=SUM(1,2)"],
      target_names: ["-A2", '@say "hello"'],
      values: [[-1.5, -12], [-2.5, -14]],
    };

    const lines = buildArchiveV2PredictionCsv(hostile, null).split("\n");
    expect(lines).toContain("'-A1,,'-A2,-1.5,,,");
    expect(lines).toContain(`'-A1,,"'@say ""hello""",-12,,,`);
    expect(lines).toContain(`"'=SUM(1,2)",,'-A2,-2.5,,,`);
    expect(lines.some((line) => line.includes(",-1.5,"))).toBe(true);
  });

  it("exports point predictions when no conformal presentation is available", () => {
    expect(buildArchiveV2PredictionCsv(result, null).split("\n")).toContain(
      '"sample,one",,protein,1.5,,,',
    );
  });

  it("refuses reordered conformal sample identities", () => {
    const reordered = {
      ...conformal,
      sample_ids: [...conformal.sample_ids].reverse(),
    } as ArchiveV2ConformalPresentation;

    expect(() => buildArchiveV2PredictionCsv(result, reordered)).toThrow(
      "not exactly aligned",
    );
  });
});
