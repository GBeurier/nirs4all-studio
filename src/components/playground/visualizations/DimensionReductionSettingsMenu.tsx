import { ChevronDown, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from 'react-i18next';

export type DimensionReductionPointSize = 'small' | 'medium' | 'large';
export type DimensionReductionColorMode = 'target' | 'fold' | 'metadata';

export interface DimensionReductionSettingsMenuProps {
  pointSize: DimensionReductionPointSize;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  showEqualAxisScale: boolean;
  showLegacyColorOptions: boolean;
  hasFolds: boolean;
  metadataKeys: string[];
  onPointSizeChange: (pointSize: DimensionReductionPointSize) => void;
  onShowGridChange: (checked: boolean) => void;
  onPreserveAspectRatioChange: (checked: boolean) => void;
  onColorModeChange: (colorMode: DimensionReductionColorMode) => void;
  onMetadataKeyChange: (metadataKey: string) => void;
}

export function DimensionReductionSettingsMenu({
  pointSize,
  showGrid,
  preserveAspectRatio,
  colorMode,
  metadataKey,
  showEqualAxisScale,
  showLegacyColorOptions,
  hasFolds,
  metadataKeys,
  onPointSizeChange,
  onShowGridChange,
  onPreserveAspectRatioChange,
  onColorModeChange,
  onMetadataKeyChange,
}: DimensionReductionSettingsMenuProps) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={t('playground.charts.dimReduction.settings.title')}>
          <Settings2 className="w-3 h-3" />
          <ChevronDown className="w-3 h-3 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t('playground.charts.dimReduction.settings.pointSize')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pointSize}
          onValueChange={(value) => onPointSizeChange(value as DimensionReductionPointSize)}
        >
          <DropdownMenuRadioItem value="small">{t('playground.charts.dimReduction.settings.small')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="medium">{t('playground.charts.dimReduction.settings.medium')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="large">{t('playground.charts.dimReduction.settings.large')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuCheckboxItem
          checked={showGrid}
          onCheckedChange={(checked) => onShowGridChange(checked === true)}
        >
          {t('playground.charts.dimReduction.settings.showGrid')}
        </DropdownMenuCheckboxItem>

        {showEqualAxisScale && (
          <DropdownMenuCheckboxItem
            checked={preserveAspectRatio}
            onCheckedChange={(checked) => onPreserveAspectRatioChange(checked === true)}
          >
            {t('playground.charts.dimReduction.settings.equalAxisScale')}
          </DropdownMenuCheckboxItem>
        )}

        {showLegacyColorOptions && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">{t('playground.charts.dimReduction.settings.colorBy')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={colorMode}
              onValueChange={(value) => onColorModeChange(value as DimensionReductionColorMode)}
            >
              <DropdownMenuRadioItem value="target">{t('playground.charts.dimReduction.settings.yValue')}</DropdownMenuRadioItem>
              {hasFolds && (
                <DropdownMenuRadioItem value="fold">{t('playground.charts.dimReduction.settings.fold')}</DropdownMenuRadioItem>
              )}
              {metadataKeys.length > 0 && (
                <DropdownMenuRadioItem value="metadata">{t('playground.charts.dimReduction.settings.metadata')}</DropdownMenuRadioItem>
              )}
            </DropdownMenuRadioGroup>

            {colorMode === 'metadata' && metadataKeys.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t('playground.charts.dimReduction.settings.field')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={metadataKey || metadataKeys[0]}
                  onValueChange={onMetadataKeyChange}
                >
                  {metadataKeys.slice(0, 10).map(key => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {key}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
