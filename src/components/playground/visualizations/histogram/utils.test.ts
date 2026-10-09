// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { getPartitionRoleColor } from '@/lib/playground/colorConfig';
import {
  getHistogramPartitionRoleColor,
  getHistogramPartitionRoleLabel,
} from './utils';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('histogram partition presentation', () => {
  it('labels validation folds as cross-val', () => {
    expect(getHistogramPartitionRoleLabel('val', i18n.t)).toBe('cross-val');
  });

  it('labels train and test partitions', () => {
    expect(getHistogramPartitionRoleLabel('train', i18n.t)).toBe('Train');
    expect(getHistogramPartitionRoleLabel('test', i18n.t)).toBe('Test');
  });

  it('uses the train color for validation folds', () => {
    expect(getHistogramPartitionRoleColor('val')).toBe(getPartitionRoleColor('train'));
  });
});
