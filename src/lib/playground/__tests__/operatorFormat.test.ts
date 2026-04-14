import { describe, expect, it } from 'vitest';
import {
  exportToPipelineEditor,
  unifiedToPlaygroundStep,
} from '../operatorFormat';
import type { UnifiedOperator } from '@/types/playground';

describe('operatorFormat runtime-only split params', () => {
  it('keeps runtime-only split params for playground execution payloads', () => {
    const operator: UnifiedOperator = {
      id: 'split-1',
      type: 'splitting',
      name: 'KFold',
      enabled: true,
      params: {
        n_splits: 4,
        group_by: 'batch',
      },
    };

    expect(unifiedToPlaygroundStep(operator)).toEqual({
      id: 'split-1',
      type: 'splitting',
      name: 'KFold',
      enabled: true,
      params: {
        n_splits: 4,
        group_by: 'batch',
      },
    });
  });

  it('strips runtime-only split params from pipeline exports', () => {
    const operators: UnifiedOperator[] = [
      {
        id: 'split-1',
        type: 'splitting',
        name: 'KFold',
        enabled: true,
        params: {
          n_splits: 4,
          group_by: 'batch',
          ignore_repetition: true,
        },
      },
      {
        id: 'prep-1',
        type: 'preprocessing',
        name: 'SNV',
        enabled: true,
        params: {},
      },
    ];

    expect(exportToPipelineEditor(operators)).toEqual([
      {
        id: 'split-1',
        type: 'splitting',
        name: 'KFold',
        params: {
          n_splits: 4,
        },
      },
      {
        id: 'prep-1',
        type: 'preprocessing',
        name: 'SNV',
        params: {},
      },
    ]);
  });
});
