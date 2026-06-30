import type { RenderMode } from '@/lib/playground/renderOptimizer';
import {
  PLAYGROUND_SESSION_MAX_AGE_MS,
  type ChartVisibility,
  type PlaygroundSessionState,
} from '@/lib/playground/sessionState';
import {
  exportToPipelineEditor,
  type PipelineEditorStep,
} from '@/lib/playground/operatorFormat';
import type { ExecuteOptions, UnifiedOperator } from '@/types/playground';

export const PLAYGROUND_PIPELINE_JSON_FILENAME = 'playground-pipeline.json';
export const PLAYGROUND_PIPELINE_EXPORT_NAME = 'Playground Export';
export const PLAYGROUND_PIPELINE_EXPORT_DESCRIPTION = 'Exported from Playground';

export type PlaygroundRouteAction =
  | {
      type: 'load-workspace-dataset';
      datasetId: string;
      datasetName: string;
    }
  | { type: 'import-from-pipeline-editor' }
  | { type: 'none' };

export interface SearchParamReader {
  get(name: string): string | null;
}

export interface PlaygroundSessionPayloadInput {
  datasetId?: string | null;
  datasetName?: string | null;
  dataSource: PlaygroundSessionState['dataSource'];
  chartVisibility: ChartVisibility;
  renderMode: RenderMode;
}

export type PlaygroundSessionParseResult =
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'invalid'; error: unknown }
  | { status: 'valid'; session: PlaygroundSessionState };

export type PipelineEditorImportDataResult =
  | { status: 'missing' }
  | { status: 'invalid'; error: unknown }
  | { status: 'unsupported' }
  | { status: 'ready'; steps: PipelineEditorStep[] };

export interface PlaygroundPipelineJsonExportPayload {
  name: string;
  description: string;
  pipeline: Array<Record<string, unknown>>;
  exported_at: string;
}

export function chartVisibilityToExecuteOptions(
  chartVisibility: Pick<ChartVisibility, 'pca' | 'repetitions'>,
): Pick<ExecuteOptions, 'compute_pca' | 'compute_repetitions'> {
  return {
    compute_pca: chartVisibility.pca,
    compute_repetitions: chartVisibility.repetitions,
  };
}

export function parsePlaygroundRouteAction(searchParams: SearchParamReader): PlaygroundRouteAction {
  const source = searchParams.get('source');
  const datasetId = searchParams.get('datasetId');
  const datasetName = searchParams.get('datasetName');

  if (datasetId && datasetName) {
    return {
      type: 'load-workspace-dataset',
      datasetId,
      datasetName,
    };
  }

  if (source === 'pipeline-editor') {
    return { type: 'import-from-pipeline-editor' };
  }

  return { type: 'none' };
}

export function formatPlaygroundPipelineEditorExportName(date = new Date()): string {
  return `${PLAYGROUND_PIPELINE_EXPORT_NAME} ${date.toLocaleDateString()}`;
}

export function buildPlaygroundPipelineJsonExportPayload(
  operators: UnifiedOperator[],
  exportedAt = new Date().toISOString(),
): PlaygroundPipelineJsonExportPayload {
  const editorSteps = exportToPipelineEditor(operators);

  return {
    name: PLAYGROUND_PIPELINE_EXPORT_NAME,
    description: PLAYGROUND_PIPELINE_EXPORT_DESCRIPTION,
    pipeline: editorSteps.map(step => ({
      [step.type === 'splitting' ? 'split' : 'preprocessing']: step.name,
      ...step.params,
    })),
    exported_at: exportedAt,
  };
}

export function formatPlaygroundPipelineJsonExportDescription(
  operatorCount: number,
  filename = PLAYGROUND_PIPELINE_JSON_FILENAME,
): string {
  return `${operatorCount} operators saved to ${filename}`;
}

export function shouldClearOwnPlaygroundExportData(
  importData: { source?: unknown } | null,
): boolean {
  return importData?.source === 'playground';
}

export function parsePipelineEditorImportData(editorData: string | null): PipelineEditorImportDataResult {
  if (!editorData) {
    return { status: 'missing' };
  }

  try {
    const parsed = JSON.parse(editorData) as { steps?: unknown };
    if (parsed.steps && Array.isArray(parsed.steps)) {
      return {
        status: 'ready',
        steps: parsed.steps as PipelineEditorStep[],
      };
    }
    return { status: 'unsupported' };
  } catch (error) {
    return { status: 'invalid', error };
  }
}

export function isPlaygroundSessionExpired(
  session: { savedAt?: unknown },
  now = Date.now(),
  maxAgeMs = PLAYGROUND_SESSION_MAX_AGE_MS,
): boolean {
  return typeof session.savedAt === 'number' && now - session.savedAt > maxAgeMs;
}

export function parseStoredPlaygroundSessionState(
  stored: string | null,
  {
    maxAgeMs = PLAYGROUND_SESSION_MAX_AGE_MS,
    now = Date.now(),
  }: {
    maxAgeMs?: number;
    now?: number;
  } = {},
): PlaygroundSessionParseResult {
  if (!stored) {
    return { status: 'missing' };
  }

  try {
    const session = JSON.parse(stored) as PlaygroundSessionState;
    if (isPlaygroundSessionExpired(session, now, maxAgeMs)) {
      return { status: 'expired' };
    }
    return { status: 'valid', session };
  } catch (error) {
    return { status: 'invalid', error };
  }
}

export function buildPlaygroundSessionStatePayload(
  input: PlaygroundSessionPayloadInput,
  savedAt = Date.now(),
): PlaygroundSessionState {
  return {
    datasetId: input.datasetId || null,
    datasetName: input.datasetName || null,
    dataSource: input.dataSource,
    chartVisibility: input.chartVisibility,
    renderMode: input.renderMode,
    savedAt,
  };
}
