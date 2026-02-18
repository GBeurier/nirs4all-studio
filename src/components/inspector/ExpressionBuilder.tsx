/**
 * ExpressionBuilder — Rule-based expression builder for Inspector grouping.
 *
 * Each expression group has a label, AND/OR combinator, and a list of rules.
 * Each rule: field dropdown + operator dropdown + value input.
 */

import { useCallback, useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorData } from '@/context/InspectorDataContext';
import type {
  ExpressionField,
  ExpressionOperator,
  ExpressionCombinator,
  ExpressionRule,
  ExpressionGroup,
  GroupByExpressionConfig,
} from '@/types/inspector';

// Fields available for expressions
const EXPRESSION_FIELDS: { value: ExpressionField; label: string; type: 'string' | 'number' }[] = [
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

const STRING_OPERATORS: { value: ExpressionOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: '!contains' },
];

const NUMBER_OPERATORS: { value: ExpressionOperator; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
];

function getFieldType(field: ExpressionField): 'string' | 'number' {
  return EXPRESSION_FIELDS.find(f => f.value === field)?.type ?? 'string';
}

function getOperators(field: ExpressionField) {
  return getFieldType(field) === 'number' ? NUMBER_OPERATORS : STRING_OPERATORS;
}

let nextId = 1;
function uid(): string {
  return `expr-${Date.now()}-${nextId++}`;
}

function createRule(): ExpressionRule {
  return { id: uid(), field: 'model_class', operator: 'eq', value: '' };
}

function createGroup(): ExpressionGroup {
  return { id: uid(), label: '', combinator: 'AND', rules: [createRule()] };
}

export function ExpressionBuilder() {
  const { expressionConfig, setExpressionConfig } = useInspectorData();

  const config = useMemo(() => expressionConfig ?? { groups: [] }, [expressionConfig]);

  const update = useCallback(
    (updater: (c: GroupByExpressionConfig) => GroupByExpressionConfig) => {
      setExpressionConfig(updater(config));
    },
    [config, setExpressionConfig],
  );

  const addGroup = () => {
    update(c => ({ groups: [...c.groups, createGroup()] }));
  };

  const removeGroup = (groupId: string) => {
    update(c => ({ groups: c.groups.filter(g => g.id !== groupId) }));
  };

  const updateGroup = (groupId: string, partial: Partial<ExpressionGroup>) => {
    update(c => ({
      groups: c.groups.map(g => (g.id === groupId ? { ...g, ...partial } : g)),
    }));
  };

  const addRule = (groupId: string) => {
    update(c => ({
      groups: c.groups.map(g =>
        g.id === groupId ? { ...g, rules: [...g.rules, createRule()] } : g,
      ),
    }));
  };

  const removeRule = (groupId: string, ruleId: string) => {
    update(c => ({
      groups: c.groups.map(g =>
        g.id === groupId ? { ...g, rules: g.rules.filter(r => r.id !== ruleId) } : g,
      ),
    }));
  };

  const updateRule = (groupId: string, ruleId: string, partial: Partial<ExpressionRule>) => {
    update(c => ({
      groups: c.groups.map(g =>
        g.id === groupId
          ? { ...g, rules: g.rules.map(r => (r.id === ruleId ? { ...r, ...partial } : r)) }
          : g,
      ),
    }));
  };

  return (
    <div className="space-y-2">
      {config.groups.map((group, gi) => (
        <div key={group.id} className="border border-border rounded p-2 space-y-1.5">
          {/* Group header: label + combinator + delete */}
          <div className="flex items-center gap-1">
            <Input
              className="h-6 text-xs flex-1"
              placeholder={`Group ${gi + 1}`}
              value={group.label}
              onChange={(e) => updateGroup(group.id, { label: e.target.value })}
            />
            <Select
              value={group.combinator}
              onValueChange={(v) => updateGroup(group.id, { combinator: v as ExpressionCombinator })}
            >
              <SelectTrigger className="h-6 text-[10px] w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => removeGroup(group.id)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>

          {/* Rules */}
          {group.rules.map((rule) => {
            const operators = getOperators(rule.field);
            return (
              <div key={rule.id} className="flex items-center gap-1">
                <Select
                  value={rule.field}
                  onValueChange={(v) => {
                    const newField = v as ExpressionField;
                    const newType = getFieldType(newField);
                    const oldType = getFieldType(rule.field);
                    const newOp = newType !== oldType
                      ? (newType === 'number' ? 'gt' : 'eq') as ExpressionOperator
                      : rule.operator;
                    updateRule(group.id, rule.id, { field: newField, operator: newOp });
                  }}
                >
                  <SelectTrigger className="h-6 text-[10px] flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPRESSION_FIELDS.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={rule.operator}
                  onValueChange={(v) => updateRule(group.id, rule.id, { operator: v as ExpressionOperator })}
                >
                  <SelectTrigger className="h-6 text-[10px] w-[68px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map(op => (
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-6 text-[10px] w-20"
                  placeholder="value"
                  value={rule.value}
                  onChange={(e) => updateRule(group.id, rule.id, { value: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => removeRule(group.id, rule.id)}
                  disabled={group.rules.length <= 1}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            );
          })}

          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1"
            onClick={() => addRule(group.id)}
          >
            <Plus className="w-3 h-3 mr-0.5" />
            Rule
          </Button>
        </div>
      ))}

      <Button
        variant="outline"
        size="sm"
        className="h-6 text-xs w-full"
        onClick={addGroup}
      >
        <Plus className="w-3 h-3 mr-1" />
        Add Group
      </Button>
    </div>
  );
}
