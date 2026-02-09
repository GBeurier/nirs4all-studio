/**
 * Step 1: Source Selection
 *
 * Choose how to add the dataset:
 * - Folder (auto-detect files)
 * - Files (manual selection)
 * - URL (remote dataset) - future
 * - Synthetic (generate) - future
 */
import { useRef } from "react";
import { Folder, File, FolderSearch, Info } from "lucide-react";
import { useWizard } from "./WizardContext";
import { selectFolder, selectFile, isDesktop } from "@/utils/fileDialogs";
import { detectUnified } from "@/api/client";
import type { WizardSourceType, DetectedFile } from "@/types/datasets";

interface SourceOptionProps {
  type: WizardSourceType;
  icon: React.ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}

function SourceOption({
  icon,
  title,
  description,
  disabled,
  onClick,
}: SourceOptionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        flex flex-col items-center justify-center p-8
        border-2 border-dashed border-border rounded-lg
        transition-colors
        ${disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:border-primary hover:bg-primary/5 cursor-pointer"
        }
      `}
    >
      <div className="h-12 w-12 text-muted-foreground mb-4">{icon}</div>
      <h3 className="font-medium text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground text-center">{description}</p>
    </button>
  );
}

interface SourceStepProps {
  onScanFolder?: (path: string) => void;
}

export function SourceStep({ onScanFolder }: SourceStepProps) {
  const { state, dispatch, nextStep } = useWizard();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if we're in a desktop environment with full file system access
  const isDesktopMode = isDesktop();

  // Handle files selected via HTML file input (web mode fallback)
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    dispatch({ type: "SET_LOADING", payload: true });
    dispatch({ type: "SET_SOURCE_TYPE", payload: "files" });
    dispatch({ type: "SET_BASE_PATH", payload: "" }); // No path in web mode

    // Extract dataset name from first file
    const firstName = files[0].name;
    const nameParts = firstName.split(".");
    nameParts.pop(); // Remove extension
    dispatch({ type: "SET_DATASET_NAME", payload: nameParts.join(".") || "dataset" });

    // Convert to DetectedFile format
    // Note: Type detection is delegated to backend via detectUnified for folder sources.
    // For manual file selection in web mode, users map file types in FileMappingStep.
    const detectedFiles: DetectedFile[] = Array.from(files).map((file) => {
      const filename = file.name;
      const lowerName = filename.toLowerCase();

      // Only detect format from extension (simple, unambiguous)
      let format: DetectedFile["format"] = "csv";
      if (lowerName.endsWith(".xlsx")) format = "xlsx";
      else if (lowerName.endsWith(".xls")) format = "xls";
      else if (lowerName.endsWith(".parquet")) format = "parquet";
      else if (lowerName.endsWith(".npy")) format = "npy";
      else if (lowerName.endsWith(".npz")) format = "npz";
      else if (lowerName.endsWith(".mat")) format = "mat";

      return {
        path: filename, // Use filename as path in web mode
        filename,
        type: "unknown" as const, // User will map in next step
        split: "train" as const, // Default to train
        source: null,
        format,
        size_bytes: file.size,
        confidence: 0.0,
        detected: false,
      };
    });

    dispatch({ type: "SET_FILES", payload: detectedFiles });

    // Store File objects for web mode (allows client-side parsing)
    const fileBlobs = new Map<string, File>();
    Array.from(files).forEach((file) => {
      fileBlobs.set(file.name, file);
    });
    dispatch({ type: "SET_FILE_BLOBS", payload: fileBlobs });

    dispatch({ type: "SET_LOADING", payload: false });
    nextStep();

    // Reset input value so same files can be selected again
    e.target.value = "";
  };

  const handleSelectFolder = async () => {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      const folderPath = await selectFolder();

      if (folderPath && typeof folderPath === "string") {
        dispatch({ type: "SET_SOURCE_TYPE", payload: "folder" });
        dispatch({ type: "SET_BASE_PATH", payload: folderPath });

        // Extract dataset name from folder
        const parts = folderPath.split(/[/\\]/);
        const name = parts[parts.length - 1] || "dataset";
        dispatch({ type: "SET_DATASET_NAME", payload: name });

        // Auto-detect files in folder using nirs4all's FolderParser
        try {
          const result = await detectUnified({ path: folderPath, recursive: true });
          dispatch({ type: "SET_FILES", payload: result.files });
          // Store detection results including confidence
          dispatch({
            type: "SET_DETECTION_RESULTS",
            payload: {
              parsing: result.parsing_options,
              hasFoldFile: result.has_fold_file,
              foldFilePath: result.fold_file_path,
              metadataColumns: result.metadata_columns,
              confidence: result.confidence,
            },
          });
        } catch (e) {
          // If detection fails, continue with empty files (manual mapping)
          console.warn("Auto-detection failed, manual mapping required:", e);
          dispatch({ type: "SET_FILES", payload: [] });
        }

        nextStep();
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
      dispatch({
        type: "SET_ERROR",
        payload: { key: "source", message: "Failed to select folder" },
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleSelectFiles = async () => {
    try {
      dispatch({ type: "SET_LOADING", payload: true });
      const result = await selectFile(
        ["CSV files (*.csv)", "Excel files (*.xlsx;*.xls)", "All files (*.*)"],
        true
      );

      if (result) {
        const filePaths = Array.isArray(result) ? result : [result];
        if (filePaths.length > 0) {
          dispatch({ type: "SET_SOURCE_TYPE", payload: "files" });

          // Use first file's directory as base path
          const firstPath = filePaths[0];
          const basePath = firstPath.substring(0, firstPath.lastIndexOf("/") || firstPath.lastIndexOf("\\"));
          dispatch({ type: "SET_BASE_PATH", payload: basePath });

          // Extract dataset name
          const parts = basePath.split(/[/\\]/);
          const name = parts[parts.length - 1] || "dataset";
          dispatch({ type: "SET_DATASET_NAME", payload: name });

          // Create detected files from selection
          // Note: For manual file selection, users map file types in FileMappingStep.
          // Type detection is only done by backend via detectUnified for folder sources.
          const detectedFiles: DetectedFile[] = filePaths.map((filePath) => {
            const filename = filePath.split(/[/\\]/).pop() || "";
            const lowerName = filename.toLowerCase();

            // Only detect format from extension (simple, unambiguous)
            let format: DetectedFile["format"] = "csv";
            if (lowerName.endsWith(".xlsx")) format = "xlsx";
            else if (lowerName.endsWith(".xls")) format = "xls";
            else if (lowerName.endsWith(".parquet")) format = "parquet";
            else if (lowerName.endsWith(".npy")) format = "npy";
            else if (lowerName.endsWith(".npz")) format = "npz";
            else if (lowerName.endsWith(".mat")) format = "mat";

            return {
              path: filePath,
              filename,
              type: "unknown" as const, // User will map in next step
              split: "train" as const, // Default to train
              source: null,
              format,
              size_bytes: 0,
              confidence: 0.0,
              detected: false,
            };
          });

          dispatch({ type: "SET_FILES", payload: detectedFiles });
          nextStep();
        }
      }
    } catch (error) {
      console.error("Failed to select files:", error);
      dispatch({
        type: "SET_ERROR",
        payload: { key: "source", message: "Failed to select files" },
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  const handleScanFolder = async () => {
    if (!onScanFolder) return;
    try {
      const folderPath = await selectFolder();
      if (folderPath && typeof folderPath === "string") {
        onScanFolder(folderPath);
      }
    } catch (error) {
      console.error("Failed to select folder for scan:", error);
    }
  };

  return (
    <div className="py-6">
      <div className="grid grid-cols-2 gap-4">
        <SourceOption
          type="folder"
          icon={<Folder className="h-12 w-12" />}
          title="Select Folder"
          description="Choose a folder with X_train, Y_train, etc. Files are auto-detected."
          onClick={handleSelectFolder}
        />

        <SourceOption
          type="files"
          icon={<File className="h-12 w-12" />}
          title="Select Files"
          description="Choose one or more CSV/Excel files manually."
          onClick={handleSelectFiles}
        />

        {isDesktopMode && onScanFolder && (
          <SourceOption
            type="folder"
            icon={<FolderSearch className="h-12 w-12" />}
            title="Scan Folder"
            description="Recursively scan a folder for multiple datasets."
            onClick={handleScanFolder}
          />
        )}
      </div>

      {/* Hidden file input for web mode */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.xlsx,.xls,.parquet,.npy,.npz,.mat"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {!isDesktopMode && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p className="mb-2">
              Running in browser mode. For full file system access, use the desktop application.
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-primary hover:underline"
            >
              Click here to select files via browser dialog
            </button>
          </div>
        </div>
      )}

      {state.errors.source && (
        <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
          {state.errors.source}
        </div>
      )}
    </div>
  );
}
