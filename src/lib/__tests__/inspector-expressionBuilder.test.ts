import { describe, expect, it } from 'vitest';

import {
  addInspectorExpressionGroup,
  addInspectorExpressionRule,
  createInspectorExpressionGroup,
  createInspectorExpressionRule,
  getInspectorExpressionFieldType,
  getInspectorExpressionOperatorForFieldChange,
  getInspectorExpressionOperators,
  removeInspectorExpressionGroup,
  removeInspectorExpressionRule,
  updateInspectorExpressionGroup,
  updateInspectorExpressionRule,
} from '@/lib/inspector/expressionBuilder';
import type { GroupByExpressionConfig } from '@/types/inspector';

describe('inspector expression builder helpers', () => {
  it('returns field types and field-specific operators', () => {
    expect(getInspectorExpressionFieldType('model_class')).toBe('string');
    expect(getInspectorExpressionFieldType('cv_val_score')).toBe('number');
    expect(getInspectorExpressionOperators('model_class').map(op => op.value)).toEqual([
      'eq',
      'neq',
      'contains',
      'not_contains',
    ]);
    expect(getInspectorExpressionOperators('cv_val_score').map(op => op.value)).toEqual([
      'eq',
      'neq',
      'gt',
      'lt',
      'gte',
      'lte',
    ]);
  });

  it('chooses a compatible operator when changing field type', () => {
    expect(getInspectorExpressionOperatorForFieldChange('model_class', 'dataset_name', 'contains')).toBe('contains');
    expect(getInspectorExpressionOperatorForFieldChange('model_class', 'cv_val_score', 'contains')).toBe('gt');
    expect(getInspectorExpressionOperatorForFieldChange('cv_val_score', 'model_class', 'gte')).toBe('eq');
  });

  it('creates groups and applies immutable group/rule updates', () => {
    const rule = createInspectorExpressionRule('rule-1');
    const group = createInspectorExpressionGroup('group-1', rule);
    const config: GroupByExpressionConfig = { groups: [group] };

    expect(group).toEqual({
      id: 'group-1',
      label: '',
      combinator: 'AND',
      rules: [{ id: 'rule-1', field: 'model_class', operator: 'eq', value: '' }],
    });

    const renamed = updateInspectorExpressionGroup(config, 'group-1', { label: 'Models' });
    expect(renamed.groups[0].label).toBe('Models');
    expect(config.groups[0].label).toBe('');

    const updatedRule = updateInspectorExpressionRule(config, 'group-1', 'rule-1', { value: 'PLS' });
    expect(updatedRule.groups[0].rules[0].value).toBe('PLS');
    expect(config.groups[0].rules[0].value).toBe('');

    expect(removeInspectorExpressionRule(config, 'group-1', 'rule-1').groups[0].rules).toEqual([]);
    expect(removeInspectorExpressionGroup(config, 'group-1').groups).toEqual([]);
  });

  it('adds generated groups and rules to the requested targets', () => {
    const config: GroupByExpressionConfig = {
      groups: [createInspectorExpressionGroup('group-1', createInspectorExpressionRule('rule-1'))],
    };

    expect(addInspectorExpressionGroup(config).groups).toHaveLength(2);
    expect(addInspectorExpressionRule(config, 'group-1').groups[0].rules).toHaveLength(2);
    expect(addInspectorExpressionRule(config, 'missing').groups[0].rules).toHaveLength(1);
  });
});
