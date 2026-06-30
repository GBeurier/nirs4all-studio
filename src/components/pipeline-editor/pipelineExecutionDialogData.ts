import type { ExecutionStatus } from '@/hooks/usePipelineExecution';
import type { DatasetGroupingFieldsInput } from '@/lib/datasetGroupingFields';
import type { PipelineStep as EditorPipelineStep } from './types';

export {
  buildPipelineExecutionCampaignSpec,
  buildPipelineExecutionPlanPreview,
  getPipelineExecutionSplitGroupBy,
} from '@/lib/campaignPipelineExecution';
export type {
  BuildPipelineExecutionCampaignSpecInput,
  PipelineExecutionPlanPreview,
} from '@/lib/campaignPipelineExecution';

export interface PipelineExecutionDatasetInfo {
  id: string;
  metadataColumns?: string[];
  repetitionColumn?: string | null;
}

export interface PipelineExecutionInlinePipeline {
  name: string;
  steps: unknown[];
}

export function buildDefaultRunName(pipelineName: string): string {
  return `${pipelineName} Run`;
}

export function getLaunchRunName(runName: string, pipelineName: string): string {
  return runName.trim() || buildDefaultRunName(pipelineName);
}

export function buildSplitGroupByByDataset(
  datasetId: string,
  selectedGroupBy?: string | null
): Record<string, string | null> {
  return {
    [datasetId]: selectedGroupBy ?? null,
  };
}

export function ensureDatasetGroupByEntry(
  current: Record<string, string | null>,
  datasetId: string
): Record<string, string | null> {
  return datasetId in current ? current : { ...current, [datasetId]: null };
}

export function buildInlinePipeline(
  name: string,
  steps?: unknown[] | EditorPipelineStep[]
): PipelineExecutionInlinePipeline | undefined {
  return steps ? { name, steps } : undefined;
}

export function buildRuntimeGroupingDatasetPayload(dataset: PipelineExecutionDatasetInfo): DatasetGroupingFieldsInput {
  return {
    metadata_columns: dataset.metadataColumns ?? [],
    config: {
      repetition: dataset.repetitionColumn ?? undefined,
      aggregation: dataset.repetitionColumn
        ? {
            enabled: true,
            column: dataset.repetitionColumn,
            method: 'mean' as const,
          }
        : undefined,
    },
  };
}

export interface PipelineExecutionViewState {
  /** Whether the dialog may be dismissed (blocked while a run is being started). */
  canClose: boolean;
  /** Whether run-configuration inputs should be locked because execution is in flight. */
  executionInputsDisabled: boolean;
}

export function derivePipelineExecutionViewState({
  status,
  isQuickRunning,
}: {
  status: ExecutionStatus;
  isQuickRunning: boolean;
}): PipelineExecutionViewState {
  return {
    canClose: status !== 'starting' && !isQuickRunning,
    executionInputsDisabled: status === 'running' || status === 'starting',
  };
}

export function canLaunchPipelineExecution({
  selectedDataset,
  isLoadingPipeline,
  hasPersistedGroupConflict,
  hasBlockingGroupingError,
}: {
  selectedDataset: string;
  isLoadingPipeline: boolean;
  hasPersistedGroupConflict: boolean;
  hasBlockingGroupingError?: boolean;
}): boolean {
  return (
    Boolean(selectedDataset) &&
    !isLoadingPipeline &&
    !hasPersistedGroupConflict &&
    !hasBlockingGroupingError
  );
}
