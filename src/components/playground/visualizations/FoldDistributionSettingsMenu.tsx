import { ChevronDown, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';

export interface FoldDistributionSettingsMenuProps {
  showLegend: boolean;
  showYLegend: boolean;
  showMeanLine: boolean;
  disableYLegend: boolean;
  disableMeanLine: boolean;
  onShowLegendChange: (checked: boolean) => void;
  onShowYLegendChange: (checked: boolean) => void;
  onShowMeanLineChange: (checked: boolean) => void;
}

export function FoldDistributionSettingsMenu({
  showLegend,
  showYLegend,
  showMeanLine,
  disableYLegend,
  disableMeanLine,
  onShowLegendChange,
  onShowYLegendChange,
  onShowMeanLineChange,
}: FoldDistributionSettingsMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={t('playground.charts.fold.settings.displayOptions')}>
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{t('playground.charts.fold.settings.displayOptions')}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={showLegend}
          onCheckedChange={(checked) => onShowLegendChange(checked === true)}
        >
          {t('playground.charts.fold.settings.showColorLegend')}
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={showYLegend}
          onCheckedChange={(checked) => onShowYLegendChange(checked === true)}
          disabled={disableYLegend}
        >
          {t('playground.charts.fold.settings.showYLegend')}
        </DropdownMenuCheckboxItem>

        <DropdownMenuCheckboxItem
          checked={showMeanLine}
          onCheckedChange={(checked) => onShowMeanLineChange(checked === true)}
          disabled={disableMeanLine}
        >
          {t('playground.charts.fold.settings.showGlobalMean')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
