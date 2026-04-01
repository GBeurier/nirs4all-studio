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
import { useInspectorFilter } from '@/context/InspectorFilterContext';

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
              {hasActiveFilters ? 'active' : 'idle'}
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {hasActiveFilters ? 'scope narrowed' : 'full scope'}
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
            Clear
          </Button>
        </div>

        {scoreStats && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <div className="flex items-center justify-between">
              <LabelWithHelp
                label={t('inspector.sidebar.scoreRange', 'Score Range')}
                help="Keep only chains whose active score falls inside this interval."
              />
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {scoreRange ? 'custom' : 'full'}
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
              label={t('inspector.sidebar.outlier', 'Outliers')}
              help="Show all chains, hide statistical outliers, or isolate only outliers."
            />
            <Select value={outlier} onValueChange={setOutlierFilter}>
              <SelectTrigger className="mt-2 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="hide">Hide outliers</SelectItem>
                <SelectItem value="only">Only outliers</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3">
            <LabelWithHelp
              label={t('inspector.sidebar.selectionFilter', 'Selection')}
              help="Restrict the scope to selected chains, unselected chains, or all chains."
            />
            <Select value={selection} onValueChange={setSelectionFilter}>
              <SelectTrigger className="mt-2 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="selected">Selected only</SelectItem>
                <SelectItem value="unselected">Unselected only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
