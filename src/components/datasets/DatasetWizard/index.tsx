/**
 * DatasetWizard - Main container component for the multi-step dataset loading wizard
 *
 * Steps:
 * 1. Source Selection - Choose folder, files, URL, or synthetic
 * 2. File Detection & Mapping - Map files to roles (X, Y, metadata)
 * 3. Parsing Configuration - CSV options, signal type, NA policy
 * 4. Target Configuration - Select targets, task type, aggregation
 * 5. Preview & Confirm - View data preview and confirm
 */
import { useEffect, useRef, useCallback } from "react";
import { detectUnified, validateFiles } from "@/api/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  FolderOpen,
  Files,
  Settings2,
  Target,
  Eye,
  Check,
} from "lucide-react";
import { WizardProvider, useWizard, STEP_ORDER, type WizardInitialState } from "./WizardContext";
import { SourceStep } from "./SourceStep";
import { FileMappingStep } from "./FileMappingStep";
import { ParsingStep } from "./ParsingStep";
import { TargetsStep } from "./TargetsStep";
import { PreviewStep } from "./PreviewStep";
import type { WizardStep, DatasetConfig, DatasetFile } from "@/types/datasets";

// Step configuration
const STEP_CONFIG: Record<
  WizardStep,
  { title: string; description: string; icon: React.ReactNode }
> = {
  source: {
    title: "Select Source",
    description: "Choose how to add your dataset",
    icon: <FolderOpen className="h-4 w-4" />,
  },
  files: {
    title: "Map Files",
    description: "Configure file roles and splits",
    icon: <Files className="h-4 w-4" />,
  },
  parsing: {
    title: "Parsing Options",
    description: "Configure CSV and data parsing",
    icon: <Settings2 className="h-4 w-4" />,
  },
  targets: {
    title: "Targets",
    description: "Configure target columns and task type",
    icon: <Target className="h-4 w-4" />,
  },
  preview: {
    title: "Preview",
    description: "Review and confirm dataset",
    icon: <Eye className="h-4 w-4" />,
  },
};

// Step indicator component
function StepIndicator() {
  const { state, goToStep } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(state.step);

  return (
    <div className="flex items-center gap-2 mb-4">
      {STEP_ORDER.map((step, index) => {
        const config = STEP_CONFIG[step];
        const isActive = step === state.step;
        const isCompleted = index < currentIndex;
        const isClickable = index <= currentIndex;

        return (
          <div key={step} className="flex items-center">
            {index > 0 && (
              <div
                className={`w-8 h-px mx-1 ${
                  isCompleted ? "bg-primary" : "bg-border"
                }`}
              />
            )}
            <button
              onClick={() => isClickable && goToStep(step)}
              disabled={!isClickable}
              className={`
                flex items-center gap-2 px-3 py-1.5 rounded-full text-sm
                transition-colors
                ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : isCompleted
                    ? "bg-primary/20 text-primary hover:bg-primary/30"
                    : "bg-muted text-muted-foreground"
                }
                ${isClickable ? "cursor-pointer" : "cursor-default"}
              `}
            >
              {isCompleted ? (
                <Check className="h-3 w-3" />
              ) : (
                <span className="w-4 text-center">{index + 1}</span>
              )}
              <span className="hidden sm:inline">{config.title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Data statistics display - shows shapes for train/test X/Y
function DataStats() {
  const { state, dispatch } = useWizard();
  const validationTriggeredRef = useRef(false);

  // Group files by type and split
  const xTrainFiles = state.files.filter(f => f.type === "X" && f.split === "train");
  const xTestFiles = state.files.filter(f => f.type === "X" && f.split === "test");
  const yTrainFiles = state.files.filter(f => f.type === "Y" && f.split === "train");
  const yTestFiles = state.files.filter(f => f.type === "Y" && f.split === "test");
  const xFiles = state.files.filter(f => f.type === "X");
  const yFiles = state.files.filter(f => f.type === "Y");

  // Check if we're in web mode (no filesystem access)
  const isWebMode = !state.basePath && state.fileBlobs.size > 0;

  // Trigger validation when files are detected (desktop mode only)
  const runValidation = useCallback(async () => {
    // Skip validation in web mode - files aren't accessible by path
    if (isWebMode) {
      // In web mode, use file info from the File objects or skip validation
      const shapes: Record<string, { num_rows?: number; num_columns?: number }> = {};
      for (const f of state.files.filter(f => f.type === "X" || f.type === "Y")) {
        // Use any pre-detected info if available
        if (f.num_rows && f.num_columns) {
          shapes[f.path] = { num_rows: f.num_rows, num_columns: f.num_columns };
        }
      }
      if (Object.keys(shapes).length > 0) {
        dispatch({ type: "SET_VALIDATED_SHAPES", payload: shapes });
      }
      return;
    }

    if (!state.basePath || state.files.length === 0 || state.isValidating) return;

    // Only validate X and Y files
    const filesToValidate = state.files.filter(f => f.type === "X" || f.type === "Y");
    if (filesToValidate.length === 0) return;

    dispatch({ type: "SET_VALIDATING", payload: true });

    try {
      const result = await validateFiles(state.basePath, filesToValidate, state.parsing);

      if (result.error) {
        dispatch({ type: "SET_VALIDATION_ERROR", payload: result.error });
      } else {
        dispatch({ type: "SET_VALIDATED_SHAPES", payload: result.shapes });
      }
    } catch (error) {
      dispatch({
        type: "SET_VALIDATION_ERROR",
        payload: error instanceof Error ? error.message : "Failed to validate files",
      });
    }
  }, [state.basePath, state.files, state.parsing, state.isValidating, isWebMode, dispatch]);

  // Auto-validate when files change (but only once per file set)
  useEffect(() => {
    const hasXFiles = state.files.some(f => f.type === "X");
    const hasValidatedShapes = Object.keys(state.validatedShapes).length > 0;

    if (hasXFiles && !hasValidatedShapes && !state.isValidating && !state.validationError && !validationTriggeredRef.current) {
      validationTriggeredRef.current = true;
      runValidation();
    }
  }, [state.files, state.validatedShapes, state.isValidating, state.validationError, runValidation]);

  // Reset trigger when files change
  useEffect(() => {
    validationTriggeredRef.current = false;
  }, [state.files]);

  // Helper to get shape from validated shapes
  const getShape = (filePath: string) => {
    return state.validatedShapes[filePath];
  };

  // Calculate shapes from validated data
  const getGroupShape = (files: typeof xTrainFiles) => {
    let totalRows = 0;
    let cols = 0;
    let hasError = false;

    for (const f of files) {
      const shape = getShape(f.path);
      if (shape?.error) {
        hasError = true;
      } else if (shape?.num_rows && shape?.num_columns) {
        totalRows += shape.num_rows;
        if (cols === 0) cols = shape.num_columns;
      }
    }

    return { rows: totalRows, cols, hasError };
  };

  const xTrainShape = getGroupShape(xTrainFiles);
  const xTestShape = getGroupShape(xTestFiles);
  const yTrainShape = getGroupShape(yTrainFiles);
  const yTestShape = getGroupShape(yTestFiles);

  // Check for any validation errors
  const hasAnyError = state.validationError ||
    xTrainShape.hasError || xTestShape.hasError ||
    yTrainShape.hasError || yTestShape.hasError;

  // Loading states
  if (state.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 px-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Detecting files...</span>
      </div>
    );
  }

  if (state.isValidating) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 px-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading files...</span>
      </div>
    );
  }

  // No files yet
  if (state.files.length === 0) {
    return null;
  }

  // If no X files mapped yet
  if (xFiles.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-600 mb-4 px-1">
        <span>No X files mapped - select file roles below</span>
      </div>
    );
  }

  // Global validation error (only show in desktop mode)
  if (state.validationError && !isWebMode) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive mb-4 px-2 py-2 bg-destructive/10 rounded-md">
        <span>Error loading files: {state.validationError}</span>
      </div>
    );
  }

  // Helper to format shape, pending state, or file count
  const formatShape = (shape: { rows: number; cols: number; hasError: boolean }, files: typeof xTrainFiles, rowsOverride?: number) => {
    if (shape.hasError && !isWebMode) {
      return <span className="text-destructive">Error</span>;
    }
    const rows = rowsOverride ?? shape.rows;
    if (rows > 0 && shape.cols > 0) {
      return <span className="text-foreground">({rows}, {shape.cols})</span>;
    }
    // In web mode or when validation is pending, show file count
    if (files.length > 0) {
      return <span className="text-muted-foreground">{files.length} file{files.length !== 1 ? "s" : ""}</span>;
    }
    return <span className="text-muted-foreground">?</span>;
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-4 px-2 py-2 bg-muted/30 rounded-md font-mono">
      {/* Train shapes */}
      {(xTrainFiles.length > 0 || yTrainFiles.length > 0) && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground font-sans">Train:</span>
          {xTrainFiles.length > 0 && (
            <span>
              <span className="text-primary">X</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(xTrainShape, xTrainFiles)}
            </span>
          )}
          {yTrainFiles.length > 0 && (
            <span>
              <span className="text-primary">Y</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(yTrainShape, yTrainFiles, xTrainShape.rows)}
            </span>
          )}
        </div>
      )}

      {/* Test shapes */}
      {(xTestFiles.length > 0 || yTestFiles.length > 0) && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground font-sans">Test:</span>
          {xTestFiles.length > 0 && (
            <span>
              <span className="text-primary">X</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(xTestShape, xTestFiles)}
            </span>
          )}
          {yTestFiles.length > 0 && (
            <span>
              <span className="text-primary">Y</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(yTestShape, yTestFiles, xTestShape.rows)}
            </span>
          )}
        </div>
      )}

      {/* Fallback if no train/test split */}
      {xTrainFiles.length === 0 && xTestFiles.length === 0 && xFiles.length > 0 && (
        <span className="text-muted-foreground font-sans">
          {xFiles.length} X file{xFiles.length !== 1 ? "s" : ""}
          {yFiles.length > 0 && `, ${yFiles.length} Y file${yFiles.length !== 1 ? "s" : ""}`}
        </span>
      )}

      {/* Signal type if detected */}
      {state.parsing.signal_type && state.parsing.signal_type !== "auto" && (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground font-sans">{state.parsing.signal_type}</span>
        </>
      )}

      {/* Fold file indicator */}
      {state.hasFoldFile && (
        <>
          <span className="text-border">|</span>
          <span className="text-primary font-sans">folds</span>
        </>
      )}
    </div>
  );
}

// Wizard content component
interface WizardContentProps {
  onAdd: (path: string, config: Partial<DatasetConfig>) => Promise<void>;
  onClose: () => void;
  onScanFolder?: (path: string) => void;
}

function WizardContent({ onAdd, onClose, onScanFolder }: WizardContentProps) {
  const { state, dispatch, nextStep, prevStep, canProceed } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(state.step);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === STEP_ORDER.length - 1;
  const stepConfig = STEP_CONFIG[state.step];
  const hasDetectedFiles = useRef(false);

  // Auto-detect files when initialized from drop with a folder path but no files
  useEffect(() => {
    const shouldDetectFiles =
      state.sourceType === "folder" &&
      state.basePath &&
      state.files.length === 0 &&
      state.isLoading &&
      !hasDetectedFiles.current;

    if (shouldDetectFiles) {
      hasDetectedFiles.current = true;
      (async () => {
        try {
          const result = await detectUnified({ path: state.basePath, recursive: true });
          dispatch({ type: "SET_FILES", payload: result.files });
          // Store detection results including parsing options and confidence
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
        } catch (error) {
          console.warn("Auto-detection failed:", error);
          dispatch({ type: "SET_FILES", payload: [] });
        } finally {
          dispatch({ type: "SET_LOADING", payload: false });
        }
      })();
    }
  }, [state.sourceType, state.basePath, state.files.length, state.isLoading, dispatch]);

  const handleSubmit = async () => {
    if (!state.basePath) return;

    dispatch({ type: "SET_LOADING", payload: true });

    try {
      // Build configuration from wizard state
      const files: DatasetFile[] = state.files
        .filter((f) => f.type !== "unknown")
        .map((f) => ({
          path: f.path,
          type: f.type as "X" | "Y" | "metadata",
          split: f.split === "unknown" ? "train" : f.split,
          source: f.source,
          overrides: state.perFileOverrides[f.path],
        }));

      const config: Partial<DatasetConfig> = {
        delimiter: state.parsing.delimiter,
        decimal_separator: state.parsing.decimal_separator,
        has_header: state.parsing.has_header,
        header_unit: state.parsing.header_unit,
        signal_type: state.parsing.signal_type,
        na_policy: state.parsing.na_policy,
        files,
        global_params: state.parsing,
        targets: state.targets,
        default_target: state.defaultTarget,
        task_type: state.taskType,
        aggregation: state.aggregation,
      };

      await onAdd(state.basePath, config);
      onClose();
    } catch (error) {
      console.error("Failed to add dataset:", error);
      dispatch({
        type: "SET_ERROR",
        payload: {
          key: "submit",
          message: error instanceof Error ? error.message : "Failed to add dataset",
        },
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

  // Render current step
  const renderStep = () => {
    switch (state.step) {
      case "source":
        return <SourceStep onScanFolder={onScanFolder ? (path) => { onClose(); onScanFolder(path); } : undefined} />;
      case "files":
        return <FileMappingStep />;
      case "parsing":
        return <ParsingStep />;
      case "targets":
        return <TargetsStep />;
      case "preview":
        return <PreviewStep />;
      default:
        return null;
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {stepConfig.icon}
          {stepConfig.title}
        </DialogTitle>
        <DialogDescription>{stepConfig.description}</DialogDescription>
      </DialogHeader>

      <StepIndicator />
      <DataStats />

      <div className="flex-1 overflow-y-auto flex flex-col min-h-[400px]">
        {renderStep()}
      </div>

      {state.errors.submit && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive rounded-md text-sm">
          {state.errors.submit}
        </div>
      )}

      <DialogFooter className="gap-2 sm:gap-0 mt-4">
        {/* Back button */}
        {!isFirstStep && (
          <Button
            variant="ghost"
            onClick={prevStep}
            disabled={state.isLoading}
            className="mr-auto"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        )}

        {/* Cancel button */}
        <Button variant="outline" onClick={onClose} disabled={state.isLoading}>
          Cancel
        </Button>

        {/* Next/Submit button */}
        {isLastStep ? (
          <Button
            onClick={handleSubmit}
            disabled={state.isLoading || !canProceed()}
          >
            {state.isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add Dataset
          </Button>
        ) : (
          <Button
            onClick={nextStep}
            disabled={state.isLoading || !canProceed()}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

// Main export - wrapped in provider
interface DatasetWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (path: string, config?: Partial<DatasetConfig>) => Promise<void>;
  /** Initial state from drag-and-drop */
  initialState?: WizardInitialState;
  /** Callback to open batch scan dialog from wizard source step */
  onScanFolder?: (path: string) => void;
}

export function DatasetWizard({ open, onOpenChange, onAdd, initialState, onScanFolder }: DatasetWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <WizardProvider initialState={initialState}>
          <WizardContent onAdd={onAdd} onClose={() => onOpenChange(false)} onScanFolder={onScanFolder} />
        </WizardProvider>
      </DialogContent>
    </Dialog>
  );
}

// Re-export types for convenience
export type { WizardInitialState };

// Also export the old modal for backwards compatibility
export { AddDatasetModal } from "../AddDatasetModal";
