// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  exportSelectionToCsv,
  exportSelectionsToJson,
  importSelectionFromCsv,
  importSelectionsFromJson,
} from '@/lib/playground/exportSelectionFiles';
import type { SavedSelection } from '@/context/useSelection';

/** Capture the Blob handed to the browser download so we can assert its contents. */
let downloadedBlobs: Blob[] = [];

beforeEach(() => {
  downloadedBlobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    downloadedBlobs.push(blob as Blob);
    return 'blob:mock';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const selection: SavedSelection = {
  id: 'sel-1',
  name: 'Selection A',
  indices: [0, 2, 9],
  color: '#3b82f6',
  createdAt: new Date('2026-06-01T10:00:00.000Z'),
};

describe('exportSelectionsToJson', () => {
  it('downloads a timestamped JSON file and reports its size', () => {
    const result = exportSelectionsToJson([selection], {
      filename: 'selections',
      sampleIds: ['s0', 's1', 's2'],
    });

    expect(result.success).toBe(true);
    expect(result.format).toBe('json');
    expect(result.filename).toMatch(/^selections_\d{8}_\d{6}\.json$/);
    expect(result.size).toBeGreaterThan(0);
    expect(downloadedBlobs).toHaveLength(1);
    expect(downloadedBlobs[0].type).toBe('application/json;charset=utf-8');
  });

  it('honors includeTimestamp=false for the filename', () => {
    const result = exportSelectionsToJson([selection], {
      filename: 'selections',
      includeTimestamp: false,
    });

    expect(result.filename).toBe('selections.json');
  });

  it('serializes the payload mapping indices to sample IDs', async () => {
    exportSelectionsToJson([selection], {
      filename: 'selections',
      includeTimestamp: false,
      sampleIds: ['s0', 's1', 's2'],
      includeBoth: true,
    });

    const payload = JSON.parse(await downloadedBlobs[0].text());
    expect(payload.version).toBe('2.0');
    expect(payload.hasSampleIds).toBe(true);
    expect(payload.selections[0].sampleIds).toEqual(['s0', 's2']);
    expect(payload.selections[0].indices).toEqual([0, 2, 9]);
  });
});

describe('exportSelectionToCsv', () => {
  it('downloads a CSV file using sample IDs when provided', async () => {
    const result = exportSelectionToCsv([0, 2, 5], {
      filename: 'selection',
      includeTimestamp: false,
      sampleIds: ['s0', 's1', 's2'],
    });

    expect(result.success).toBe(true);
    expect(result.format).toBe('csv');
    expect(result.filename).toBe('selection.csv');
    expect(await downloadedBlobs[0].text()).toBe(['sample_id', 's0', 's2', ''].join('\n'));
  });
});

describe('importSelectionsFromJson', () => {
  it('delegates to the pure parser and maps sample IDs to indices', () => {
    const result = importSelectionsFromJson(
      JSON.stringify({
        selections: [{ name: 'Imported', sampleIds: ['s2', 'missing'], color: '#ef4444' }],
      }),
      ['s1', 's2'],
    );

    expect(result.selections).toHaveLength(1);
    expect(result.selections[0].indices).toEqual([1]);
    expect(result.unmappedCount).toBe(1);
    expect(result.warnings).toEqual(['Selection "Imported": 1 sample IDs could not be mapped']);
  });

  it('throws on malformed JSON, matching the pure parser contract', () => {
    expect(() => importSelectionsFromJson('not json')).toThrow(/Failed to parse selections/);
  });
});

describe('importSelectionFromCsv', () => {
  it('delegates to the pure parser, preferring indices and falling back to sample IDs', () => {
    expect(
      importSelectionFromCsv(['index,sample_id', ',s2', '5,s1', ',missing'].join('\n'), ['s1', 's2']),
    ).toEqual({
      indices: [1, 5],
      warnings: ['1 sample IDs could not be mapped to indices'],
      unmappedCount: 1,
    });
  });
});
