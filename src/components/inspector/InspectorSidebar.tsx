/**
 * InspectorSidebar — Left control surface for the predictions inspector.
 *
 * Compact scientific shell with collapsible controls, local help tooltips,
 * and shared chain selection / filtering state.
 */

import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw,
  XCircle,
  Pin,
  ChevronDown,
  ChevronRight,
  Palette,
  Layers,
  Filter,
  MousePointerClick,
  Bookmark,
  Sparkles,
  Target,
  HelpCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { useInspectorFilter } from '@/context/InspectorFilterContext';
import { FilterPanel } from './FilterPanel';
import { ColorConfigPanel } from './ColorConfigPanel';
import { GroupBuilder } from './GroupBuilder';
import { InspectorSavedSelections } from './InspectorSavedSelections';

// ============= Collapsible Section =============

function SidebarSection({
  icon: Icon,
  title,
  badge,
  help,
  actions,
  defaultOpen = true,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  badge?: React.ReactNode;
  help?: string;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-border/60 bg-background/80 shadow-sm">
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/80">
          {title}
        </span>
        {badge}
        {actions}
        {help ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                tabIndex={-1}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={e => e.stopPropagation()}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-[220px] text-xs leading-5">
              {help}
            </TooltipContent>
          </Tooltip>
        ) : null}
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        }
      </button>
      {open && (
        <div className="animate-in fade-in slide-in-from-top-1 px-3 pb-3 pt-1 duration-150">
          {children}
        </div>
      )}
    </div>
  );
}

// ============= Main Component =============

export function InspectorSidebar() {
  const { t } = useTranslation();
  const {
    chains,
    isLoading,
    error,
    refresh,
    totalChains,
    scoreColumn,
    partition,
  } = useInspectorData();
  const {
    selectedCount,
    hasSelection,
    clear,
    selectAll,
    pinnedCount,
    clearPins,
  } = useInspectorSelection();
  const {
    activeFilterCount,
    clearAllFilters,
    filteredChains,
  } = useInspectorFilter();

  const allChainIds = useMemo(() => chains.map(chain => chain.chain_id), [chains]);
  const statusLabel = error
    ? 'Error'
    : isLoading
      ? 'Loading'
      : chains.length === 0
        ? 'No data'
        : 'Ready';

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full w-80 shrink-0 flex-col border-r border-border/60 bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="border-b border-border/60 bg-gradient-to-b from-background to-muted/20 px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-border/60 bg-background/80 text-[10px] uppercase tracking-[0.12em]">
                  Inspector
                </Badge>
                <Badge
                  variant={error ? 'destructive' : isLoading ? 'secondary' : 'outline'}
                  className="text-[10px] uppercase tracking-[0.12em]"
                >
                  {statusLabel}
                </Badge>
              </div>
              <div>
                <h1 className="text-sm font-semibold leading-5 text-foreground">
                  Prediction workspace
                </h1>
                <p className="text-xs text-muted-foreground">
                  {scoreColumn} on {partition}
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
                    onClick={refresh}
                    disabled={isLoading}
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Refresh inspector data</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => clearAllFilters()}
                    disabled={activeFilterCount === 0}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Clear local filters</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Scope</div>
              <div className="mt-1 text-sm font-medium text-foreground">{filteredChains.length}/{totalChains}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">chains visible</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-background/80 px-3 py-2">
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Selection</div>
              <div className="mt-1 text-sm font-medium text-foreground">{selectedCount}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {pinnedCount > 0 ? `${pinnedCount} pinned` : 'active chains'}
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
              {activeFilterCount} filters
            </Badge>
          </div>

          {error ? (
            <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-3 px-3 py-3">
            {chains.length > 0 ? (
              <>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 justify-start gap-2 text-xs"
                    onClick={() => selectAll(allChainIds)}
                    disabled={selectedCount === totalChains || allChainIds.length === 0}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Select all
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 flex-1 justify-start gap-2 text-xs"
                    onClick={hasSelection ? clear : clearPins}
                    disabled={!hasSelection && pinnedCount === 0}
                  >
                    <Target className="h-3.5 w-3.5" />
                    Clear focus
                  </Button>
                </div>

                <Separator className="bg-border/60" />

                <SidebarSection
                  icon={Layers}
                  title={t('inspector.sidebar.groups', 'Groups')}
                  help="Build shared comparison sets from model, preprocessing, score bands, branch structure, or expressions."
                >
                  <GroupBuilder />
                </SidebarSection>

                <SidebarSection
                  icon={Filter}
                  title={t('inspector.sidebar.filters', 'Filters')}
                  badge={activeFilterCount > 0 ? (
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  ) : undefined}
                  help="Non-destructive scope filters. Use them to narrow the visible chain set without changing the underlying data."
                >
                  <FilterPanel />
                </SidebarSection>

                <SidebarSection
                  icon={MousePointerClick}
                  title={t('inspector.sidebar.selection', 'Selection')}
                  badge={hasSelection ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {selectedCount}
                    </Badge>
                  ) : undefined}
                  help="Selection is shared across every inspector panel and drives the focused diagnostics cohort."
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      <span>{selectedCount} selected</span>
                      <span>{pinnedCount} pinned</span>
                    </div>

                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={clear}
                        disabled={!hasSelection}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Clear
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={() => selectAll(allChainIds)}
                        disabled={allChainIds.length === 0 || selectedCount === totalChains}
                      >
                        All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 flex-1 text-xs"
                        onClick={clearPins}
                        disabled={pinnedCount === 0}
                      >
                        <Pin className="mr-1 h-3 w-3" />
                        Pins
                      </Button>
                    </div>
                  </div>
                </SidebarSection>

                <SidebarSection
                  icon={Bookmark}
                  title="Saved"
                  defaultOpen={false}
                  help="Persisted selections for revisiting named cohorts later in the analysis session."
                >
                  <InspectorSavedSelections />
                </SidebarSection>

                <SidebarSection
                  icon={Palette}
                  title={t('inspector.sidebar.colors', 'Colors')}
                  defaultOpen={false}
                  help="Global palette and opacity controls used to color every panel consistently."
                >
                  <ColorConfigPanel />
                </SidebarSection>
              </>
            ) : isLoading ? (
              <div className="rounded-xl border border-border/60 bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
                <div className="font-medium text-foreground">Loading inspector data</div>
                <div className="mt-1 text-xs">
                  Building the prediction scope and facet metadata.
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-border/60 bg-background/80 px-4 py-8 text-center text-sm text-muted-foreground">
                <div className="font-medium text-foreground">{t('inspector.noData', 'No data available')}</div>
                <div className="mt-1 text-xs">
                  Load predictions to unlock grouping, filtering, and shared selection.
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
