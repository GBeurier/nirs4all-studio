import { describe, expect, it } from 'vitest';
import {
  buildLocalMetadataColumns,
  formatUnifiedOperatorName,
  getUnifiedOperatorBorderClass,
  getUnifiedOperatorTypeFlags,
  hasRenderableOperatorParams,
  inferMetadataDtype,
  supportsRuntimeGroupBy,
} from '../unifiedOperatorCardData';
import type { OperatorParamInfo } from '@/types/playground';
import type { SampleMetadata } from '@/types/spectral';

describe('unifiedOperatorCardData', () => {
  it('infers local metadata columns from row-oriented metadata', () => {
    const rows: SampleMetadata[] = [
      { batch: 'A', repetition: 1, selected: true },
      { batch: 'B', repetition: 2, selected: false },
      { batch: 'A', repetition: 1, selected: true },
    ];

    expect(buildLocalMetadataColumns(rows)).toEqual([
      {
        name: 'batch',
        dtype: 'string',
        unique_values: ['A', 'B'],
        n_unique: 2,
      },
      {
        name: 'repetition',
        dtype: 'number',
        unique_values: [1, 2],
        n_unique: 2,
      },
      {
        name: 'selected',
        dtype: 'boolean',
        unique_values: [true, false],
        n_unique: 2,
      },
    ]);
  });

  it('handles empty and null-only metadata values defensively', () => {
    const nullOnlyRows = [{ missing: null }] as unknown as SampleMetadata[];

    expect(buildLocalMetadataColumns()).toEqual([]);
    expect(inferMetadataDtype([null, undefined])).toBe('unknown');
    expect(buildLocalMetadataColumns(nullOnlyRows)).toEqual([
      {
        name: 'missing',
        dtype: 'unknown',
        unique_values: [null],
        n_unique: 1,
      },
    ]);
  });

  it('caps local metadata preview values to keep card rendering bounded', () => {
    const rows: SampleMetadata[] = Array.from({ length: 250 }, (_, index) => ({
      batch: `batch-${index}`,
    }));

    const [column] = buildLocalMetadataColumns(rows);
    expect(column.n_unique).toBe(250);
    expect(column.unique_values).toHaveLength(200);
    expect(column.unique_values.at(-1)).toBe('batch-199');
  });

  it('derives operator presentation flags and border priority', () => {
    expect(getUnifiedOperatorTypeFlags('splitting')).toEqual({
      isSplitter: true,
      isFilter: false,
      isAugmentation: false,
    });
    expect(getUnifiedOperatorTypeFlags('filter')).toMatchObject({ isFilter: true });
    expect(getUnifiedOperatorBorderClass({
      hasError: true,
      isFilter: true,
      isSplitter: false,
      isAugmentation: false,
    })).toBe('border-destructive/70');
    expect(getUnifiedOperatorBorderClass({
      hasError: false,
      isFilter: false,
      isSplitter: false,
      isAugmentation: true,
    })).toBe('border-blue-500/50');
  });

  it('derives display names and parameter visibility without React state', () => {
    const paramDefs: Record<string, OperatorParamInfo> = {
      n_splits: { required: false, default: 5 },
    };

    expect(formatUnifiedOperatorName('SavitzkyGolay')).toBe('Savitzky Golay');
    expect(supportsRuntimeGroupBy({ runtimeOnlyParams: ['group_by'] })).toBe(true);
    expect(supportsRuntimeGroupBy({ runtimeOnlyParams: ['ignore_repetition'] })).toBe(false);
    expect(hasRenderableOperatorParams({ paramDefs, hasRuntimeGroupBy: false })).toBe(true);
    expect(hasRenderableOperatorParams({ paramDefs: {}, hasRuntimeGroupBy: true })).toBe(true);
    expect(hasRenderableOperatorParams({ paramDefs: {}, hasRuntimeGroupBy: false })).toBe(false);
  });
});
