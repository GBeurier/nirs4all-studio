import type { DetectedFile } from "@/types/datasets";

export type ValidatedFileShape = {
  num_rows?: number;
  num_columns?: number;
  error?: string;
};

export type FileMappingWarning = "missing-x" | "missing-train-x" | null;

export interface FileMappingValidation {
  hasXFiles: boolean;
  hasTrainX: boolean;
  warning: FileMappingWarning;
}

export type FileShapeDisplay =
  | { status: "error"; error: string }
  | { status: "shape"; numRows: number; numColumns: number }
  | { status: "none" };

export const FILE_MAPPING_DIALOG_FILTERS = [
  "CSV files (*.csv)",
  "Excel files (*.xlsx;*.xls)",
  "All files (*.*)",
];

export const FILE_ROLE_OPTIONS = [
  { value: "X", label: "X (Features/Spectra)" },
  { value: "Y", label: "Y (Targets/Analyte)" },
  { value: "metadata", label: "Metadata" },
  { value: "unknown", label: "Unknown" },
] as const satisfies ReadonlyArray<{
  value: DetectedFile["type"];
  label: string;
}>;

export const FILE_SPLIT_OPTIONS = [
  { value: "train", label: "Train" },
  { value: "test", label: "Test" },
  { value: "unknown", label: "Unknown" },
] as const satisfies ReadonlyArray<{
  value: DetectedFile["split"];
  label: string;
}>;

export function formatSize(bytes: number): string {
  if (bytes === 0) return "—";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatFromFilename(filename: string): DetectedFile["format"] {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".xlsx")) return "xlsx";
  if (lowerName.endsWith(".xls")) return "xls";
  if (lowerName.endsWith(".parquet")) return "parquet";
  if (lowerName.endsWith(".npy")) return "npy";
  if (lowerName.endsWith(".npz")) return "npz";
  if (lowerName.endsWith(".mat")) return "mat";
  return "csv";
}

export function filenameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || "";
}

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
      confidence: 0,
      detected: false,
    };
  });
}

export function buildFallbackDetectedFilesFromFileList(fileList: File[]): DetectedFile[] {
  return fileList.map((file) => {
    const filename = file.name;

    return {
      path: filename,
      filename,
      type: "unknown" as const,
      split: "train" as const,
      source: null,
      format: formatFromFilename(filename),
      size_bytes: file.size,
      confidence: 0,
      detected: false,
    };
  });
}

export function extractDroppedFiles(
  files: FileList | null | undefined,
  getPathForFile?: (file: File) => string | undefined
): { paths: string[]; fileList: File[] } {
  const paths: string[] = [];
  const fileList: File[] = [];

  if (!files) {
    return { paths, fileList };
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    fileList.push(file);

    if (getPathForFile) {
      try {
        const path = getPathForFile(file);
        if (path) {
          paths.push(path);
          continue;
        }
      } catch {
        // Fallback to the legacy File.path property below.
      }
    }

    const filePath = (file as File & { path?: string }).path;
    if (filePath) {
      paths.push(filePath);
    }
  }

  return { paths, fileList };
}

export function getMaxSource(files: DetectedFile[]): number {
  return Math.max(
    0,
    ...files.filter((file) => file.type === "X").map((file) => file.source || 0)
  );
}

export function getFileMappingValidation(files: DetectedFile[]): FileMappingValidation {
  const hasXFiles = files.some((file) => file.type === "X");
  const hasTrainX = files.some((file) => file.type === "X" && file.split === "train");

  return {
    hasXFiles,
    hasTrainX,
    warning: !hasXFiles && files.length > 0 ? "missing-x" : hasXFiles && !hasTrainX ? "missing-train-x" : null,
  };
}

export function buildRoleUpdate(file: DetectedFile, type: DetectedFile["type"]): Partial<DetectedFile> {
  return {
    type,
    source: type === "X" ? file.source || 1 : null,
  };
}

export function getSourceOptions(maxSource: number): number[] {
  return Array.from({ length: Math.max(maxSource + 1, 5) }, (_, index) => index + 1);
}

export function getFileShapeDisplay(file: DetectedFile, validatedShape?: ValidatedFileShape): FileShapeDisplay {
  const hasValidationError = validatedShape?.error != null;
  const numRows = validatedShape?.num_rows ?? (hasValidationError ? undefined : file.num_rows);
  const numColumns = validatedShape?.num_columns ?? (hasValidationError ? undefined : file.num_columns);

  if (hasValidationError) {
    return { status: "error", error: validatedShape?.error ?? "" };
  }

  if (numRows != null && numColumns != null) {
    return { status: "shape", numRows, numColumns };
  }

  return { status: "none" };
}

export function shouldStoreDroppedFileBlobs(fileBlobs: ReadonlyMap<string, File>, paths: string[]): boolean {
  return fileBlobs.size > 0 || paths.length === 0;
}

export function mergeFileBlobs(fileBlobs: ReadonlyMap<string, File>, fileList: File[]): Map<string, File> {
  const newBlobs = new Map(fileBlobs);
  fileList.forEach((file) => {
    newBlobs.set(file.name, file);
  });
  return newBlobs;
}
