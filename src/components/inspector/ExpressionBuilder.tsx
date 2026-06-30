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
import { useInspectorData } from '@/context/useInspectorDataContext';
import {
  addInspectorExpressionGroup,
  addInspectorExpressionRule,
  getInspectorExpressionOperatorForFieldChange,
  getInspectorExpressionOperators,
  INSPECTOR_EXPRESSION_FIELDS,
  removeInspectorExpressionGroup,
  removeInspectorExpressionRule,
  updateInspectorExpressionGroup,
  updateInspectorExpressionRule,
} from '@/lib/inspector/expressionBuilder';
import type {
  ExpressionField,
  ExpressionOperator,
  ExpressionCombinator,
  GroupByExpressionConfig,
} from '@/types/inspector';

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
    update(addInspectorExpressionGroup);
  };

  const removeGroup = (groupId: string) => {
    update(c => removeInspectorExpressionGroup(c, groupId));
  };

  const updateGroup = (
    groupId: string,
    partial: Parameters<typeof updateInspectorExpressionGroup>[2],
  ) => {
    update(c => updateInspectorExpressionGroup(c, groupId, partial));
  };

  const addRule = (groupId: string) => {
    update(c => addInspectorExpressionRule(c, groupId));
  };

  const removeRule = (groupId: string, ruleId: string) => {
    update(c => removeInspectorExpressionRule(c, groupId, ruleId));
  };

  const updateRule = (
    groupId: string,
    ruleId: string,
    partial: Parameters<typeof updateInspectorExpressionRule>[3],
  ) => {
    update(c => updateInspectorExpressionRule(c, groupId, ruleId, partial));
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
            const operators = getInspectorExpressionOperators(rule.field);
            return (
              <div key={rule.id} className="flex items-center gap-1">
                <Select
                  value={rule.field}
                  onValueChange={(v) => {
                    const newField = v as ExpressionField;
                    const newOp = getInspectorExpressionOperatorForFieldChange(
                      rule.field,
                      newField,
                      rule.operator,
                    );
                    updateRule(group.id, rule.id, { field: newField, operator: newOp });
                  }}
                >
                  <SelectTrigger className="h-6 text-[10px] flex-1 min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INSPECTOR_EXPRESSION_FIELDS.map(f => (
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
