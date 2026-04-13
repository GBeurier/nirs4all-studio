import { describe, expect, it } from 'vitest';
import { getPartitionRoleColor } from '@/lib/playground/colorConfig';
import {
  getHistogramPartitionRoleColor,
  getHistogramPartitionRoleLabel,
} from './utils';

describe('histogram partition presentation', () => {
  it('labels validation folds as cross-val', () => {
    expect(getHistogramPartitionRoleLabel('val')).toBe('cross-val');
  });

  it('uses the train color for validation folds', () => {
    expect(getHistogramPartitionRoleColor('val')).toBe(getPartitionRoleColor('train'));
  });
});
