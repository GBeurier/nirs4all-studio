import type {
  NewExperimentInputData,
  UseNewExperimentFilteredInputsResult,
} from "@/hooks/useNewExperimentInputData";
import type { NewExperimentExecutionEnvironmentDiagnostics } from "@/hooks/useNewExperimentExecutionEnvironment";
import type { UseNewExperimentLaunchFlowResult } from "@/hooks/useNewExperimentLaunchFlow";
import type { UseNewExperimentPlanFlowResult } from "@/hooks/useNewExperimentPlanFlow";
import type { UseNewExperimentSelectionFlowResult } from "@/hooks/useNewExperimentSelectionFlow";
import {
  NEW_EXPERIMENT_DATASETS_STEP,
  NEW_EXPERIMENT_LAUNCH_STEP,
  NEW_EXPERIMENT_PIPELINES_STEP,
  NEW_EXPERIMENT_REVIEW_STEP,
  NEW_EXPERIMENT_RUNTIME_GROUPING_STEP,
  type NewExperimentWizardStep,
} from "@/lib/experimentWizardFlow";
import {
  NewExperimentDatasetStepPanel,
  NewExperimentLaunchStepPanel,
  NewExperimentPipelineStepPanel,
  NewExperimentReviewStepPanel,
  NewExperimentRuntimeGroupingStepPanel,
} from "./NewExperimentStepContentPanels";

export interface NewExperimentStepContentProps {
  currentStep: NewExperimentWizardStep;
  customExperimentName: string;
  executionEnvironmentDiagnostics: NewExperimentExecutionEnvironmentDiagnostics;
  experimentDescription: string;
  filteredInputs: UseNewExperimentFilteredInputsResult;
  inputData: NewExperimentInputData;
  launchFlow: UseNewExperimentLaunchFlowResult;
  planFlow: UseNewExperimentPlanFlowResult;
  selectionFlow: UseNewExperimentSelectionFlowResult;
  onExperimentDescriptionChange: (value: string) => void;
  onExperimentNameChange: (value: string) => void;
}

export function NewExperimentStepContent({
  currentStep,
  customExperimentName,
  executionEnvironmentDiagnostics,
  experimentDescription,
  filteredInputs,
  inputData,
  launchFlow,
  planFlow,
  selectionFlow,
  onExperimentDescriptionChange,
  onExperimentNameChange,
}: NewExperimentStepContentProps) {
  if (currentStep === NEW_EXPERIMENT_PIPELINES_STEP) {
    return (
      <NewExperimentPipelineStepPanel
        filteredInputs={filteredInputs}
        inputData={inputData}
        selectionFlow={selectionFlow}
      />
    );
  }

  if (currentStep === NEW_EXPERIMENT_DATASETS_STEP) {
    return (
      <NewExperimentDatasetStepPanel
        filteredInputs={filteredInputs}
        inputData={inputData}
        selectionFlow={selectionFlow}
      />
    );
  }

  if (currentStep === NEW_EXPERIMENT_RUNTIME_GROUPING_STEP) {
    return (
      <NewExperimentRuntimeGroupingStepPanel
        planFlow={planFlow}
        selectionFlow={selectionFlow}
      />
    );
  }

  if (currentStep === NEW_EXPERIMENT_REVIEW_STEP) {
    return (
      <NewExperimentReviewStepPanel
        customExperimentName={customExperimentName}
        executionEnvironmentDiagnostics={executionEnvironmentDiagnostics}
        experimentDescription={experimentDescription}
        planFlow={planFlow}
        selectionFlow={selectionFlow}
        onExperimentDescriptionChange={onExperimentDescriptionChange}
        onExperimentNameChange={onExperimentNameChange}
      />
    );
  }

  if (currentStep === NEW_EXPERIMENT_LAUNCH_STEP) {
    return (
      <NewExperimentLaunchStepPanel
        executionEnvironmentDiagnostics={executionEnvironmentDiagnostics}
        experimentDescription={experimentDescription}
        launchFlow={launchFlow}
        planFlow={planFlow}
        selectionFlow={selectionFlow}
      />
    );
  }

  return null;
}
