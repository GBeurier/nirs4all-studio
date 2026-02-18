/**
 * FilterPanel — Chain-level filter controls for Inspector sidebar.
 *
 * Provides: task type, score range slider, outlier filter, selection filter.
 * Uses InspectorFilterContext for state management.
 */

import { useTranslation } from 'react-i18next';
import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { useInspectorFilter } from '@/context/InspectorFilterContext';

export function FilterPanel() {
  const { t } = useTranslation();
  const {
    taskType,
    scoreRange,
    outlier,
    selection,
    setTaskTypeFilter,
    setScoreRange,
    setOutlierFilter,
    setSelectionFilter,
    clearAllFilters,
    activeFilterCount,
    hasActiveFilters,
    scoreStats,
  } = useInspectorFilter();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span>{t('inspector.sidebar.filters', 'Filters')}</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={clearAllFilters}
          >
            <X className="w-3 h-3 mr-0.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Task Type */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t('inspector.sidebar.taskType', 'Task Type')}
        </label>
        <Select value={taskType} onValueChange={setTaskTypeFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="regression">Regression</SelectItem>
            <SelectItem value="classification">Classification</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Score Range */}
      {scoreStats && (
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            {t('inspector.sidebar.scoreRange', 'Score Range')}
          </label>
          <Slider
            min={scoreStats.min}
            max={scoreStats.max}
            step={(scoreStats.max - scoreStats.min) / 100 || 0.001}
            value={scoreRange ?? [scoreStats.min, scoreStats.max]}
            onValueChange={(val) => {
              const [lo, hi] = val;
              if (lo === scoreStats.min && hi === scoreStats.max) {
                setScoreRange(null);
              } else {
                setScoreRange([lo, hi]);
              }
            }}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{(scoreRange?.[0] ?? scoreStats.min).toFixed(3)}</span>
            <span>{(scoreRange?.[1] ?? scoreStats.max).toFixed(3)}</span>
          </div>
        </div>
      )}

      {/* Outlier Filter */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t('inspector.sidebar.outlier', 'Outliers')}
        </label>
        <Select value={outlier} onValueChange={setOutlierFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="hide">Hide Outliers</SelectItem>
            <SelectItem value="only">Only Outliers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Selection Filter */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">
          {t('inspector.sidebar.selectionFilter', 'Selection Filter')}
        </label>
        <Select value={selection} onValueChange={setSelectionFilter}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="selected">Selected Only</SelectItem>
            <SelectItem value="unselected">Unselected Only</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
