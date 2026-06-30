import { describe, expect, it } from "vitest";

import {
  buildDatasetSchemaFingerprint,
  stableDatasetSchemaHash,
  stableDatasetSchemaStringify,
  type DatasetSchemaFingerprintInput,
} from "../datasetSchemaFingerprint";

const fingerprintInput: DatasetSchemaFingerprintInput = {
  datasetId: "corn",
  hash: undefined,
  sampleCount: 42,
  featureCount: 128,
  sourceCount: 2,
  targetColumns: ["protein", "moisture"],
  defaultTargetColumn: "protein",
  metadataColumns: ["batch", "operator"],
  repetitionColumn: "sample_id",
  aggregation: {
    enabled: false,
    column: null,
    method: "unknown",
    source: "none",
  },
  taskType: "regression",
};

describe("datasetSchemaFingerprint", () => {
  it("serializes object keys stably while preserving array order", () => {
    expect(stableDatasetSchemaStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(stableDatasetSchemaStringify({ a: ["b", "a"] })).toBe('{"a":["b","a"]}');
    expect(stableDatasetSchemaStringify({ a: undefined })).toBe('{"a":undefined}');
  });

  it("hashes equivalent object payloads identically regardless of key order", () => {
    expect(stableDatasetSchemaHash({ b: 2, a: 1 })).toBe(stableDatasetSchemaHash({ a: 1, b: 2 }));
    expect(stableDatasetSchemaHash({ a: ["b", "a"] })).not.toBe(stableDatasetSchemaHash({ a: ["a", "b"] }));
  });

  it("uses persisted dataset hashes when available", () => {
    expect(buildDatasetSchemaFingerprint({ ...fingerprintInput, hash: "hash-1" })).toBe("dataset:hash-1");
  });

  it("builds stable legacy fingerprints from schema-relevant fields", () => {
    const first = buildDatasetSchemaFingerprint(fingerprintInput);
    const second = buildDatasetSchemaFingerprint({
      ...fingerprintInput,
      metadataColumns: ["batch", "operator"],
    });
    const changed = buildDatasetSchemaFingerprint({
      ...fingerprintInput,
      metadataColumns: ["operator", "batch"],
    });
    const changedAggregation = buildDatasetSchemaFingerprint({
      ...fingerprintInput,
      aggregation: {
        enabled: true,
        column: "sample_id",
        method: "mean",
        source: "config",
      },
    });

    expect(first).toMatch(/^legacy:/);
    expect(second).toBe(first);
    expect(changed).not.toBe(first);
    expect(changedAggregation).not.toBe(first);
  });
});
