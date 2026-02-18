/**
 * InspectorSidebar — Left sidebar for Inspector page.
 *
 * Contains: Source Selector, Filter Panel, Color Config, Group Builder, Selection Info.
 */

import { useTranslation } from 'react-i18next';
import { Search, RefreshCw, XCircle, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useInspectorData } from '@/context/InspectorDataContext';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import { SourceSelector } from './SourceSelector';
import { FilterPanel } from './FilterPanel';
import { ColorConfigPanel } from './ColorConfigPanel';
import { GroupBuilder } from './GroupBuilder';
import { InspectorSavedSelections } from './InspectorSavedSelections';

export function InspectorSidebar() {
  const { t } = useTranslation();
  const { chains, isLoading, error, refresh, totalChains } = useInspectorData();
  const { selectedCount, hasSelection, clear, selectAll, pinnedCount, clearPins } = useInspectorSelection();

  return (
    <div className="w-80 border-r border-border bg-card/50 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-semibold">{t('inspector.title', 'Inspector')}</h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Prediction Explorer & Model Performance Analyzer
        </p>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Source Selection */}
          <SourceSelector />

          <Separator className="opacity-50" />

          {/* Status */}
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded p-2">
              {error}
            </div>
          )}

          {chains.length > 0 && (
            <>
              {/* Filter Panel */}
              <FilterPanel />

              <Separator className="opacity-50" />

              {/* Color Config */}
              <ColorConfigPanel />

              <Separator className="opacity-50" />

              {/* Group Builder */}
              <GroupBuilder />

              <Separator className="opacity-50" />

              {/* Selection Info */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">
                    {t('inspector.sidebar.selection', 'Selection')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {hasSelection
                      ? `${selectedCount} / ${totalChains}`
                      : `${totalChains} chains`
                    }
                  </span>
                </div>

                <div className="flex gap-1.5">
                  {hasSelection && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={clear}
                    >
                      <XCircle className="w-3 h-3 mr-1" />
                      {t('inspector.sidebar.clearSelection', 'Clear')}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs flex-1"
                    onClick={() => selectAll(chains.map(c => c.chain_id))}
                    disabled={selectedCount === totalChains}
                  >
                    Select All
                  </Button>
                </div>

                {/* Pinned chains */}
                {pinnedCount > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Pin className="w-3 h-3" />
                      {t('inspector.sidebar.pinnedChains', 'Pinned Chains')}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {pinnedCount}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-[10px]"
                        onClick={clearPins}
                      >
                        {t('inspector.sidebar.clearPins', 'Clear Pins')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <Separator className="opacity-50" />

              {/* Saved Selections */}
              <InspectorSavedSelections />
            </>
          )}

          {chains.length === 0 && !isLoading && !error && (
            <div className="text-center text-sm text-muted-foreground py-8">
              <p>{t('inspector.noData', 'No data available.')}</p>
              <p className="mt-1 text-xs">Select a run or dataset, or run a pipeline first.</p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-border/50">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={refresh}
          disabled={isLoading}
        >
          <RefreshCw className={`w-3 h-3 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
