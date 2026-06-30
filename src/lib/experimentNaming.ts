import {
  CURRENT_EDITED_PIPELINE_ID,
  type CurrentEditedPipeline,
  type ExperimentPipelineOption,
} from "./experimentPipelineSelection";

export interface BuildAutoExperimentNameInput {
  selectedDatasetIds: string[];
  selectedPipelineIds: string[];
  datasetsById: Map<string, { name: string }>;
  pipelines: ExperimentPipelineOption[];
  currentEditedPipeline: CurrentEditedPipeline | null;
}

function summarizeNames(names: string[]): string {
  return names.length === 1
    ? names[0]
    : names.map((name) => name.slice(0, 4)).join("_");
}

export function buildAutoExperimentName({
  selectedDatasetIds,
  selectedPipelineIds,
  datasetsById,
  pipelines,
  currentEditedPipeline,
}: BuildAutoExperimentNameInput): string {
  const datasetNames = selectedDatasetIds
    .map((id) => datasetsById.get(id)?.name)
    .filter((name): name is string => Boolean(name));
  const pipelineNames = selectedPipelineIds
    .map((id) => id === CURRENT_EDITED_PIPELINE_ID
      ? currentEditedPipeline?.name
      : pipelines.find((pipeline) => pipeline.id === id)?.name)
    .filter((name): name is string => Boolean(name));

  if (!datasetNames.length || !pipelineNames.length) return "";
  return `${summarizeNames(datasetNames)} x ${summarizeNames(pipelineNames)}`;
}
