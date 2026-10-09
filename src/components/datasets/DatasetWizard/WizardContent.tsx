import { useEffect, useLayoutEffect, useRef, useCallback, type ReactNode } from "react";
import i18n from "i18next";
import { useTranslation } from "react-i18next";
import { detectUnified, validateFiles, type FileShapeInfo } from "@/api/datasets";
import {
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
import { getDetectedFileOverrides, useWizard, STEP_ORDER } from "./useWizard";
import { SourceStep } from "./SourceStep";
import { FileMappingStep } from "./FileMappingStep";
import { ParsingStep } from "./ParsingStep";
import { TargetsStep } from "./TargetsStep";
import { PreviewStep } from "./PreviewStep";
import { buildDatasetWizardConfig, buildDatasetWizardFiles } from "./DatasetWizardConfig";
import type { WizardStep, DatasetConfig } from "@/types/datasets";

const STEP_CONFIG: Record<WizardStep, { icon: ReactNode }> = {
  source: {
    icon: <FolderOpen className="h-4 w-4" />,
  },
  files: {
    icon: <Files className="h-4 w-4" />,
  },
  parsing: {
    icon: <Settings2 className="h-4 w-4" />,
  },
  targets: {
    icon: <Target className="h-4 w-4" />,
  },
  preview: {
    icon: <Eye className="h-4 w-4" />,
  },
};

function StepIndicator() {
  const { t } = useTranslation();
  const { state, goToStep } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(state.step);

  return (
    <div className="flex items-center gap-2 mb-4">
      {STEP_ORDER.map((step, index) => {
        const title = t(`datasets.wizard.steps.${step}.title`);
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
              aria-label={title}
              aria-current={isActive ? "step" : undefined}
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
              <span className="hidden sm:inline">{title}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function DataStats() {
  const { t } = useTranslation();
  const { state, dispatch, beginInspection } = useWizard();
  const validatedFiles = useRef(new Map<string, { key: string; shape: FileShapeInfo }>());
  const configuredFiles = buildDatasetWizardFiles(state);
  const validationKeys = new Map(configuredFiles.map(file => [file.path, JSON.stringify({
    basePath: state.basePath, path: file.path, type: file.type, parsing: file.overrides,
  }, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value)]));
  const validationKey = JSON.stringify([...validationKeys]);

  const xTrainFiles = state.files.filter(f => f.type === "X" && f.split === "train");
  const xTestFiles = state.files.filter(f => f.type === "X" && f.split === "test");
  const yTrainFiles = state.files.filter(f => f.type === "Y" && f.split === "train");
  const yTestFiles = state.files.filter(f => f.type === "Y" && f.split === "test");
  const metadataTrainFiles = state.files.filter(f => f.type === "metadata" && f.split === "train");
  const metadataTestFiles = state.files.filter(f => f.type === "metadata" && f.split === "test");
  const xFiles = state.files.filter(f => f.type === "X");
  const yFiles = state.files.filter(f => f.type === "Y");
  const metadataFiles = state.files.filter(f => f.type === "metadata");

  const isWebMode = !state.basePath && state.fileBlobs.size > 0;

  // Register the prerequisite before the user can click Next on this frame.
  useLayoutEffect(() => {
    let cancelled = false;
    const files = state.files.filter(f => f.type === "X" || f.type === "Y" || f.type === "metadata");
    if (!files.length) {
      dispatch({ type: "SET_VALIDATED_SHAPES", payload: {} });
      dispatch({ type: "SET_DETECTION_RESULTS", payload: { metadataColumns: [] } });
      return;
    }
    if (isWebMode) {
      const shapes = Object.fromEntries(files.map(f => [f.path, {
        num_rows: f.num_rows, num_columns: f.num_columns,
      }]));
      dispatch({ type: "SET_VALIDATED_SHAPES", payload: shapes });
      return;
    }
    if (!state.basePath) {
      dispatch({ type: "SET_VALIDATING", payload: false });
      return;
    }
    const changedFiles = files.filter(file => validatedFiles.current.get(file.path)?.key !== validationKeys.get(file.path));
    const publishShapes = () => {
      const shapes = Object.fromEntries(files.flatMap(file => {
        const validated = validatedFiles.current.get(file.path);
        return validated && validated.key === validationKeys.get(file.path) ? [[file.path, validated.shape]] : [];
      }));
      dispatch({ type: "SET_VALIDATED_SHAPES", payload: shapes });
      const metadataColumns = [...new Set(files.filter(file => file.type === "metadata")
        .flatMap(file => shapes[file.path]?.column_names ?? []))];
      dispatch({ type: "SET_DETECTION_RESULTS", payload: { metadataColumns } });
    };
    if (changedFiles.length === 0) {
      publishShapes();
      return;
    }
    dispatch({ type: "SET_VALIDATING", payload: true });
    const timer = setTimeout(async () => {
      const finishInspection = beginInspection();
      try {
        const overrides = Object.fromEntries(configuredFiles.filter(file => changedFiles.some(changed => changed.path === file.path))
          .map(file => [file.path, file.overrides ?? {}]));
        const result = await validateFiles(state.basePath, changedFiles, state.parsing, overrides);
        if (cancelled) return;
        if (result.error || !result.success) {
          dispatch({ type: "SET_VALIDATION_ERROR", payload: result.error || i18n.t("datasets.wizard.validateFailed") });
        } else {
          for (const file of changedFiles) {
            const shape = result.shapes[file.path];
            if (shape) validatedFiles.current.set(file.path, { key: validationKeys.get(file.path)!, shape });
          }
          publishShapes();
        }
      } catch (error) {
        if (!cancelled) dispatch({ type: "SET_VALIDATION_ERROR", payload:
          error instanceof Error ? error.message : i18n.t("datasets.wizard.validateFailed") });
      } finally {
        finishInspection();
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
    // The complete effective parsing key avoids re-reading on object replacement
    // and on split/source changes that cannot affect a file's table shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.basePath, validationKey, isWebMode, dispatch, beginInspection]);

  const getShape = (filePath: string) => {
    return state.validatedShapes[filePath];
  };

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
  const metaTrainShape = getGroupShape(metadataTrainFiles);
  const metaTestShape = getGroupShape(metadataTestFiles);

  if (state.isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 px-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{t("datasets.wizard.stats.detectingFiles")}</span>
      </div>
    );
  }

  if (state.isValidating) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4 px-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{t("datasets.wizard.stats.loadingFiles")}</span>
      </div>
    );
  }

  if (state.files.length === 0) {
    return null;
  }

  if (xFiles.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-600 mb-4 px-1">
        <span>{t("datasets.wizard.stats.noXFiles")}</span>
      </div>
    );
  }

  if (state.validationError && !isWebMode) {
    return (
      <div className="flex items-center gap-2 text-xs text-destructive mb-4 px-2 py-2 bg-destructive/10 rounded-md">
        <span>{t("datasets.wizard.stats.loadError", { error: state.validationError })}</span>
      </div>
    );
  }

  const formatShape = (shape: { rows: number; cols: number; hasError: boolean }, files: typeof xTrainFiles, rowsOverride?: number) => {
    if (shape.hasError && !isWebMode) {
      return <span className="text-destructive">{t("common.error")}</span>;
    }
    const rows = rowsOverride ?? shape.rows;
    if (rows > 0 && shape.cols > 0) {
      return <span className="text-foreground">({rows}, {shape.cols})</span>;
    }
    if (files.length > 0) {
      return <span className="text-muted-foreground">{t("datasets.wizard.stats.files", { count: files.length })}</span>;
    }
    return <span className="text-muted-foreground">?</span>;
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mb-4 px-2 py-2 bg-muted/30 rounded-md font-mono">
      {(xTrainFiles.length > 0 || yTrainFiles.length > 0 || metadataTrainFiles.length > 0) && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground font-sans">{t("datasets.wizard.stats.train")}</span>
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
          {metadataTrainFiles.length > 0 && (
            <span>
              <span className="text-purple-500">{t("datasets.wizard.stats.meta")}</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(metaTrainShape, metadataTrainFiles, xTrainShape.rows)}
            </span>
          )}
        </div>
      )}

      {(xTestFiles.length > 0 || yTestFiles.length > 0 || metadataTestFiles.length > 0) && (
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground font-sans">{t("datasets.wizard.stats.test")}</span>
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
          {metadataTestFiles.length > 0 && (
            <span>
              <span className="text-purple-500">{t("datasets.wizard.stats.meta")}</span>
              <span className="text-muted-foreground">=</span>
              {formatShape(metaTestShape, metadataTestFiles, xTestShape.rows)}
            </span>
          )}
        </div>
      )}

      {xTrainFiles.length === 0 && xTestFiles.length === 0 && xFiles.length > 0 && (
        <span className="text-muted-foreground font-sans">
          {t("datasets.wizard.stats.xFiles", { count: xFiles.length })}
          {yFiles.length > 0 && `, ${t("datasets.wizard.stats.yFiles", { count: yFiles.length })}`}
          {metadataFiles.length > 0 && `, ${t("datasets.wizard.stats.metaFiles", { count: metadataFiles.length })}`}
        </span>
      )}

      {state.parsing.signal_type && state.parsing.signal_type !== "auto" && (
        <>
          <span className="text-border">|</span>
          <span className="text-muted-foreground font-sans">{state.parsing.signal_type}</span>
        </>
      )}

      {state.hasFoldFile && (
        <>
          <span className="text-border">|</span>
          <span className="text-primary font-sans">{t("datasets.wizard.stats.folds")}</span>
        </>
      )}
    </div>
  );
}

interface WizardFooterProps {
  isFirstStep: boolean;
  isLastStep: boolean;
  isLoading: boolean;
  canProceed: () => boolean;
  onBack: () => void;
  onCancel: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitLabel: string;
}

function WizardFooter({
  isFirstStep,
  isLastStep,
  isLoading,
  canProceed,
  onBack,
  onCancel,
  onNext,
  onSubmit,
  submitLabel,
}: WizardFooterProps) {
  const { t } = useTranslation();
  return (
    <DialogFooter className="gap-2 sm:gap-0 mt-4">
      {!isFirstStep && (
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isLoading}
          className="mr-auto"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t("common.back")}
        </Button>
      )}

      <Button variant="outline" onClick={onCancel} disabled={isLoading}>
        {t("common.cancel")}
      </Button>

      {isLastStep ? (
        <Button
          onClick={onSubmit}
          disabled={isLoading || !canProceed()}
        >
          {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      ) : (
        <Button
          onClick={onNext}
          disabled={isLoading || !canProceed()}
        >
          {t("common.next")}
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      )}
    </DialogFooter>
  );
}

interface WizardContentProps {
  onAdd: (path: string, config: Partial<DatasetConfig>, files?: File[]) => Promise<void>;
  onClose: () => void;
  onScanFolder?: (path: string) => void;
  submitLabel?: string;
  submitErrorMessage?: string;
}

export function WizardContent({ onAdd, onClose, onScanFolder, submitLabel, submitErrorMessage }: WizardContentProps) {
  const { t } = useTranslation();
  const { state, dispatch, nextStep, prevStep, canProceed } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(state.step);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === STEP_ORDER.length - 1;
  const stepConfig = STEP_CONFIG[state.step];
  const hasDetectedFiles = useRef(false);

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
          dispatch({
            type: "SET_DETECTION_RESULTS",
            payload: {
              parsing: result.parsing_options,
              hasFoldFile: result.has_fold_file,
              foldFilePath: result.fold_file_path,
              metadataColumns: result.metadata_columns,
              confidence: result.confidence,
              perFileOverrides: getDetectedFileOverrides(result.files),
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
    if (!state.basePath && state.fileBlobs.size === 0) return;

    dispatch({ type: "SET_LOADING", payload: true });

    try {
      const config: Partial<DatasetConfig> = buildDatasetWizardConfig(state);

      if (!state.basePath) {
        const files = (config.files ?? []).map(({ path }) => {
          const file = state.fileBlobs.get(path);
          if (!file) throw new Error(t("datasets.wizard.fileUnavailable", { path }));
          return file;
        });
        await onAdd("", config, [...new Set(files)]);
      } else {
        await onAdd(state.basePath, config);
      }
      onClose();
    } catch (error) {
      console.error("Failed to add dataset:", error);
      dispatch({
        type: "SET_ERROR",
        payload: {
          key: "submit",
          message: error instanceof Error ? error.message : (submitErrorMessage ?? t("datasets.wizard.submitFailed")),
        },
      });
    } finally {
      dispatch({ type: "SET_LOADING", payload: false });
    }
  };

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
          {t(`datasets.wizard.steps.${state.step}.title`)}
        </DialogTitle>
        <DialogDescription>{t(`datasets.wizard.steps.${state.step}.description`)}</DialogDescription>
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

      <WizardFooter
        isFirstStep={isFirstStep}
        isLastStep={isLastStep}
        isLoading={state.isLoading}
        canProceed={canProceed}
        onBack={prevStep}
        onCancel={onClose}
        onNext={nextStep}
        onSubmit={handleSubmit}
        submitLabel={submitLabel ?? t("datasets.addDataset")}
      />
    </>
  );
}
