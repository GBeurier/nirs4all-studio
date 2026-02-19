/**
 * GroupBuilder — Group creation panel for Inspector sidebar.
 *
 * Primary modes: by_variable, by_top_k.
 * Advanced modes (behind toggle): by_range, by_branch, by_expression.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { GroupChip } from './GroupChip';
import { ExpressionBuilder } from './ExpressionBuilder';
import { SCORE_COLUMNS } from '@/types/inspector';
import type { GroupByVariable, GroupMode, ScoreColumn } from '@/types/inspector';

const GROUP_BY_OPTIONS: { value: GroupByVariable; label: string }[] = [
  { value: 'model_class', label: 'Model Class' },
  { value: 'preprocessings', label: 'Preprocessing' },
  { value: 'dataset_name', label: 'Dataset' },
  { value: 'task_type', label: 'Task Type' },
];

const PRIMARY_MODES: { value: GroupMode; label: string }[] = [
  { value: 'by_variable', label: 'Variable' },
  { value: 'by_top_k', label: 'Top K' },
];

const ADVANCED_MODES: { value: GroupMode; label: string }[] = [
  { value: 'by_range', label: 'Range' },
  { value: 'by_branch', label: 'Branch' },
  { value: 'by_expression', label: 'Expr' },
];

export function GroupBuilder() {
  const { t } = useTranslation();
  const {
    groups, groupMode, setGroupMode,
    groupBy, setGroupBy,
    rangeConfig, setRangeConfig,
    topKConfig, setTopKConfig,
    scoreColumn, chains,
  } = useInspectorData();
  const { select, selectedChains } = useInspectorSelection();
  const [advancedVisible, setAdvancedVisible] = useState(() => {
    // Show advanced if current mode is an advanced mode
    return ADVANCED_MODES.some(m => m.value === groupMode);
  });

  if (chains.length === 0) return null;

  const handleGroupClick = (chainIds: string[]) => {
    const allSelected = chainIds.every(id => selectedChains.has(id));
    if (allSelected) {
      select(chainIds, 'remove');
    } else {
      select(chainIds, 'add');
    }
  };

  const allModes = advancedVisible ? [...PRIMARY_MODES, ...ADVANCED_MODES] : PRIMARY_MODES;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Layers className="w-4 h-4 text-muted-foreground" />
        <span>{t('inspector.sidebar.groups', 'Groups')}</span>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1 flex-wrap">
        {allModes.map(opt => (
          <Button
            key={opt.value}
            variant={groupMode === opt.value ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => {
              setGroupMode(opt.value);
              if (opt.value === 'by_range' && !rangeConfig) {
                setRangeConfig({ column: scoreColumn, binCount: 5 });
              }
              if (opt.value === 'by_top_k' && !topKConfig) {
                setTopKConfig({ scoreColumn, k: 5 });
              }
            }}
          >
            {opt.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] text-muted-foreground"
          onClick={() => setAdvancedVisible(!advancedVisible)}
        >
          {advancedVisible ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {advancedVisible ? 'Less' : 'More'}
        </Button>
      </div>

      {/* Mode-specific config */}
      {groupMode === 'by_variable' && (
        <Select
          value={groupBy ?? ''}
          onValueChange={(val) => setGroupBy(val as GroupByVariable || null)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={t('inspector.sidebar.groupBy', 'Group by...')} />
          </SelectTrigger>
          <SelectContent>
            {GROUP_BY_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {groupMode === 'by_range' && (
        <div className="space-y-2">
          <Select
            value={rangeConfig?.column ?? scoreColumn}
            onValueChange={(val) =>
              setRangeConfig({ column: val as ScoreColumn, binCount: rangeConfig?.binCount ?? 5 })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCORE_COLUMNS.map(col => (
                <SelectItem key={col.value} value={col.value}>
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Bins:</label>
            <Input
              type="number"
              min={2}
              max={20}
              className="h-7 text-xs w-16"
              value={rangeConfig?.binCount ?? 5}
              onChange={(e) =>
                setRangeConfig({
                  column: rangeConfig?.column ?? scoreColumn,
                  binCount: Math.max(2, Math.min(20, Number(e.target.value) || 5)),
                })
              }
            />
          </div>
        </div>
      )}

      {groupMode === 'by_top_k' && (
        <div className="space-y-2">
          <Select
            value={topKConfig?.scoreColumn ?? scoreColumn}
            onValueChange={(val) =>
              setTopKConfig({ scoreColumn: val as ScoreColumn, k: topKConfig?.k ?? 5 })
            }
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCORE_COLUMNS.map(col => (
                <SelectItem key={col.value} value={col.value}>
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">K:</label>
            <Input
              type="number"
              min={1}
              max={100}
              className="h-7 text-xs w-16"
              value={topKConfig?.k ?? 5}
              onChange={(e) =>
                setTopKConfig({
                  scoreColumn: topKConfig?.scoreColumn ?? scoreColumn,
                  k: Math.max(1, Math.min(100, Number(e.target.value) || 5)),
                })
              }
            />
          </div>
        </div>
      )}

      {groupMode === 'by_branch' && (
        <p className="text-xs text-muted-foreground">
          Groups auto-detected from branch paths.
        </p>
      )}

      {groupMode === 'by_expression' && (
        <ExpressionBuilder />
      )}

      {/* Group chips */}
      {groups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map(group => {
            const allSelected = group.chain_ids.every(id => selectedChains.has(id));
            return (
              <GroupChip
                key={group.id}
                group={group}
                isActive={allSelected}
                onClick={() => handleGroupClick(group.chain_ids)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
