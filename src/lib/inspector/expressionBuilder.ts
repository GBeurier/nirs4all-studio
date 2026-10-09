import type {
  ExpressionField,
  ExpressionGroup,
  ExpressionOperator,
  ExpressionRule,
  GroupByExpressionConfig,
} from '@/types/inspector';

export const INSPECTOR_EXPRESSION_FIELDS: { value: ExpressionField; labelKey: string; type: 'string' | 'number' }[] = [
  { value: 'model_class', labelKey: 'inspector.fields.modelClass', type: 'string' },
  { value: 'preprocessings', labelKey: 'inspector.fields.preprocessing', type: 'string' },
  { value: 'dataset_name', labelKey: 'inspector.fields.dataset', type: 'string' },
  { value: 'task_type', labelKey: 'inspector.fields.taskType', type: 'string' },
  { value: 'cv_val_score', labelKey: 'inspector.scores.cv_val_score', type: 'number' },
  { value: 'cv_test_score', labelKey: 'inspector.scores.cv_test_score', type: 'number' },
  { value: 'cv_train_score', labelKey: 'inspector.scores.cv_train_score', type: 'number' },
  { value: 'final_test_score', labelKey: 'inspector.scores.shortFinalTest', type: 'number' },
  { value: 'final_train_score', labelKey: 'inspector.scores.shortFinalTrain', type: 'number' },
  { value: 'cv_fold_count', labelKey: 'inspector.fields.foldCount', type: 'number' },
];

export const INSPECTOR_STRING_OPERATORS: { value: ExpressionOperator; labelKey: string }[] = [
  { value: 'eq', labelKey: 'inspector.groups.operators.eq' },
  { value: 'neq', labelKey: 'inspector.groups.operators.neq' },
  { value: 'contains', labelKey: 'inspector.groups.operators.contains' },
  { value: 'not_contains', labelKey: 'inspector.groups.operators.not_contains' },
];

export const INSPECTOR_NUMBER_OPERATORS: { value: ExpressionOperator; labelKey: string }[] = [
  { value: 'eq', labelKey: 'inspector.groups.operators.eq' },
  { value: 'neq', labelKey: 'inspector.groups.operators.neq' },
  { value: 'gt', labelKey: 'inspector.groups.operators.gt' },
  { value: 'lt', labelKey: 'inspector.groups.operators.lt' },
  { value: 'gte', labelKey: 'inspector.groups.operators.gte' },
  { value: 'lte', labelKey: 'inspector.groups.operators.lte' },
];

let nextExpressionId = 1;

export function createInspectorExpressionId(now = Date.now()): string {
  return `expr-${now}-${nextExpressionId++}`;
}

export function getInspectorExpressionFieldType(field: ExpressionField): 'string' | 'number' {
  return INSPECTOR_EXPRESSION_FIELDS.find(f => f.value === field)?.type ?? 'string';
}

export function getInspectorExpressionOperators(field: ExpressionField) {
  return getInspectorExpressionFieldType(field) === 'number'
    ? INSPECTOR_NUMBER_OPERATORS
    : INSPECTOR_STRING_OPERATORS;
}

export function getInspectorExpressionOperatorForFieldChange(
  oldField: ExpressionField,
  newField: ExpressionField,
  currentOperator: ExpressionOperator,
): ExpressionOperator {
  const newType = getInspectorExpressionFieldType(newField);
  const oldType = getInspectorExpressionFieldType(oldField);
  if (newType === oldType) return currentOperator;
  return newType === 'number' ? 'gt' : 'eq';
}

export function createInspectorExpressionRule(id = createInspectorExpressionId()): ExpressionRule {
  return { id, field: 'model_class', operator: 'eq', value: '' };
}

export function createInspectorExpressionGroup(
  groupId = createInspectorExpressionId(),
  rule = createInspectorExpressionRule(),
): ExpressionGroup {
  return { id: groupId, label: '', combinator: 'AND', rules: [rule] };
}

export function addInspectorExpressionGroup(config: GroupByExpressionConfig): GroupByExpressionConfig {
  return { groups: [...config.groups, createInspectorExpressionGroup()] };
}

export function removeInspectorExpressionGroup(
  config: GroupByExpressionConfig,
  groupId: string,
): GroupByExpressionConfig {
  return { groups: config.groups.filter(g => g.id !== groupId) };
}

export function updateInspectorExpressionGroup(
  config: GroupByExpressionConfig,
  groupId: string,
  partial: Partial<ExpressionGroup>,
): GroupByExpressionConfig {
  return {
    groups: config.groups.map(g => (g.id === groupId ? { ...g, ...partial } : g)),
  };
}

export function addInspectorExpressionRule(
  config: GroupByExpressionConfig,
  groupId: string,
): GroupByExpressionConfig {
  return {
    groups: config.groups.map(g =>
      g.id === groupId ? { ...g, rules: [...g.rules, createInspectorExpressionRule()] } : g,
    ),
  };
}

export function removeInspectorExpressionRule(
  config: GroupByExpressionConfig,
  groupId: string,
  ruleId: string,
): GroupByExpressionConfig {
  return {
    groups: config.groups.map(g =>
      g.id === groupId ? { ...g, rules: g.rules.filter(r => r.id !== ruleId) } : g,
    ),
  };
}

export function updateInspectorExpressionRule(
  config: GroupByExpressionConfig,
  groupId: string,
  ruleId: string,
  partial: Partial<ExpressionRule>,
): GroupByExpressionConfig {
  return {
    groups: config.groups.map(g =>
      g.id === groupId
        ? { ...g, rules: g.rules.map(r => (r.id === ruleId ? { ...r, ...partial } : r)) }
        : g,
    ),
  };
}
