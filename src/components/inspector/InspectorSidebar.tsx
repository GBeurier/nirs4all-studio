/**
 * InspectorSidebar — Left control surface for the predictions inspector.
 *
 * Compact scientific shell with collapsible controls, local help tooltips,
 * and shared chain selection / filtering state.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Palette,
  Layers,
  Filter,
  MousePointerClick,
  Bookmark,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useInspectorData } from '@/context/useInspectorDataContext';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import { useInspectorFilter } from '@/context/useInspectorFilter';
import { getInspectorSelectionSubtitle, getInspectorSidebarStatusLabel } from '@/lib/inspector/sidebarState';
import { FilterPanel } from './FilterPanel';
import { ColorConfigPanel } from './ColorConfigPanel';
import { GroupBuilder } from './GroupBuilder';
import { InspectorSavedSelections } from './InspectorSavedSelections';
import { InspectorSidebarEmptyState } from './InspectorSidebarEmptyState';
import { InspectorSidebarHeader } from './InspectorSidebarHeader';
import { InspectorSidebarSection } from './InspectorSidebarSection';
import { InspectorSidebarQuickActions, InspectorSidebarSelectionSummary } from './InspectorSidebarSelectionControls';

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
  const statusLabel = getInspectorSidebarStatusLabel({
    error,
    isLoading,
    chainCount: chains.length,
  });
  const selectionSubtitle = getInspectorSelectionSubtitle(pinnedCount);

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full w-80 shrink-0 flex-col border-r border-border/60 bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <InspectorSidebarHeader
          error={error}
          isLoading={isLoading}
          statusLabel={statusLabel}
          scoreColumn={scoreColumn}
          partition={partition}
          visibleChainCount={filteredChains.length}
          totalChains={totalChains}
          selectedCount={selectedCount}
          selectionSubtitle={selectionSubtitle}
          activeFilterCount={activeFilterCount}
          onRefresh={refresh}
          onClearFilters={clearAllFilters}
        />

        <ScrollArea className="flex-1">
          <div className="space-y-3 px-3 py-3">
            {chains.length > 0 ? (
              <>
                <InspectorSidebarQuickActions
                  chainIds={allChainIds}
                  selectedCount={selectedCount}
                  totalChains={totalChains}
                  hasSelection={hasSelection}
                  pinnedCount={pinnedCount}
                  onSelectAll={selectAll}
                  onClearSelection={clear}
                  onClearPins={clearPins}
                />

                <Separator className="bg-border/60" />

                <InspectorSidebarSection
                  icon={Layers}
                  title={t('inspector.sidebar.groups', 'Groups')}
                  help="Build shared comparison sets from model, preprocessing, score bands, branch structure, or expressions."
                >
                  <GroupBuilder />
                </InspectorSidebarSection>

                <InspectorSidebarSection
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
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={MousePointerClick}
                  title={t('inspector.sidebar.selection', 'Selection')}
                  badge={hasSelection ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {selectedCount}
                    </Badge>
                  ) : undefined}
                  help="Selection is shared across every inspector panel and drives the focused diagnostics cohort."
                >
                  <InspectorSidebarSelectionSummary
                    chainIds={allChainIds}
                    selectedCount={selectedCount}
                    totalChains={totalChains}
                    hasSelection={hasSelection}
                    pinnedCount={pinnedCount}
                    onSelectAll={selectAll}
                    onClearSelection={clear}
                    onClearPins={clearPins}
                  />
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={Bookmark}
                  title="Saved"
                  defaultOpen={false}
                  help="Persisted selections for revisiting named cohorts later in the analysis session."
                >
                  <InspectorSavedSelections />
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={Palette}
                  title={t('inspector.sidebar.colors', 'Colors')}
                  defaultOpen={false}
                  help="Global palette and opacity controls used to color every panel consistently."
                >
                  <ColorConfigPanel />
                </InspectorSidebarSection>
              </>
            ) : isLoading ? (
              <InspectorSidebarEmptyState
                title="Loading inspector data"
                description="Building the prediction scope and facet metadata."
              />
            ) : (
              <InspectorSidebarEmptyState
                title={t('inspector.noData', 'No data available')}
                description="Load predictions to unlock grouping, filtering, and shared selection."
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
