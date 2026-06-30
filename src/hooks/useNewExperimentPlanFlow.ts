import { useMemo } from "react";

import {
  buildNewExperimentPlanFlowState,
  type NewExperimentPlanFlowInput,
  type NewExperimentPlanFlowState,
} from "@/lib/newExperimentPlanFlow";

export type UseNewExperimentPlanFlowInput = NewExperimentPlanFlowInput;
export type UseNewExperimentPlanFlowResult = NewExperimentPlanFlowState;

export function useNewExperimentPlanFlow(input: UseNewExperimentPlanFlowInput): UseNewExperimentPlanFlowResult {
  const {
    datasets,
    rawPipelines,
    allPipelineOptions,
    currentEditedPipeline,
    selectedDatasetIds,
    selectedPipelineIds,
    splitGroupByByDataset,
    customExperimentName = "",
    experimentDescription = "",
    executionBackend = "local-python",
    availableExecutionAdapters,
    nativeBackendAvailability,
  } = input;

  return useMemo(() => buildNewExperimentPlanFlowState({
    datasets,
    rawPipelines,
    allPipelineOptions,
    currentEditedPipeline,
    selectedDatasetIds,
    selectedPipelineIds,
    splitGroupByByDataset,
    customExperimentName,
    experimentDescription,
    executionBackend,
    availableExecutionAdapters,
    nativeBackendAvailability,
  }), [
    allPipelineOptions,
    availableExecutionAdapters,
    currentEditedPipeline,
    customExperimentName,
    datasets,
    executionBackend,
    experimentDescription,
    nativeBackendAvailability,
    rawPipelines,
    selectedDatasetIds,
    selectedPipelineIds,
    splitGroupByByDataset,
  ]);
}
