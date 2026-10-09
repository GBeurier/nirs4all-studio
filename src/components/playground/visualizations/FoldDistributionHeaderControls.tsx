import {
  LayoutGrid,
  Download,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FoldDistributionSettingsMenu } from './FoldDistributionSettingsMenu';
import { useTranslation } from 'react-i18next';

export type FoldViewMode = 'counts' | 'distribution' | 'both';

interface FoldDistributionHeaderControlsProps {
  splitterName: string;
  foldCount: number;
  viewMode: FoldViewMode;
  hasYStats: boolean;
  selectedFold: number | null;
  showLegend: boolean;
  showYLegend: boolean;
  showMeanLine: boolean;
  disableYLegend: boolean;
  disableMeanLine: boolean;
  onViewModeChange: (viewMode: FoldViewMode) => void;
  onClearFoldSelection: () => void;
  onShowLegendChange: (checked: boolean) => void;
  onShowYLegendChange: (checked: boolean) => void;
  onShowMeanLineChange: (checked: boolean) => void;
  onExport: () => void;
}

export function FoldDistributionHeaderControls({
  splitterName,
  foldCount,
  viewMode,
  hasYStats,
  selectedFold,
  showLegend,
  showYLegend,
  showMeanLine,
  disableYLegend,
  disableMeanLine,
  onViewModeChange,
  onClearFoldSelection,
  onShowLegendChange,
  onShowYLegendChange,
  onShowMeanLineChange,
  onExport,
}: FoldDistributionHeaderControlsProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <LayoutGrid className="w-4 h-4 text-primary" />
        {t('playground.charts.fold.header.foldCount', { name: splitterName, count: foldCount })}
      </h3>

      <div className="flex items-center gap-1.5">
        <Select
          value={viewMode}
          onValueChange={(value) => onViewModeChange(value as FoldViewMode)}
        >
          <SelectTrigger className="h-7 w-28 text-xs" aria-label={t('playground.charts.fold.header.viewModeLabel')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="counts">{t('playground.charts.fold.header.viewMode.counts')}</SelectItem>
            {hasYStats && <SelectItem value="distribution">{t('playground.charts.fold.header.viewMode.distribution')}</SelectItem>}
            {hasYStats && <SelectItem value="both">{t('playground.charts.fold.header.viewMode.both')}</SelectItem>}
          </SelectContent>
        </Select>

        {selectedFold !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              onClearFoldSelection();
            }}
          >
            {t('playground.charts.fold.header.clear')}
          </Button>
        )}

        <FoldDistributionSettingsMenu
          showLegend={showLegend}
          showYLegend={showYLegend}
          showMeanLine={showMeanLine}
          disableYLegend={disableYLegend}
          disableMeanLine={disableMeanLine}
          onShowLegendChange={onShowLegendChange}
          onShowYLegendChange={onShowYLegendChange}
          onShowMeanLineChange={onShowMeanLineChange}
        />

        <TooltipProvider delayDuration={200}>
          <TooltipUI>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onExport} aria-label={t('playground.charts.fold.header.exportData')}>
                <Download className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">{t('playground.charts.fold.header.exportData')}</p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>
      </div>
    </div>
  );
}
