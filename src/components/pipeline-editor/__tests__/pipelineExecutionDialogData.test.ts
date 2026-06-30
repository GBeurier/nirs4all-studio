import { describe, expect, it } from 'vitest';
import {
  buildDefaultRunName,
  buildInlinePipeline,
  buildPipelineExecutionCampaignSpec,
  buildPipelineExecutionPlanPreview,
  buildRuntimeGroupingDatasetPayload,
  buildSplitGroupByByDataset,
  canLaunchPipelineExecution,
  derivePipelineExecutionViewState,
  ensureDatasetGroupByEntry,
  getLaunchRunName,
  getPipelineExecutionSplitGroupBy,
} from '../pipelineExecutionDialogData';
import type { PipelineStep } from '../types';

describe('pipelineExecutionDialogData', () => {
  it('builds default and submitted run names', () => {
    expect(buildDefaultRunName('PLS baseline')).toBe('PLS baseline Run');
    expect(getLaunchRunName('  Custom run  ', 'PLS baseline')).toBe('Custom run');
    expect(getLaunchRunName('   ', 'PLS baseline')).toBe('PLS baseline Run');
  });

  it('builds split group-by payloads and preserves existing dataset entries', () => {
    expect(buildSplitGroupByByDataset('dataset-1', 'batch')).toEqual({ 'dataset-1': 'batch' });
    expect(buildSplitGroupByByDataset('dataset-1', null)).toEqual({ 'dataset-1': null });

    const current = { 'dataset-1': 'batch' };
    expect(ensureDatasetGroupByEntry(current, 'dataset-1')).toBe(current);
    expect(ensureDatasetGroupByEntry(current, 'dataset-2')).toEqual({
      'dataset-1': 'batch',
      'dataset-2': null,
    });
  });

  it('builds inline pipeline payloads only when steps are available', () => {
    const steps: PipelineStep[] = [
      {
        id: 'step-1',
        type: 'preprocessing',
        name: 'SNV',
        params: {},
      },
    ];

    expect(buildInlinePipeline('Pipeline', steps)).toEqual({ name: 'Pipeline', steps });
    expect(buildInlinePipeline('Pipeline')).toBeUndefined();
  });

  it('projects a single pipeline execution into a campaign spec', () => {
    const steps: PipelineStep[] = [
      {
        id: 'step-1',
        type: 'preprocessing',
        name: 'SNV',
        params: {},
      },
      {
        id: 'step-2',
        type: 'model',
        name: 'PLSRegression',
        params: {},
      },
    ];

    const campaign = buildPipelineExecutionCampaignSpec({
      name: 'Corn quick run',
      datasetId: 'dataset-1',
      datasetName: 'Corn',
      pipelineId: 'pipeline-1',
      pipelineName: 'PLS baseline',
      selectedGroupBy: 'batch',
      steps,
      executionBackend: 'cluster',
    });

    expect(campaign).toMatchObject({
      name: 'Corn quick run',
      mode: 'legacy_cartesian',
      executionBackend: 'cluster',
      datasets: [
        {
          id: 'dataset-1',
          name: 'Corn',
          splitGroupBy: 'batch',
        },
      ],
      pipelines: [
        {
          id: 'pipeline-1',
          name: 'PLS baseline',
          source: 'inline',
          stepCount: 2,
          stepSummary: 'SNV \u2192 PLSRegression',
        },
      ],
      runMatrix: [
        {
          id: 'dataset-1::pipeline-1',
          datasetId: 'dataset-1',
          pipelineId: 'pipeline-1',
          datasetIndex: 0,
          pipelineIndex: 0,
          splitGroupBy: 'batch',
        },
      ],
    });
  });

  it('returns no execution campaign until a dataset is selected', () => {
    expect(buildPipelineExecutionCampaignSpec({
      name: 'Draft',
      datasetId: '',
      pipelineId: 'pipeline-1',
      pipelineName: 'PLS baseline',
    })).toBeNull();
  });

  it('builds single-run execution plan preview labels', () => {
    const campaign = buildPipelineExecutionCampaignSpec({
      name: 'Corn quick run',
      datasetId: 'dataset-1',
      pipelineId: 'pipeline-1',
      pipelineName: 'PLS baseline',
      selectedGroupBy: null,
    });

    expect(buildPipelineExecutionPlanPreview(campaign)).toEqual({
      backendLabel: 'Local Python',
      inputCardinalityLabel: '1 dataset x 1 pipeline',
      matrixCoverageLabel: '1 run planned from 1 possible pair',
      pipelineSourceLabel: 'Saved pipeline',
      runCountLabel: '1 run',
      splitGroupByLabel: 'no runtime grouping',
    });
    expect(buildPipelineExecutionPlanPreview(null)).toBeNull();
  });

  it('reads the execution split grouping through the campaign helper', () => {
    const campaign = buildPipelineExecutionCampaignSpec({
      name: 'Corn quick run',
      datasetId: 'dataset-1',
      pipelineId: 'pipeline-1',
      pipelineName: 'PLS baseline',
      selectedGroupBy: 'batch',
    });

    expect(getPipelineExecutionSplitGroupBy(campaign)).toBe('batch');
    expect(getPipelineExecutionSplitGroupBy(null)).toBeNull();
  });

  it('projects dataset metadata into runtime grouping payloads', () => {
    expect(buildRuntimeGroupingDatasetPayload({
      id: 'dataset-1',
      metadataColumns: ['batch'],
      repetitionColumn: 'replicate',
    })).toEqual({
      metadata_columns: ['batch'],
      config: {
        repetition: 'replicate',
        aggregation: {
          enabled: true,
          column: 'replicate',
          method: 'mean',
        },
      },
    });

    expect(buildRuntimeGroupingDatasetPayload({ id: 'dataset-2' })).toEqual({
      metadata_columns: [],
      config: {
        repetition: undefined,
        aggregation: undefined,
      },
    });
  });

  it('derives dialog view-state from execution status and quick-run flag', () => {
    expect(derivePipelineExecutionViewState({ status: 'idle', isQuickRunning: false })).toEqual({
      canClose: true,
      executionInputsDisabled: false,
    });

    // Running is a background job: the dialog can still close, but inputs lock.
    expect(derivePipelineExecutionViewState({ status: 'running', isQuickRunning: false })).toEqual({
      canClose: true,
      executionInputsDisabled: true,
    });

    // Starting blocks both closing and editing until the job is confirmed.
    expect(derivePipelineExecutionViewState({ status: 'starting', isQuickRunning: false })).toEqual({
      canClose: false,
      executionInputsDisabled: true,
    });

    // A quick run in progress blocks closing without locking the (idle) inputs.
    expect(derivePipelineExecutionViewState({ status: 'idle', isQuickRunning: true })).toEqual({
      canClose: false,
      executionInputsDisabled: false,
    });

    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      expect(derivePipelineExecutionViewState({ status, isQuickRunning: false })).toEqual({
        canClose: true,
        executionInputsDisabled: false,
      });
    }
  });

  it('keeps launch eligibility independent from component state', () => {
    expect(canLaunchPipelineExecution({
      selectedDataset: 'dataset-1',
      isLoadingPipeline: false,
      hasPersistedGroupConflict: false,
      hasBlockingGroupingError: false,
    })).toBe(true);
    expect(canLaunchPipelineExecution({
      selectedDataset: '',
      isLoadingPipeline: false,
      hasPersistedGroupConflict: false,
    })).toBe(false);
    expect(canLaunchPipelineExecution({
      selectedDataset: 'dataset-1',
      isLoadingPipeline: true,
      hasPersistedGroupConflict: false,
    })).toBe(false);
    expect(canLaunchPipelineExecution({
      selectedDataset: 'dataset-1',
      isLoadingPipeline: false,
      hasPersistedGroupConflict: true,
    })).toBe(false);
    expect(canLaunchPipelineExecution({
      selectedDataset: 'dataset-1',
      isLoadingPipeline: false,
      hasPersistedGroupConflict: false,
      hasBlockingGroupingError: true,
    })).toBe(false);
  });
});
