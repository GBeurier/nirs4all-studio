import { describe, expect, it } from "vitest";
import {
  basePathFromFirstPath,
  buildDetectedFilesFromFileList,
  buildFallbackDetectedFilesFromPaths,
  datasetNameFromFilename,
  datasetNameFromFolderPath,
  filenameFromPath,
  formatFromFilename,
} from "../SourceStepData";

describe("formatFromFilename", () => {
  it("maps known extensions case-insensitively", () => {
    expect(formatFromFilename("data.XLSX")).toBe("xlsx");
    expect(formatFromFilename("data.xls")).toBe("xls");
    expect(formatFromFilename("data.parquet")).toBe("parquet");
    expect(formatFromFilename("data.npy")).toBe("npy");
    expect(formatFromFilename("data.npz")).toBe("npz");
    expect(formatFromFilename("data.mat")).toBe("mat");
    expect(formatFromFilename("data.csv")).toBe("csv");
  });

  it("defaults to csv for unknown or missing extensions", () => {
    expect(formatFromFilename("data.txt")).toBe("csv");
    expect(formatFromFilename("noextension")).toBe("csv");
    expect(formatFromFilename("")).toBe("csv");
  });
});

describe("filenameFromPath", () => {
  it("returns the last segment for posix and windows separators", () => {
    expect(filenameFromPath("/a/b/c.csv")).toBe("c.csv");
    expect(filenameFromPath("C:\\a\\b\\c.csv")).toBe("c.csv");
    expect(filenameFromPath("bare.csv")).toBe("bare.csv");
  });
});

describe("datasetNameFromFolderPath", () => {
  it("uses the last path segment", () => {
    expect(datasetNameFromFolderPath("/home/user/wheat")).toBe("wheat");
    expect(datasetNameFromFolderPath("C:\\data\\corn")).toBe("corn");
  });

  it("falls back to 'dataset' for empty paths", () => {
    expect(datasetNameFromFolderPath("")).toBe("dataset");
  });
});

describe("datasetNameFromFilename", () => {
  it("strips the extension", () => {
    expect(datasetNameFromFilename("X_train.csv")).toBe("X_train");
    expect(datasetNameFromFilename("multi.part.name.xlsx")).toBe("multi.part.name");
  });

  it("keeps dotless names and falls back to 'dataset' when nothing remains", () => {
    expect(datasetNameFromFilename(".csv")).toBe("dataset");
    expect(datasetNameFromFilename("noext")).toBe("noext");
  });
});

describe("basePathFromFirstPath", () => {
  it("returns the directory portion up to the last separator", () => {
    expect(basePathFromFirstPath("/home/user/X_train.csv")).toBe("/home/user");
    expect(basePathFromFirstPath("C:\\data\\corn\\X_train.csv")).toBe("C:\\data\\corn");
  });

  it("returns empty string when there is no separator", () => {
    expect(basePathFromFirstPath("X_train.csv")).toBe("");
  });
});

describe("buildFallbackDetectedFilesFromPaths", () => {
  it("builds unknown/train fallback entries with inferred format", () => {
    const files = buildFallbackDetectedFilesFromPaths(["/data/X_train.csv", "/data/Y.xlsx"]);
    expect(files).toEqual([
      {
        path: "/data/X_train.csv",
        filename: "X_train.csv",
        type: "unknown",
        split: "train",
        source: null,
        format: "csv",
        size_bytes: 0,
        confidence: 0.0,
        detected: false,
      },
      {
        path: "/data/Y.xlsx",
        filename: "Y.xlsx",
        type: "unknown",
        split: "train",
        source: null,
        format: "xlsx",
        size_bytes: 0,
        confidence: 0.0,
        detected: false,
      },
    ]);
  });
});

describe("buildDetectedFilesFromFileList", () => {
  it("uses filename as path and carries File.size", () => {
    const file = { name: "spectra.parquet", size: 1234 } as File;
    expect(buildDetectedFilesFromFileList([file])).toEqual([
      {
        path: "spectra.parquet",
        filename: "spectra.parquet",
        type: "unknown",
        split: "train",
        source: null,
        format: "parquet",
        size_bytes: 1234,
        confidence: 0.0,
        detected: false,
      },
    ]);
  });
});
