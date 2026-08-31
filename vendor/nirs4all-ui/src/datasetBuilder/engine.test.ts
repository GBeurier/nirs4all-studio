import { describe, expect, it } from "vitest";

import { buildExportConfig } from "./exportConfig.js";
import { deriveSchema, derivePartitionPreview, assignRoleToColumns } from "./schema.js";
import { validateBuilder } from "./validate.js";
import type { DatasetColumn, DatasetSource } from "./types.js";

function col(
  name: string,
  role: DatasetColumn["assignedRole"],
  detectedType: DatasetColumn["detectedType"] = "float",
  semanticType?: DatasetColumn["semanticType"],
): DatasetColumn {
  const base: DatasetColumn = { id: name, name, detectedType, assignedRole: role };
  if (semanticType) base.semanticType = semanticType;
  return base;
}

function makeSpectra(): DatasetSource {
  return {
    id: "spectra",
    name: "wheat_spectra_train.csv",
    kind: "file",
    fileType: "csv",
    signalType: "spectra",
    status: "parsed",
    rowCount: 12048,
    columnCount: 4,
    parsing: { separator: ";", decimal: ".", headerMode: "horizontal" },
    usage: { useAs: "x_train" },
    columns: [
      col("sample_id", "id", "text", "identifier"),
      col("replicate", "replicate", "integer"),
      col("split", "partition", "text"),
      col("wavelength_1000", "x", "float", "wavelength"),
      col("wavelength_1001", "x", "float", "wavelength"),
    ],
  };
}

function makeMetadata(): DatasetSource {
  return {
    id: "meta",
    name: "metadata.xlsx",
    kind: "file",
    fileType: "xlsx",
    signalType: "metadata",
    status: "parsed",
    rowCount: 12048,
    parsing: { sheetName: "Sheet1" },
    usage: { useAs: "metadata" },
    columns: [
      col("sample_id", "id", "text", "identifier"),
      col("protein_pct", "y", "float", "regression"),
      col("disease_class", "y", "text", "classification"),
      col("cultivar", "metadata", "text"),
    ],
  };
}

describe("deriveSchema", () => {
  it("aggregates roles across sources", () => {
    const schema = deriveSchema([makeSpectra(), makeMetadata()]);
    expect(schema.xSources).toEqual(["spectra"]);
    expect(schema.yColumns.map((c) => c.columnName)).toEqual(["protein_pct", "disease_class"]);
    expect(schema.idColumns).toHaveLength(2);
    expect(schema.partitionColumns).toHaveLength(1);
  });
});

describe("derivePartitionPreview", () => {
  it("splits 80/20 when a partition column is present", () => {
    const preview = derivePartitionPreview([makeSpectra()], "train_test");
    expect(preview.detected).toBe(true);
    expect(preview.buckets[0]?.id).toBe("train");
    expect(preview.buckets[0]?.count).toBe(Math.round(12048 * 0.8));
  });
  it("uses everything as train in train_only mode", () => {
    const preview = derivePartitionPreview([makeSpectra()], "train_only");
    expect(preview.buckets).toHaveLength(1);
    expect(preview.buckets[0]?.count).toBe(12048);
  });
});

describe("validateBuilder", () => {
  it("is valid for a complete X + Y dataset", () => {
    const result = validateBuilder([makeSpectra(), makeMetadata()]);
    expect(result.status).toBe("ok");
    expect(result.checks.some((c) => c.id === "ready")).toBe(true);
  });
  it("errors when no source", () => {
    expect(validateBuilder([]).status).toBe("error");
  });
  it("errors when X missing", () => {
    const noX = { ...makeSpectra(), columns: makeSpectra().columns.filter((c) => c.assignedRole !== "x") };
    const result = validateBuilder([noX]);
    expect(result.checks.find((c) => c.id === "has-x")?.level).toBe("error");
  });
});

describe("buildExportConfig", () => {
  it("produces the documented config shape", () => {
    const config = buildExportConfig("demo_wheat", [makeSpectra(), makeMetadata()]);
    expect(config.name).toBe("demo_wheat");
    expect(config.sources[0]?.use_as).toBe("x_train");
    expect(config.sources[0]?.id_column).toBe("sample_id");
    expect(config.targets).toEqual([
      { source: "metadata.xlsx", column: "protein_pct", task: "regression" },
      { source: "metadata.xlsx", column: "disease_class", task: "classification" },
    ]);
    expect(config.metadata[0]).toEqual({ source: "metadata.xlsx", columns: ["cultivar"] });
    expect(config.joins[0]).toMatchObject({ left: "wheat_spectra_train.csv", right: "metadata.xlsx", on: "sample_id" });
    expect(config.partition?.column).toBe("split");
    expect(config.replicates).toEqual({ column: "replicate", strategy: "keep" });
  });
});

describe("assignRoleToColumns", () => {
  it("sets a role and marks columns manual", () => {
    const source = assignRoleToColumns(makeSpectra(), new Set(["wavelength_1000"]), "y");
    const col = source.columns.find((c) => c.id === "wavelength_1000")!;
    expect(col.assignedRole).toBe("y");
    expect(col.manual).toBe(true);
  });
});
