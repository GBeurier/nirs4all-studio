import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import type { ExperimentConfig, RunExecutionBackend } from "@/types/runs";

import {
  CURRENT_EDITED_PIPELINE_ID,
  type SelectedPipelineConfig,
} from "./experimentPipelineSelection";
import {
  pruneUnavailableSteps,
  type MissingOperatorIssue,
} from "./pipelineOperatorAvailability";

export interface BuildExperimentLaunchConfigInput {
  name: string;
  description?: string;
  selectedDatasetIds: string[];
  selectedPipelineConfigs: SelectedPipelineConfig[];
  selectedGroupingPayload: Record<string, string | null>;
  missingIssues?: MissingOperatorIssue[];
  executionBackend?: RunExecutionBackend;
}

export function buildExperimentLaunchConfig({
  name,
  description,
  selectedDatasetIds,
  selectedPipelineConfigs,
  selectedGroupingPayload,
  missingIssues = [],
  executionBackend = "local-python",
}: BuildExperimentLaunchConfigInput): ExperimentConfig {
  const issuesByPipelineId = new Map<string, MissingOperatorIssue[]>();
  const issuesByPipelineName = new Map<string, MissingOperatorIssue[]>();

  for (const issue of missingIssues) {
    const pipelineId = issue.details?.pipeline_id;
    const pipelineName = issue.details?.pipeline_name;
    if (pipelineId) {
      const bucket = issuesByPipelineId.get(pipelineId) ?? [];
      bucket.push(issue);
      issuesByPipelineId.set(pipelineId, bucket);
    }
    if (pipelineName) {
      const bucket = issuesByPipelineName.get(pipelineName) ?? [];
      bucket.push(issue);
      issuesByPipelineName.set(pipelineName, bucket);
    }
  }

  const pipelineIds: string[] = [];
  const inlinePipelines: Array<{ name: string; steps: unknown[] }> = [];

  for (const pipeline of selectedPipelineConfigs) {
    const pipelineIssues =
      issuesByPipelineId.get(pipeline.id) ??
      issuesByPipelineName.get(pipeline.name) ??
      [];

    if (pipelineIssues.length === 0) {
      if (pipeline.id === CURRENT_EDITED_PIPELINE_ID) {
        inlinePipelines.push({ name: pipeline.name, steps: pipeline.steps });
      } else {
        pipelineIds.push(pipeline.id);
      }
      continue;
    }

    const pruned = pruneUnavailableSteps(
      pipeline.steps as EditorPipelineStep[],
      pipelineIssues,
    );
    if (pruned.steps.length === 0) {
      throw new Error(`Pipeline "${pipeline.name}" would be empty after removing unavailable nodes.`);
    }

    inlinePipelines.push({
      name: pipeline.name,
      steps: pruned.steps,
    });
  }

  const [inlinePipeline, ...additionalInlinePipelines] = inlinePipelines;

  const config: ExperimentConfig = {
    name,
    description: description || undefined,
    dataset_ids: selectedDatasetIds,
    pipeline_ids: pipelineIds,
    inline_pipeline: inlinePipeline,
    inline_pipelines: additionalInlinePipelines,
    split_group_by_by_dataset: selectedGroupingPayload,
  };

  if (executionBackend !== "local-python") {
    config.execution_backend = executionBackend;
  }

  return config;
}
