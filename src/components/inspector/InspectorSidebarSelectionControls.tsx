import { useTranslation } from 'react-i18next';
import { Pin, Sparkles, Target, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isInspectorSelectAllDisabled } from '@/lib/inspector/sidebarState';

interface InspectorSidebarSelectionControlProps {
  chainIds: string[];
  selectedCount: number;
  totalChains: number;
  hasSelection: boolean;
  pinnedCount: number;
  onSelectAll: (chainIds: string[]) => void;
  onClearSelection: () => void;
  onClearPins: () => void;
}

export function InspectorSidebarQuickActions({
  chainIds,
  selectedCount,
  totalChains,
  hasSelection,
  pinnedCount,
  onSelectAll,
  onClearSelection,
  onClearPins,
}: InspectorSidebarSelectionControlProps) {
  const { t } = useTranslation();
  const selectAllDisabled = isInspectorSelectAllDisabled({
    availableChainCount: chainIds.length,
    selectedCount,
    totalChains,
  });

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-8 flex-1 justify-start gap-2 text-xs"
        onClick={() => onSelectAll(chainIds)}
        disabled={selectAllDisabled}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {t('inspector.sidebar.selectAll')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 flex-1 justify-start gap-2 text-xs"
        onClick={hasSelection ? onClearSelection : onClearPins}
        disabled={!hasSelection && pinnedCount === 0}
      >
        <Target className="h-3.5 w-3.5" />
        {t('inspector.sidebar.clearFocus')}
      </Button>
    </div>
  );
}

export function InspectorSidebarSelectionSummary({
  chainIds,
  selectedCount,
  totalChains,
  hasSelection,
  pinnedCount,
  onSelectAll,
  onClearSelection,
  onClearPins,
}: InspectorSidebarSelectionControlProps) {
  const { t } = useTranslation();
  const selectAllDisabled = isInspectorSelectAllDisabled({
    availableChainCount: chainIds.length,
    selectedCount,
    totalChains,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <span>{t('inspector.counts.selected', { count: selectedCount })}</span>
        <span>{t('inspector.counts.pinned', { count: pinnedCount })}</span>
      </div>

      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={onClearSelection}
          disabled={!hasSelection}
        >
          <XCircle className="mr-1 h-3 w-3" />
          {t('common.clear')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={() => onSelectAll(chainIds)}
          disabled={selectAllDisabled}
        >
          {t('common.all')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 flex-1 text-xs"
          onClick={onClearPins}
          disabled={pinnedCount === 0}
        >
          <Pin className="mr-1 h-3 w-3" />
          {t('inspector.sidebar.pins')}
        </Button>
      </div>
    </div>
  );
}
