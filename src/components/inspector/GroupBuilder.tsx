/**
 * GroupBuilder — Group creation panel for Inspector sidebar.
 *
 * Primary modes: by_variable, by_top_k.
 * Advanced modes (behind toggle): by_range, by_branch, by_expression.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useInspectorData } from '@/context/useInspectorDataContext';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import { GroupChip } from './GroupChip';
import { ExpressionBuilder } from './ExpressionBuilder';
import { INSPECTOR_SCORE_OPTIONS } from '@/lib/inspector/scoreSelection';
import {
  clampInspectorRangeBinCount,
  clampInspectorTopK,
  getInspectorGroupModeOptions,
  getInspectorRangeConfigForColumn,
  getInspectorTopKConfigForScore,
  INSPECTOR_GROUP_BY_OPTIONS,
  isInspectorAdvancedGroupMode,
} from '@/lib/inspector/groupBuilder';
import type { GroupByVariable, GroupMode, ScoreColumn } from '@/types/inspector';

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
    return isInspectorAdvancedGroupMode(groupMode);
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

  const allModes = getInspectorGroupModeOptions(advancedVisible);

  return (
    <TooltipProvider delayDuration={180}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Grouping
          </span>
          <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.12em]">
            {groups.length} sets
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {allModes.map(opt => (
            <Button
              key={opt.value}
              variant={groupMode === opt.value ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-[10px] uppercase tracking-[0.08em]"
              onClick={() => {
                setGroupMode(opt.value);
                if (opt.value === 'by_range' && !rangeConfig) {
                  setRangeConfig(getInspectorRangeConfigForColumn(scoreColumn, rangeConfig));
                }
                if (opt.value === 'by_top_k' && !topKConfig) {
                  setTopKConfig(getInspectorTopKConfigForScore(scoreColumn, topKConfig));
                }
              }}
            >
              {opt.label}
            </Button>
          ))}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[10px] text-muted-foreground"
                onClick={() => setAdvancedVisible(!advancedVisible)}
              >
                {advancedVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {advancedVisible ? 'Less' : 'More'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {advancedVisible ? 'Hide range, branch, and expression grouping.' : 'Show range, branch, and expression grouping.'}
            </TooltipContent>
          </Tooltip>
        </div>

        {groupMode === 'by_variable' && (
          <Select
            value={groupBy ?? ''}
            onValueChange={(val) => setGroupBy((val as GroupByVariable) || null)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={t('inspector.sidebar.groupBy', 'Group by...')} />
            </SelectTrigger>
            <SelectContent>
              {INSPECTOR_GROUP_BY_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {groupMode === 'by_range' && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <Select
              value={rangeConfig?.column ?? scoreColumn}
              onValueChange={(val) =>
                setRangeConfig({ column: val as ScoreColumn, binCount: rangeConfig?.binCount ?? 5 })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSPECTOR_SCORE_OPTIONS.map(col => (
                  <SelectItem key={col.value} value={col.value}>
                    {col.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Bins</label>
              <Input
                type="number"
                min={2}
                max={20}
                className="h-8 w-[72px] text-xs"
                value={rangeConfig?.binCount ?? 5}
                onChange={(e) =>
                  setRangeConfig({
                    column: rangeConfig?.column ?? scoreColumn,
                    binCount: clampInspectorRangeBinCount(Number(e.target.value)),
                  })
                }
              />
            </div>
          </div>
        )}

        {groupMode === 'by_top_k' && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <Select
              value={topKConfig?.scoreColumn ?? scoreColumn}
              onValueChange={(val) =>
                setTopKConfig({ scoreColumn: val as ScoreColumn, k: topKConfig?.k ?? 5 })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSPECTOR_SCORE_OPTIONS.map(col => (
                  <SelectItem key={col.value} value={col.value}>
                    {col.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">K</label>
              <Input
                type="number"
                min={1}
                max={100}
                className="h-8 w-[72px] text-xs"
                value={topKConfig?.k ?? 5}
                onChange={(e) =>
                  setTopKConfig({
                    scoreColumn: topKConfig?.scoreColumn ?? scoreColumn,
                    k: clampInspectorTopK(Number(e.target.value)),
                  })
                }
              />
            </div>
          </div>
        )}

        {groupMode === 'by_branch' && (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            Branch-derived groups.
          </div>
        )}

        {groupMode === 'by_expression' && (
          <div className="rounded-lg border border-border/60 bg-muted/20 p-2.5">
            <ExpressionBuilder />
          </div>
        )}

        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-border/60 bg-muted/10 p-2">
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
    </TooltipProvider>
  );
}
