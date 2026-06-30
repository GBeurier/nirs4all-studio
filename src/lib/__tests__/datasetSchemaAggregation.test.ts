import { describe, expect, it } from "vitest";

import {
  buildDatasetAggregationRef,
  formatDatasetAggregationLabel,
  formatDatasetAggregationSourceLabel,
  formatDatasetAggregationTitleLabel,
  getDatasetAggregationReadiness,
} from "../datasetSchemaAggregation";

describe("datasetSchemaAggregation", () => {
  it("builds aggregation refs from enabled dataset config", () => {
    const aggregation = buildDatasetAggregationRef({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        aggregation: {
          enabled: true,
          column: " sample_id ",
          method: "median",
        },
      },
    });

    expect(aggregation).toEqual({
      enabled: true,
      column: "sample_id",
      method: "median",
      source: "config",
    });
    expect(formatDatasetAggregationLabel(aggregation)).toBe("aggregation: median by sample_id");
    expect(formatDatasetAggregationSourceLabel(aggregation)).toBe("aggregation source: dataset config");
    expect(formatDatasetAggregationTitleLabel(aggregation)).toBe("Aggregation: median by sample_id");
    expect(getDatasetAggregationReadiness(aggregation)).toEqual({
      status: "ready",
      label: "Aggregation ready",
      message: "Aggregation uses median by \"sample_id\" from dataset config.",
    });
  });

  it("supports legacy aggregate columns and disabled fallbacks", () => {
    expect(buildDatasetAggregationRef({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        aggregate: "scan_group",
      },
    })).toEqual({
      enabled: true,
      column: "scan_group",
      method: "unknown",
      source: "legacy-aggregate",
    });

    const disabledAggregation = buildDatasetAggregationRef(null);
    const legacyAggregation = buildDatasetAggregationRef({
      config: {
        delimiter: ",",
        decimal_separator: ".",
        has_header: true,
        aggregate: "scan_group",
      },
    });
    expect(formatDatasetAggregationLabel(disabledAggregation)).toBe("No aggregation configured");
    expect(formatDatasetAggregationSourceLabel(legacyAggregation)).toBe("aggregation source: legacy aggregate field");
    expect(formatDatasetAggregationSourceLabel(disabledAggregation)).toBeNull();
    expect(formatDatasetAggregationTitleLabel(disabledAggregation)).toBeNull();
    expect(getDatasetAggregationReadiness(disabledAggregation)).toEqual({
      status: "disabled",
      label: "No aggregation",
      message: "No dataset aggregation is configured for this pair.",
    });
    expect(getDatasetAggregationReadiness(legacyAggregation)).toEqual({
      status: "warning",
      label: "Aggregation method unknown",
      message: "Aggregation uses legacy aggregate field \"scan_group\" without an explicit method.",
    });
  });
});
