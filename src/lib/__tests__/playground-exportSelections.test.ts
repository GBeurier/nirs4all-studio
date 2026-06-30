import { describe, expect, it } from 'vitest';

import {
  buildSelectionCsv,
  buildSelectionsExportPayload,
  parseSelectionCsv,
  parseSelectionsJson,
} from '@/lib/playground/exportSelections';
import type { SavedSelection } from '@/context/useSelection';

describe('playground selection export helpers', () => {
  it('builds JSON export payloads with mapped sample IDs and optional indices', () => {
    const selection: SavedSelection = {
      id: 'sel-1',
      name: 'Selection A',
      indices: [0, 2, 9],
      color: '#3b82f6',
      createdAt: new Date('2026-06-01T10:00:00.000Z'),
    };

    expect(buildSelectionsExportPayload([selection], {
      sampleIds: ['s0', 's1', 's2'],
      includeBoth: true,
      exportedAt: '2026-06-02T00:00:00.000Z',
    })).toEqual({
      version: '2.0',
      exportedAt: '2026-06-02T00:00:00.000Z',
      count: 1,
      hasSampleIds: true,
      selections: [{
        id: 'sel-1',
        name: 'Selection A',
        color: '#3b82f6',
        createdAt: '2026-06-01T10:00:00.000Z',
        sampleIds: ['s0', 's2'],
        indices: [0, 2, 9],
      }],
    });
  });

  it('builds selection CSV with sample IDs and blanks for out-of-range indices', () => {
    expect(buildSelectionCsv([0, 2, 5], {
      sampleIds: ['s0', 's1', 's2'],
    })).toBe([
      'sample_id',
      's0',
      's2',
      '',
    ].join('\n'));
  });

  it('imports JSON selections from sample IDs and reports unmapped IDs', () => {
    let idCounter = 0;
    const result = parseSelectionsJson(JSON.stringify({
      selections: [{
        name: 'Imported',
        sampleIds: ['s2', 'missing'],
        color: '#ef4444',
        createdAt: '2026-06-01T10:00:00.000Z',
      }],
    }), ['s1', 's2'], {
      createId: () => `generated-${++idCounter}`,
    });

    expect(result).toEqual({
      selections: [{
        id: 'generated-1',
        name: 'Imported',
        indices: [1],
        color: '#ef4444',
        createdAt: new Date('2026-06-01T10:00:00.000Z'),
      }],
      warnings: ['Selection "Imported": 1 sample IDs could not be mapped'],
      unmappedCount: 1,
    });
  });

  it('imports selection CSV by preferring valid indices and falling back to sample IDs', () => {
    expect(parseSelectionCsv([
      'index,sample_id',
      ',s2',
      '5,s1',
      ',missing',
    ].join('\n'), ['s1', 's2'])).toEqual({
      indices: [1, 5],
      warnings: ['1 sample IDs could not be mapped to indices'],
      unmappedCount: 1,
    });
  });
});
