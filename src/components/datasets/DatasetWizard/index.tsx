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
import { useEffect } from "react";
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
import { WizardProvider, useWizard, STEP_ORDER } from "./WizardContext";
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
    <div className="flex items-center gap-2 mb-6">
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

// Wizard content component
interface WizardContentProps {
  onAdd: (path: string, config: Partial<DatasetConfig>) => Promise<void>;
  onClose: () => void;
}

function WizardContent({ onAdd, onClose }: WizardContentProps) {
  const { state, dispatch, nextStep, prevStep, canProceed } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(state.step);
  const isFirstStep = currentIndex === 0;
  const isLastStep = currentIndex === STEP_ORDER.length - 1;
  const stepConfig = STEP_CONFIG[state.step];

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
        return <SourceStep />;
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

      <div className="flex-1 overflow-hidden flex flex-col min-h-[400px]">
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
}

export function DatasetWizard({ open, onOpenChange, onAdd }: DatasetWizardProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <WizardProvider>
          <WizardContent onAdd={onAdd} onClose={() => onOpenChange(false)} />
        </WizardProvider>
      </DialogContent>
    </Dialog>
  );
}

// Also export the old modal for backwards compatibility
export { AddDatasetModal } from "../AddDatasetModal";
