import type {
  ExpressionField,
  ExpressionGroup,
  ExpressionOperator,
  ExpressionRule,
  GroupByExpressionConfig,
} from '@/types/inspector';

export const INSPECTOR_EXPRESSION_FIELDS: { value: ExpressionField; label: string; type: 'string' | 'number' }[] = [
  { value: 'model_class', label: 'Model Class', type: 'string' },
  { value: 'preprocessings', label: 'Preprocessing', type: 'string' },
  { value: 'dataset_name', label: 'Dataset', type: 'string' },
  { value: 'task_type', label: 'Task Type', type: 'string' },
  { value: 'cv_val_score', label: 'CV Val Score', type: 'number' },
  { value: 'cv_test_score', label: 'CV Test Score', type: 'number' },
  { value: 'cv_train_score', label: 'CV Train Score', type: 'number' },
  { value: 'final_test_score', label: 'Final Test', type: 'number' },
  { value: 'final_train_score', label: 'Final Train', type: 'number' },
  { value: 'cv_fold_count', label: 'Fold Count', type: 'number' },
];

export const INSPECTOR_STRING_OPERATORS: { value: ExpressionOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: '!contains' },
];

export const INSPECTOR_NUMBER_OPERATORS: { value: ExpressionOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
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
