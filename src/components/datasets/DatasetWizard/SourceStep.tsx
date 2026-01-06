/**
 * Step 1: Source Selection
 *
 * Choose how to add the dataset:
 * - Folder (auto-detect files)
 * - Files (manual selection)
 * - URL (remote dataset) - future
 * - Synthetic (generate) - future
 */
import { Folder, File, Link, Sparkles, Info } from "lucide-react";
import { useWizard } from "./WizardContext";
import { selectFolder, selectFile, isPyWebView } from "@/utils/fileDialogs";
import { detectFiles } from "@/api/client";
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

export function SourceStep() {
  const { state, dispatch, nextStep } = useWizard();

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

        // Auto-detect files in folder
        try {
          const result = await detectFiles({ path: folderPath, recursive: true });
          dispatch({ type: "SET_FILES", payload: result.files });
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
          const detectedFiles: DetectedFile[] = filePaths.map((filePath) => {
            const filename = filePath.split(/[/\\]/).pop() || "";
            const lowerName = filename.toLowerCase();

            // Auto-detect type from filename
            let type: "X" | "Y" | "metadata" | "unknown" = "unknown";
            let split: "train" | "test" | "unknown" = "unknown";

            if (lowerName.includes("_x") || lowerName.includes("x_") || lowerName.match(/^x[._]/)) {
              type = "X";
            } else if (lowerName.includes("_y") || lowerName.includes("y_") || lowerName.match(/^y[._]/)) {
              type = "Y";
            } else if (lowerName.includes("meta") || lowerName.includes("group") || lowerName.includes("_m") || lowerName.match(/^m[._]/)) {
              type = "metadata";
            }

            if (lowerName.includes("train")) {
              split = "train";
            } else if (lowerName.includes("test") || lowerName.includes("val")) {
              split = "test";
            }

            // Detect format
            let format: DetectedFile["format"] = "csv";
            if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
              format = lowerName.endsWith(".xlsx") ? "xlsx" : "xls";
            } else if (lowerName.endsWith(".parquet")) {
              format = "parquet";
            } else if (lowerName.endsWith(".npy") || lowerName.endsWith(".npz")) {
              format = lowerName.endsWith(".npz") ? "npz" : "npy";
            } else if (lowerName.endsWith(".mat")) {
              format = "mat";
            }

            return {
              path: filePath,
              filename,
              type,
              split: split === "unknown" ? "train" : split,
              source: type === "X" ? 1 : null,
              format,
              size_bytes: 0,
              confidence: type !== "unknown" ? 0.8 : 0.3,
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

        <SourceOption
          type="url"
          icon={<Link className="h-12 w-12" />}
          title="From URL"
          description="Load dataset from a remote URL or repository."
          disabled
          onClick={() => {}}
        />

        <SourceOption
          type="synthetic"
          icon={<Sparkles className="h-12 w-12" />}
          title="Generate Synthetic"
          description="Create a synthetic dataset for testing."
          disabled
          onClick={() => {}}
        />
      </div>

      {!isPyWebView() && (
        <div className="mt-4 p-3 bg-muted/50 rounded-lg flex items-start gap-2">
          <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-sm text-muted-foreground">
            Running in browser mode. For full file system access, use the desktop application.
          </p>
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
