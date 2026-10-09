/**
 * FilterPanel — Chain-level filter controls for Inspector sidebar.
 *
 * Compact non-destructive filters for score range, outliers, and selection.
 */

import { useTranslation } from 'react-i18next';
import { X, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInspectorFilter } from '@/context/useInspectorFilter';

function LabelWithHelp({
  label,
  help,
}: {
  label: string;
  help: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
            <HelpCircle className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-[220px] text-xs leading-5">
          {help}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function FilterPanel() {
  const { t } = useTranslation();
  const {
    scoreRange,
    outlier,
    selection,
    setScoreRange,
    setOutlierFilter,
    setSelectionFilter,
    clearAllFilters,
    hasActiveFilters,
    scoreStats,
  } = useInspectorFilter();

  return (
    <TooltipProvider delayDuration={180}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border/60 text-[10px] uppercase tracking-[0.12em]">
              {hasActiveFilters ? t('inspector.filterPanel.active') : t('inspector.filterPanel.idle')}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {hasActiveFilters ? t('inspector.filterPanel.scopeNarrowed') : t('inspector.filterPanel.fullScope')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-[10px] text-muted-foreground', !hasActiveFilters && 'opacity-50')}
            onClick={clearAllFilters}
            disabled={!hasActiveFilters}
          >
            <X className="mr-0.5 h-3 w-3" />
            {t('common.clear')}
          </Button>
        </div>

        {scoreStats && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between">
              <LabelWithHelp
                label={t('inspector.sidebar.scoreRange')}
                help={t('inspector.filterPanel.scoreRangeHelp')}
              />
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {scoreRange ? t('inspector.filterPanel.custom') : t('inspector.filterPanel.full')}
              </Badge>
            </div>
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
            <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
              <span>{(scoreRange?.[0] ?? scoreStats.min).toFixed(3)}</span>
              <span>{(scoreRange?.[1] ?? scoreStats.max).toFixed(3)}</span>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <LabelWithHelp
              label={t('inspector.sidebar.outlier')}
              help={t('inspector.filterPanel.outlierHelp')}
            />
            <Select value={outlier} onValueChange={setOutlierFilter}>
              <SelectTrigger className="mt-2 h-8 text-xs" aria-label={t('inspector.sidebar.outlier')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inspector.filters.all')}</SelectItem>
                <SelectItem value="hide">{t('inspector.filters.hideOutliers')}</SelectItem>
                <SelectItem value="only">{t('inspector.filters.onlyOutliers')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <LabelWithHelp
              label={t('inspector.sidebar.selectionFilter')}
              help={t('inspector.filterPanel.selectionHelp')}
            />
            <Select value={selection} onValueChange={setSelectionFilter}>
              <SelectTrigger className="mt-2 h-8 text-xs" aria-label={t('inspector.sidebar.selectionFilter')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('inspector.filters.all')}</SelectItem>
                <SelectItem value="selected">{t('inspector.filters.selectedOnly')}</SelectItem>
                <SelectItem value="unselected">{t('inspector.filters.unselectedOnly')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
