import { describe, expect, it } from "vitest";

import {
  autoDetectColumns,
  autoDetectSource,
  detectColumnRole,
  guessSignalType,
  isSpectralHeader,
} from "./detect.js";
import type { DatasetColumn, DatasetSource } from "./types.js";

function col(name: string, detectedType: DatasetColumn["detectedType"]): DatasetColumn {
  return { id: name, name, detectedType, assignedRole: "ignored" };
}

describe("isSpectralHeader", () => {
  it("matches wavelength patterns and bare numbers", () => {
    expect(isSpectralHeader("wavelength_1000")).toBe(true);
    expect(isSpectralHeader("1650.5")).toBe(true);
    expect(isSpectralHeader("1200nm")).toBe(true);
    expect(isSpectralHeader("wl_450")).toBe(true);
  });
  it("rejects non-spectral names", () => {
    expect(isSpectralHeader("sample_id")).toBe(false);
    expect(isSpectralHeader("protein_pct")).toBe(false);
  });
});

describe("detectColumnRole", () => {
  it("detects identifiers, replicate and partition by name", () => {
    expect(detectColumnRole(col("sample_id", "text"), false).assignedRole).toBe("id");
    expect(detectColumnRole(col("replicate", "integer"), false).assignedRole).toBe("replicate");
    expect(detectColumnRole(col("split", "text"), false).assignedRole).toBe("partition");
  });
  it("detects spectral X by header and by contiguous run", () => {
    expect(detectColumnRole(col("wavelength_1000", "float"), false).assignedRole).toBe("x");
    expect(detectColumnRole(col("b12", "float"), true).assignedRole).toBe("x");
  });
  it("proposes Y for target-like names with a task", () => {
    const num = detectColumnRole(col("protein_pct", "float"), false);
    expect(num.assignedRole).toBe("y");
    expect(num.semanticType).toBe("regression");
    const cls = detectColumnRole(col("disease_class", "text"), false);
    expect(cls.assignedRole).toBe("y");
    expect(cls.semanticType).toBe("classification");
  });
});

describe("autoDetectColumns", () => {
  it("marks a wide contiguous numeric block as spectral X", () => {
    const cols = [
      col("sample_id", "text"),
      ...Array.from({ length: 10 }, (_, i) => col(`band_${i}`, "float")),
    ];
    const detected = autoDetectColumns(cols);
    expect(detected[0]?.assignedRole).toBe("id");
    expect(detected.slice(1).every((c) => c.assignedRole === "x")).toBe(true);
  });
  it("preserves manual assignments", () => {
    const manual: DatasetColumn = { ...col("wavelength_1000", "float"), manual: true, assignedRole: "y" };
    const [out] = autoDetectColumns([manual]);
    expect(out?.assignedRole).toBe("y");
  });
});

describe("guessSignalType", () => {
  it("recognizes spectra, tables and metadata", () => {
    const spectra = Array.from({ length: 5 }, (_, i) => col(`wavelength_${1000 + i}`, "float"));
    expect(guessSignalType(spectra, "csv")).toBe("spectra");
    expect(guessSignalType([col("a", "text"), col("b", "text")], "csv")).toBe("metadata");
    expect(guessSignalType([], "images")).toBe("image");
  });
});

describe("autoDetectSource", () => {
  it("fills columns and signal type", () => {
    const source: DatasetSource = {
      id: "s1",
      name: "wheat.csv",
      kind: "file",
      fileType: "csv",
      signalType: "other",
      status: "parsed",
      parsing: {},
      usage: {},
      columns: [col("sample_id", "text"), ...Array.from({ length: 9 }, (_, i) => col(`${1000 + i}`, "float"))],
    };
    const out = autoDetectSource(source);
    expect(out.signalType).toBe("spectra");
    expect(out.columns[0]?.assignedRole).toBe("id");
  });
});
