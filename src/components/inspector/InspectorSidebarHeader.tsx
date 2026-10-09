import { useTranslation } from 'react-i18next';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { InspectorSidebarStatusLabel } from '@/lib/inspector/sidebarState';

interface InspectorSidebarHeaderProps {
  error: string | null;
  isLoading: boolean;
  statusLabel: InspectorSidebarStatusLabel;
  scoreColumn: string;
  partition: string;
  visibleChainCount: number;
  totalChains: number;
  selectedCount: number;
  selectionSubtitle: string;
  activeFilterCount: number;
  onRefresh: () => void;
  onClearFilters: () => void;
}

export function InspectorSidebarHeader({
  error,
  isLoading,
  statusLabel,
  scoreColumn,
  partition,
  visibleChainCount,
  totalChains,
  selectedCount,
  selectionSubtitle,
  activeFilterCount,
  onRefresh,
  onClearFilters,
}: InspectorSidebarHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border/60 bg-gradient-to-b from-background to-muted/20 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-border/60 bg-background/80 text-[10px] uppercase tracking-[0.12em]">
              {t('inspector.title')}
            </Badge>
            <Badge
              variant={error ? 'destructive' : isLoading ? 'secondary' : 'outline'}
              className="text-[10px] uppercase tracking-[0.12em]"
            >
              {t(`inspector.sidebar.status.${statusLabel}`)}
            </Badge>
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-5 text-foreground">
              {t('inspector.sidebar.header.workspace')}
            </h1>
            <p className="text-xs text-muted-foreground">
              {t('inspector.sidebar.header.scoreOn', { score: scoreColumn, partition })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onRefresh}
                disabled={isLoading}
                aria-label={t('inspector.sidebar.header.refresh')}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('inspector.sidebar.header.refresh')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={onClearFilters}
                disabled={activeFilterCount === 0}
                aria-label={t('inspector.sidebar.header.clearFilters')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('inspector.sidebar.header.clearFilters')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('inspector.sidebar.header.scope')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{visibleChainCount}/{totalChains}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{t('inspector.sidebar.header.chainsVisible', { count: visibleChainCount })}</div>
        </div>
        <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t('inspector.sidebar.selection')}</div>
          <div className="mt-1 text-sm font-medium text-foreground">{selectedCount}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {selectionSubtitle}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="secondary" className="border-border/60 bg-background/80 text-[10px] uppercase tracking-[0.12em]">
          {scoreColumn}
        </Badge>
        <Badge variant="secondary" className="border-border/60 bg-background/80 text-[10px] uppercase tracking-[0.12em]">
          {partition}
        </Badge>
        <Badge variant="outline" className="border-border/60 bg-background/80 text-[10px] uppercase tracking-[0.12em]">
          {t('inspector.counts.filters', { count: activeFilterCount })}
        </Badge>
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
