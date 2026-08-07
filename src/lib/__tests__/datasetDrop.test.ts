import { describe, expect, it, vi } from "vitest";

import {
  createDetectedFilesFromDroppedItems,
  createDroppedFileBlobMap,
  getCommonParentPath,
  getDroppedFileFormat,
  getDroppedPathParentDirectory,
  resolveDatasetDrop,
} from "../datasetDrop";
import type { UnifiedDetectionResponse } from "@/types/datasets";

function detectionResponse(
  overrides: Partial<UnifiedDetectionResponse> = {},
): UnifiedDetectionResponse {
  return {
    files: [
      {
        path: "/data/ds/X.csv",
        filename: "X.csv",
        type: "X",
        split: "train",
        source: 1,
        format: "csv",
        size_bytes: 100,
        confidence: 0.9,
        detected: true,
      },
    ],
    folder_name: "ds",
    total_size_bytes: 100,
    has_standard_structure: true,
    parsing_options: { delimiter: "," },
    confidence: { delimiter: 0.9 },
    has_fold_file: true,
    fold_file_path: "/data/ds/folds.csv",
    metadata_columns: ["batch"],
    warnings: [],
    ...overrides,
  };
}

describe("datasetDrop", () => {
  it("detects supported file formats from names", () => {
    expect(getDroppedFileFormat("spectra.csv")).toBe("csv");
    expect(getDroppedFileFormat("spectra.XLSX")).toBe("xlsx");
    expect(getDroppedFileFormat("cube.npz")).toBe("npz");
    expect(getDroppedFileFormat("meta.parquet")).toBe("parquet");
  });

  it("computes a common parent for unix and windows paths", () => {
    expect(getCommonParentPath(["/data/a/train", "/data/a/test"])).toBe("/data/a");
    expect(getCommonParentPath(["C:\\data\\a\\train", "C:\\data\\a\\test"])).toBe(
      "C:\\data\\a",
    );
  });

  it("creates detected file entries for browser drops", () => {
    const files = [
      { name: "x.csv", size: 10 },
      { name: "y.xlsx", size: 20 },
    ];

    expect(
      createDetectedFilesFromDroppedItems(files, ["folder/x.csv", "folder/y.xlsx"]),
    ).toEqual([
      {
        path: "folder/x.csv",
        filename: "x.csv",
        type: "unknown",
        split: "train",
        source: null,
        format: "csv",
        size_bytes: 10,
        confidence: 0,
        detected: false,
      },
      {
        path: "folder/y.xlsx",
        filename: "y.xlsx",
        type: "unknown",
        split: "train",
        source: null,
        format: "xlsx",
        size_bytes: 20,
        confidence: 0,
        detected: false,
      },
    ]);
  });

  it("maps dropped files by relative path when available", () => {
    const files = [
      { name: "x.csv", size: 10 },
      { name: "y.csv", size: 20 },
    ];

    expect([
      ...createDroppedFileBlobMap(files, ["folder/x.csv", "folder/y.csv"]).keys(),
    ]).toEqual(["folder/x.csv", "folder/y.csv"]);
  });

  it("derives parent directories from dropped desktop file paths", () => {
    expect(getDroppedPathParentDirectory("/data/a/x.csv")).toBe("/data/a");
    expect(getDroppedPathParentDirectory("C:\\data\\a\\x.csv")).toBe("C:\\data\\a");
    expect(getDroppedPathParentDirectory("x.csv")).toBe("");
  });

  it("routes multiple dropped folders to batch scan without backend detection", async () => {
    const detectUnified = vi.fn();
    const detectFilesList = vi.fn();

    await expect(
      resolveDatasetDrop(
        {
          type: "folder",
          path: "/data/a/train",
          paths: ["/data/a/train", "/data/a/test"],
          items: [],
        },
        { detectUnified, detectFilesList },
      ),
    ).resolves.toEqual({
      kind: "batch-scan",
      path: "/data/a",
    });
    expect(detectUnified).not.toHaveBeenCalled();
    expect(detectFilesList).not.toHaveBeenCalled();
  });

  it("builds a wizard state from standard folder detection", async () => {
    const response = detectionResponse({
      files: [
        ...detectionResponse().files,
        {
          path: "/data/ds/M.csv",
          filename: "M.csv",
          type: "metadata",
          split: "train",
          source: null,
          format: "csv",
          size_bytes: 100,
          confidence: 0.9,
          detected: true,
          overrides: { has_header: true },
        },
      ],
    });
    const detectUnified = vi.fn().mockResolvedValue(response);

    await expect(
      resolveDatasetDrop(
        {
          type: "folder",
          path: "/data/ds",
          paths: ["/data/ds"],
          items: [],
        },
        { detectUnified, detectFilesList: vi.fn() },
      ),
    ).resolves.toMatchObject({
      kind: "wizard",
      initialState: {
        sourceType: "folder",
        basePath: "/data/ds",
        skipToStep: "files",
        detectedParsing: { delimiter: "," },
        perFileOverrides: {
          "/data/ds/M.csv": { has_header: true },
        },
        hasFoldFile: true,
        foldFilePath: "/data/ds/folds.csv",
        metadataColumns: ["batch"],
        confidence: { delimiter: 0.9 },
      },
    });
    expect(detectUnified).toHaveBeenCalledWith({ path: "/data/ds", recursive: true });
  });

  it("falls back to batch scan when folder detection fails or is not standard", async () => {
    const logger = { warn: vi.fn() };

    await expect(
      resolveDatasetDrop(
        {
          type: "folder",
          path: "/data/loose",
          paths: ["/data/loose"],
          items: [],
        },
        {
          detectUnified: vi.fn().mockResolvedValue(detectionResponse({ has_standard_structure: false })),
          detectFilesList: vi.fn(),
        },
        logger,
      ),
    ).resolves.toEqual({
      kind: "batch-scan",
      path: "/data/loose",
    });
    expect(logger.warn).not.toHaveBeenCalled();

    await expect(
      resolveDatasetDrop(
        {
          type: "folder",
          path: "/data/error",
          paths: ["/data/error"],
          items: [],
        },
        {
          detectUnified: vi.fn().mockRejectedValue(new Error("boom")),
          detectFilesList: vi.fn(),
        },
        logger,
      ),
    ).resolves.toEqual({
      kind: "batch-scan",
      path: "/data/error",
    });
    expect(logger.warn).toHaveBeenCalledWith("Unified detection failed:", expect.any(Error));
  });

  it("builds a wizard state from dropped desktop files", async () => {
    await expect(
      resolveDatasetDrop(
        {
          type: "files",
          path: "/data/ds/X.csv",
          paths: ["/data/ds/X.csv", "/data/ds/Y.csv"],
          items: [],
        },
        {
          detectUnified: vi.fn(),
          detectFilesList: vi.fn().mockResolvedValue(detectionResponse()),
        },
      ),
    ).resolves.toMatchObject({
      kind: "wizard",
      initialState: {
        sourceType: "files",
        basePath: "/data/ds",
        files: detectionResponse().files,
        detectedParsing: { delimiter: "," },
      },
    });
  });

  it("builds browser drop wizard states without backend paths", async () => {
    const files = [
      { name: "x.csv", size: 10 },
      { name: "y.csv", size: 20 },
    ];

    const resolution = await resolveDatasetDrop(
      {
        type: "folder",
        path: "",
        paths: [],
        items: files,
        folderName: "browser-folder",
        relativePaths: ["browser-folder/x.csv", "browser-folder/y.csv"],
      },
      { detectUnified: vi.fn(), detectFilesList: vi.fn() },
    );

    expect(resolution.kind).toBe("wizard");
    if (resolution.kind === "wizard") {
      expect(resolution.initialState.basePath).toBe("browser-folder");
      expect(resolution.initialState.files?.map((file) => file.path)).toEqual([
        "browser-folder/x.csv",
        "browser-folder/y.csv",
      ]);
      expect([...resolution.initialState.fileBlobs?.keys() ?? []]).toEqual([
        "browser-folder/x.csv",
        "browser-folder/y.csv",
      ]);
    }
  });
});
