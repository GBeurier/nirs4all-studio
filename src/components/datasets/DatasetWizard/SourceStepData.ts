/**
 * Pure (React-free) logic for {@link ./SourceStep.tsx}.
 *
 * Path/filename parsing, format inference, and `DetectedFile` fallback
 * construction are isolated here so they can be unit-tested directly and
 * extended for upcoming nirs4all-io / multimodal formats without touching the
 * component's effects, refs, dispatch, or JSX.
 */
import type { DetectedFile } from "@/types/datasets";

type DetectedFormat = DetectedFile["format"];

/** Split a path on either separator and return its last non-empty-ish segment. */
function lastSegment(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || "";
}

/**
 * Map a filename's extension to a {@link DetectedFile} format.
 * Defaults to `"csv"` when the extension is unknown or absent.
 */
export function formatFromFilename(filename: string): DetectedFormat {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".xlsx")) return "xlsx";
  if (lowerName.endsWith(".xls")) return "xls";
  if (lowerName.endsWith(".parquet")) return "parquet";
  if (lowerName.endsWith(".npy")) return "npy";
  if (lowerName.endsWith(".npz")) return "npz";
  if (lowerName.endsWith(".mat")) return "mat";
  return "csv";
}

/** Final path segment (filename) from a full path. */
export function filenameFromPath(path: string): string {
  return lastSegment(path);
}

/**
 * Derive a dataset name from a folder (or base) path: its last segment.
 * Falls back to `"dataset"` when the path is empty.
 */
export function datasetNameFromFolderPath(folderPath: string): string {
  return lastSegment(folderPath) || "dataset";
}

/**
 * Derive a dataset name from a filename by stripping its extension.
 * Falls back to `"dataset"` when nothing remains.
 */
export function datasetNameFromFilename(filename: string): string {
  const extensionIndex = filename.lastIndexOf(".");
  if (extensionIndex < 0) return filename || "dataset";
  if (extensionIndex === 0) return "dataset";
  return filename.slice(0, extensionIndex) || "dataset";
}

/**
 * Base directory for a selected file: everything up to the last separator.
 */
export function basePathFromFirstPath(firstPath: string): string {
  const separatorIndex = Math.max(firstPath.lastIndexOf("/"), firstPath.lastIndexOf("\\"));
  return separatorIndex >= 0 ? firstPath.slice(0, separatorIndex) : "";
}

/**
 * Build fallback `DetectedFile`s from absolute/relative paths when backend
 * detection is unavailable. Only the format is inferred; type/split are left
 * for the user to map in {@link ./FileMappingStep}.
 */
export function buildFallbackDetectedFilesFromPaths(filePaths: string[]): DetectedFile[] {
  return filePaths.map((filePath) => {
    const filename = filenameFromPath(filePath);
    return {
      path: filePath,
      filename,
      type: "unknown" as const,
      split: "train" as const,
      source: null,
      format: formatFromFilename(filename),
      size_bytes: 0,
      confidence: 0.0,
      detected: false,
    };
  });
}

/**
 * Build fallback `DetectedFile`s from browser `File` objects (web mode).
 * The filename doubles as the path, and `size_bytes` comes from `File.size`.
 */
export function buildDetectedFilesFromFileList(files: File[]): DetectedFile[] {
  return files.map((file) => {
    const filename = file.name;
    return {
      path: filename, // Use filename as path in web mode
      filename,
      type: "unknown" as const,
      split: "train" as const,
      source: null,
      format: formatFromFilename(filename),
      size_bytes: file.size,
      confidence: 0.0,
      detected: false,
    };
  });
}
