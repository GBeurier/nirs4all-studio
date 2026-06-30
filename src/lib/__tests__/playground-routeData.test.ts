import { describe, expect, it } from 'vitest';

import {
  PLAYGROUND_PIPELINE_JSON_FILENAME,
  buildPlaygroundPipelineJsonExportPayload,
  buildPlaygroundSessionStatePayload,
  chartVisibilityToExecuteOptions,
  formatPlaygroundPipelineEditorExportName,
  formatPlaygroundPipelineJsonExportDescription,
  isPlaygroundSessionExpired,
  parsePipelineEditorImportData,
  parsePlaygroundRouteAction,
  parseStoredPlaygroundSessionState,
  shouldClearOwnPlaygroundExportData,
} from '@/lib/playground/playgroundRouteData';
import { DEFAULT_CHART_VISIBILITY, PLAYGROUND_SESSION_MAX_AGE_MS } from '@/lib/playground/sessionState';
import type { PlaygroundExportData } from '@/lib/playground/operatorFormat';
import type { UnifiedOperator } from '@/types/playground';

function operator(overrides: Partial<UnifiedOperator>): UnifiedOperator {
  return {
    id: 'op-1',
    name: 'SNV',
    type: 'preprocessing',
    params: {},
    enabled: true,
    ...overrides,
  };
}

function searchParams(values: Record<string, string | null>) {
  return {
    get(name: string): string | null {
      return values[name] ?? null;
    },
  };
}

describe('playground route data helpers', () => {
  it('derives backend execute options from chart visibility', () => {
    expect(chartVisibilityToExecuteOptions({
      pca: true,
      repetitions: false,
    })).toEqual({
      compute_pca: true,
      compute_repetitions: false,
    });
  });

  it('parses incoming route actions with dataset selection taking precedence', () => {
    expect(parsePlaygroundRouteAction(searchParams({
      source: 'pipeline-editor',
      datasetId: 'corn',
      datasetName: 'Corn',
    }))).toEqual({
      type: 'load-workspace-dataset',
      datasetId: 'corn',
      datasetName: 'Corn',
    });

    expect(parsePlaygroundRouteAction(searchParams({ source: 'pipeline-editor' }))).toEqual({
      type: 'import-from-pipeline-editor',
    });

    expect(parsePlaygroundRouteAction(searchParams({ datasetId: 'corn' }))).toEqual({
      type: 'none',
    });
  });

  it('builds pipeline JSON export payloads and labels', () => {
    const payload = buildPlaygroundPipelineJsonExportPayload([
      operator({ id: 'snv', name: 'SNV', type: 'preprocessing', params: { center: true } }),
      operator({ id: 'kfold', name: 'KFold', type: 'splitting', params: { n_splits: 5 } }),
      operator({ id: 'disabled', name: 'Disabled', enabled: false }),
    ], '2026-06-30T10:00:00.000Z');

    expect(payload).toEqual({
      name: 'Playground Export',
      description: 'Exported from Playground',
      pipeline: [
        { preprocessing: 'SNV', center: true },
        { split: 'KFold', n_splits: 5 },
      ],
      exported_at: '2026-06-30T10:00:00.000Z',
    });
    expect(PLAYGROUND_PIPELINE_JSON_FILENAME).toBe('playground-pipeline.json');
    expect(formatPlaygroundPipelineJsonExportDescription(2)).toBe('2 operators saved to playground-pipeline.json');
    expect(formatPlaygroundPipelineEditorExportName({
      toLocaleDateString: () => '6/30/2026',
    } as Date)).toBe('Playground Export 6/30/2026');
  });

  it('classifies pipeline editor import handoff payloads', () => {
    expect(parsePipelineEditorImportData(null)).toEqual({ status: 'missing' });

    const invalid = parsePipelineEditorImportData('{bad-json');
    expect(invalid.status).toBe('invalid');

    expect(parsePipelineEditorImportData('{"pipeline":[]}')).toEqual({ status: 'unsupported' });
    expect(parsePipelineEditorImportData('{"steps":[{"id":"snv","type":"preprocessing","name":"SNV","params":{}}]}')).toEqual({
      status: 'ready',
      steps: [{ id: 'snv', type: 'preprocessing', name: 'SNV', params: {} }],
    });
  });

  it('detects reverse playground exports that should be cleared instead of imported', () => {
    const playgroundExport: PlaygroundExportData = {
      name: 'Playground Export',
      steps: [],
      timestamp: 1000,
      source: 'playground',
    };

    expect(shouldClearOwnPlaygroundExportData(playgroundExport)).toBe(true);
    expect(shouldClearOwnPlaygroundExportData(null)).toBe(false);
  });

  it('parses stored session state and expires stale sessions', () => {
    const session = buildPlaygroundSessionStatePayload({
      datasetId: 'corn',
      datasetName: 'Corn',
      dataSource: 'workspace',
      chartVisibility: DEFAULT_CHART_VISIBILITY,
      renderMode: 'auto',
    }, 1000);

    expect(parseStoredPlaygroundSessionState(JSON.stringify(session), {
      now: 1000 + PLAYGROUND_SESSION_MAX_AGE_MS,
    })).toEqual({
      status: 'valid',
      session,
    });

    expect(parseStoredPlaygroundSessionState(JSON.stringify(session), {
      now: 1001 + PLAYGROUND_SESSION_MAX_AGE_MS,
    })).toEqual({ status: 'expired' });

    expect(parseStoredPlaygroundSessionState(null)).toEqual({ status: 'missing' });
    expect(parseStoredPlaygroundSessionState('{bad-json').status).toBe('invalid');
    expect(isPlaygroundSessionExpired({ savedAt: undefined }, 1000)).toBe(false);
  });
});
