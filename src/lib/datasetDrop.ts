import type {
  AggregationConfig,
  DetectedFile,
  DetectionConfidence,
  FoldConfig,
  MultiSourceConfig,
  ParsingOptions,
  TargetConfig,
  TaskType,
  UnifiedDetectionResponse,
  WizardSourceType,
  WizardStep,
} from "@/types/datasets";

interface DroppedFileLike {
  name: string;
  size: number;
}

export interface DroppedDatasetContent<TFile extends DroppedFileLike = File> {
  type: "folder" | "files";
  path: string;
  paths: string[];
  items: TFile[];
  relativePaths?: string[];
  folderName?: string;
}

export interface DatasetDropWizardInitialState<TFile extends DroppedFileLike = File> {
  sourceType: WizardSourceType;
  basePath: string;
  datasetName?: string;
  files?: DetectedFile[];
  skipToStep?: WizardStep;
  parsing?: Partial<ParsingOptions>;
  perFileOverrides?: Record<string, Partial<ParsingOptions>>;
  targets?: TargetConfig[];
  defaultTarget?: string;
  taskType?: TaskType;
  aggregation?: Partial<AggregationConfig>;
  multiSource?: MultiSourceConfig | null;
  folds?: FoldConfig | null;
  detectedParsing?: Partial<ParsingOptions>;
  hasFoldFile?: boolean;
  foldFilePath?: string;
  metadataColumns?: string[];
  confidence?: DetectionConfidence;
  fileBlobs?: Map<string, TFile>;
}

export type DatasetDropResolution<TFile extends DroppedFileLike = File> =
  | {
      kind: "wizard";
      initialState: DatasetDropWizardInitialState<TFile>;
    }
  | {
      kind: "batch-scan";
      path: string;
    };

export interface DatasetDropDetectors {
  detectUnified: (request: { path: string; recursive?: boolean }) => Promise<UnifiedDetectionResponse>;
  detectFilesList: (paths: string[]) => Promise<UnifiedDetectionResponse>;
}

export interface DatasetDropLogger {
  warn: (...args: unknown[]) => void;
}

export function getDroppedFileFormat(filename: string): DetectedFile["format"] {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith(".xlsx")) return "xlsx";
  if (lowerName.endsWith(".xls")) return "xls";
  if (lowerName.endsWith(".parquet")) return "parquet";
  if (lowerName.endsWith(".npy")) return "npy";
  if (lowerName.endsWith(".npz")) return "npz";
  if (lowerName.endsWith(".mat")) return "mat";
  return "csv";
}

export function getCommonParentPath(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return paths[0];

  const separator = paths[0].includes("\\") ? "\\" : "/";
  const parts = paths.map((path) => path.split(/[/\\]/));
  const commonParts: string[] = [];

  for (let i = 0; i < parts[0].length; i++) {
    if (parts.every((part) => part[i] === parts[0][i])) {
      commonParts.push(parts[0][i]);
    } else {
      break;
    }
  }

  return commonParts.join(separator);
}

function resolveDroppedPath(filename: string, relativePaths?: string[]): string {
  return relativePaths?.find((path) => path.endsWith(filename)) || filename;
}

export function createDetectedFilesFromDroppedItems(
  files: DroppedFileLike[],
  relativePaths?: string[],
): DetectedFile[] {
  return files.map((file) => {
    const path = resolveDroppedPath(file.name, relativePaths);
    return {
      path,
      filename: file.name,
      type: "unknown",
      split: "train",
      source: null,
      format: getDroppedFileFormat(file.name),
      size_bytes: file.size,
      confidence: 0,
      detected: false,
    };
  });
}

export function createDroppedFileBlobMap<T extends { name: string }>(
  files: T[],
  relativePaths?: string[],
): Map<string, T> {
  const fileBlobs = new Map<string, T>();
  for (const file of files) {
    fileBlobs.set(resolveDroppedPath(file.name, relativePaths), file);
  }
  return fileBlobs;
}

function applyDetectionResult<TFile extends DroppedFileLike>(
  initialState: DatasetDropWizardInitialState<TFile>,
  result: UnifiedDetectionResponse,
): DatasetDropWizardInitialState<TFile> {
  return {
    ...initialState,
    files: result.files,
    perFileOverrides: Object.fromEntries(
      result.files.flatMap((file) => file.overrides ? [[file.path, file.overrides]] : []),
    ),
    detectedParsing: result.parsing_options,
    hasFoldFile: result.has_fold_file,
    foldFilePath: result.fold_file_path,
    metadataColumns: result.metadata_columns,
    confidence: result.confidence,
  };
}

export function getDroppedPathParentDirectory(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const separatorIndex = path.lastIndexOf(separator);
  return separatorIndex >= 0 ? path.substring(0, separatorIndex) : "";
}

export async function resolveDatasetDrop<TFile extends DroppedFileLike = File>(
  content: DroppedDatasetContent<TFile>,
  detectors: DatasetDropDetectors,
  logger: DatasetDropLogger = console,
): Promise<DatasetDropResolution<TFile>> {
  let initialState: DatasetDropWizardInitialState<TFile> = {
    sourceType: content.type,
    basePath: content.path,
    skipToStep: "files",
  };

  if (content.type === "folder" && content.path) {
    if (content.paths.length > 1) {
      const commonParent = getCommonParentPath(content.paths);
      return {
        kind: "batch-scan",
        path: commonParent || content.paths[0],
      };
    }

    try {
      const result = await detectors.detectUnified({ path: content.path, recursive: true });
      if (result.files.length === 0 || !result.has_standard_structure) {
        return {
          kind: "batch-scan",
          path: content.path,
        };
      }

      initialState = applyDetectionResult(initialState, result);
    } catch (error) {
      logger.warn("Unified detection failed:", error);
      return {
        kind: "batch-scan",
        path: content.path,
      };
    }
  } else if (content.type === "files" && content.paths.length > 0) {
    try {
      const result = await detectors.detectFilesList(content.paths);
      initialState = applyDetectionResult(initialState, result);
      initialState.basePath = getDroppedPathParentDirectory(content.paths[0]);
    } catch (error) {
      logger.warn("File detection failed, wizard will handle manually:", error);
    }
  } else if (content.type === "folder" && content.folderName && content.items.length > 0) {
    initialState.basePath = content.folderName;
    initialState.files = createDetectedFilesFromDroppedItems(
      content.items,
      content.relativePaths,
    );
    initialState.fileBlobs = createDroppedFileBlobMap(
      content.items,
      content.relativePaths,
    );
  } else if (content.type === "files" && content.items.length > 0) {
    initialState.files = createDetectedFilesFromDroppedItems(content.items);
    initialState.fileBlobs = createDroppedFileBlobMap(content.items);
  }

  return {
    kind: "wizard",
    initialState,
  };
}
