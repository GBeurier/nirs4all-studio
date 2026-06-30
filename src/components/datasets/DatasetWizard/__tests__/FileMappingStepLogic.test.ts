import { describe, expect, it } from "vitest";

import type { DetectedFile } from "@/types/datasets";
import {
  buildFallbackDetectedFilesFromFileList,
  buildFallbackDetectedFilesFromPaths,
  buildRoleUpdate,
  extractDroppedFiles,
  formatFromFilename,
  formatSize,
  getFileMappingValidation,
  getFileShapeDisplay,
  getMaxSource,
  getSourceOptions,
  mergeFileBlobs,
  shouldStoreDroppedFileBlobs,
} from "../FileMappingStepLogic";

const baseFile: DetectedFile = {
  path: "/data/X_train.csv",
  filename: "X_train.csv",
  type: "X",
  split: "train",
  source: 2,
  format: "csv",
  size_bytes: 1024,
  confidence: 0.9,
  detected: true,
};

describe("FileMappingStepLogic", () => {
  it("formats file sizes like the original row display", () => {
    expect(formatSize(0)).toBe("—");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  it("infers fallback file formats from names", () => {
    expect(formatFromFilename("spectra.XLSX")).toBe("xlsx");
    expect(formatFromFilename("matrix.npy")).toBe("npy");
    expect(formatFromFilename("unknown.txt")).toBe("csv");
  });

  it("builds fallback detected files from selected paths", () => {
    expect(buildFallbackDetectedFilesFromPaths(["/data/X_train.csv", "C:\\data\\Y.xlsx"])).toEqual([
      {
        path: "/data/X_train.csv",
        filename: "X_train.csv",
        type: "unknown",
        split: "train",
        source: null,
        format: "csv",
        size_bytes: 0,
        confidence: 0,
        detected: false,
      },
      {
        path: "C:\\data\\Y.xlsx",
        filename: "Y.xlsx",
        type: "unknown",
        split: "train",
        source: null,
        format: "xlsx",
        size_bytes: 0,
        confidence: 0,
        detected: false,
      },
    ]);
  });

  it("builds fallback detected files from dropped browser files", () => {
    const file = { name: "spectra.parquet", size: 1234 } as File;

    expect(buildFallbackDetectedFilesFromFileList([file])).toEqual([
      {
        path: "spectra.parquet",
        filename: "spectra.parquet",
        type: "unknown",
        split: "train",
        source: null,
        format: "parquet",
        size_bytes: 1234,
        confidence: 0,
        detected: false,
      },
    ]);
  });

  it("extracts dropped file paths with desktop path preference and File.path fallback", () => {
    const withDesktopPath = { name: "a.csv", size: 1 } as File;
    const withLegacyPath = { name: "b.csv", size: 1, path: "/legacy/b.csv" } as File & { path: string };
    const files = {
      length: 2,
      0: withDesktopPath,
      1: withLegacyPath,
    } as unknown as FileList;

    expect(extractDroppedFiles(files, (file) => (file.name === "a.csv" ? "/desktop/a.csv" : undefined))).toEqual({
      paths: ["/desktop/a.csv", "/legacy/b.csv"],
      fileList: [withDesktopPath, withLegacyPath],
    });
  });

  it("computes mapping validation warnings", () => {
    expect(getFileMappingValidation([]).warning).toBeNull();
    expect(getFileMappingValidation([{ ...baseFile, type: "unknown" }]).warning).toBe("missing-x");
    expect(getFileMappingValidation([{ ...baseFile, split: "test" }]).warning).toBe("missing-train-x");
    expect(getFileMappingValidation([baseFile]).warning).toBeNull();
  });

  it("keeps source numbering and role source updates compatible", () => {
    expect(getMaxSource([baseFile, { ...baseFile, source: 4 }])).toBe(4);
    expect(getSourceOptions(4)).toEqual([1, 2, 3, 4, 5]);
    expect(buildRoleUpdate({ ...baseFile, source: null }, "X")).toEqual({ type: "X", source: 1 });
    expect(buildRoleUpdate(baseFile, "Y")).toEqual({ type: "Y", source: null });
  });

  it("prefers validation shape values and hides stale detection shape on errors", () => {
    expect(getFileShapeDisplay({ ...baseFile, num_rows: 10, num_columns: 5 })).toEqual({
      status: "shape",
      numRows: 10,
      numColumns: 5,
    });
    expect(getFileShapeDisplay({ ...baseFile, num_rows: 10, num_columns: 5 }, { error: "bad file" })).toEqual({
      status: "error",
      error: "bad file",
    });
    expect(getFileShapeDisplay(baseFile, { num_rows: 20, num_columns: 6 })).toEqual({
      status: "shape",
      numRows: 20,
      numColumns: 6,
    });
  });

  it("mirrors web-mode blob storage decisions", () => {
    const file = { name: "spectra.csv", size: 7 } as File;
    const existingBlobs = new Map([["old.csv", { name: "old.csv" } as File]]);

    expect(shouldStoreDroppedFileBlobs(new Map(), [])).toBe(true);
    expect(shouldStoreDroppedFileBlobs(new Map(), ["/desktop/spectra.csv"])).toBe(false);
    expect(shouldStoreDroppedFileBlobs(existingBlobs, ["/desktop/spectra.csv"])).toBe(true);
    expect(Array.from(mergeFileBlobs(existingBlobs, [file]).keys())).toEqual(["old.csv", "spectra.csv"]);
  });
});
