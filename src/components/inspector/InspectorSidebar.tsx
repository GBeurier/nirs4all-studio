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
  const selectionSubtitle = getInspectorSelectionSubtitle(pinnedCount, t);

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
                  title={t('inspector.sidebar.groups')}
                  help={t('inspector.sidebar.groupsHelp')}
                >
                  <GroupBuilder />
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={Filter}
                  title={t('inspector.sidebar.filters')}
                  badge={activeFilterCount > 0 ? (
                    <Badge variant="secondary" className="h-5 min-w-5 justify-center rounded-full px-1 text-[10px]">
                      {activeFilterCount}
                    </Badge>
                  ) : undefined}
                  help={t('inspector.sidebar.filtersHelp')}
                >
                  <FilterPanel />
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={MousePointerClick}
                  title={t('inspector.sidebar.selection')}
                  badge={hasSelection ? (
                    <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                      {selectedCount}
                    </Badge>
                  ) : undefined}
                  help={t('inspector.sidebar.selectionHelp')}
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
                  title={t('inspector.sidebar.savedTitle')}
                  defaultOpen={false}
                  help={t('inspector.sidebar.savedHelp')}
                >
                  <InspectorSavedSelections />
                </InspectorSidebarSection>

                <InspectorSidebarSection
                  icon={Palette}
                  title={t('inspector.sidebar.colors')}
                  defaultOpen={false}
                  help={t('inspector.sidebar.colorsHelp')}
                >
                  <ColorConfigPanel />
                </InspectorSidebarSection>
              </>
            ) : isLoading ? (
              <InspectorSidebarEmptyState
                title={t('inspector.sidebar.loadingTitle')}
                description={t('inspector.sidebar.loadingDescription')}
              />
            ) : (
              <InspectorSidebarEmptyState
                title={t('inspector.noData')}
                description={t('inspector.sidebar.emptyDescription')}
              />
            )}
          </div>
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
