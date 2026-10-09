import { useTranslation, Trans } from 'react-i18next';
import {
  AlertCircle,
  Check,
  Filter,
  Focus,
  Layers,
  RotateCcw,
  Settings2,
  Target,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  NIR_ROI_PRESETS,
  type PartitionFilter,
  type SpectraChartConfig,
} from '@/lib/playground/spectraConfig';
import type { FoldsInfo } from '@/types/playground';
import type { SpectraSettingsReadModel } from './SpectraSettingsPopupData';

const FK = 'playground.charts.spectra.filter.';
const SK = 'playground.charts.spectra.settings.';

const PARTITION_OPTIONS: { value: PartitionFilter; labelKey: string }[] = [
  { value: 'all', labelKey: `${FK}partitionAll` },
  { value: 'train', labelKey: `${FK}partitionTrain` },
  { value: 'test', labelKey: `${FK}partitionTest` },
  { value: 'fold', labelKey: `${FK}partitionFold` },
  { value: 'oof', labelKey: `${FK}partitionOof` },
];

const QC_STATUS_OPTIONS: { value: 'all' | 'accepted' | 'rejected'; labelKey: string }[] = [
  { value: 'all', labelKey: `${FK}qcAll` },
  { value: 'accepted', labelKey: `${FK}qcAccepted` },
  { value: 'rejected', labelKey: `${FK}qcRejected` },
];

interface SpectraSettingsPopupContentProps {
  config: SpectraChartConfig;
  readModel: SpectraSettingsReadModel;
  wavelengthRange: [number, number];
  wavelengthCount: number;
  totalSamples: number;
  folds?: FoldsInfo | null;
  yRange?: [number, number];
  filteredSamples?: number;
  onReset: () => void;
  onResetFocus: () => void;
  onResetFilters: () => void;
  onPresetSelect: (presetId: string) => void;
  onWavelengthRangeChange: (range: [number, number]) => void;
  onDerivativeChange: (order: 0 | 1 | 2) => void;
  onEdgeMaskToggle: (enabled: boolean) => void;
  onEdgeMaskStartChange: (start: number) => void;
  onEdgeMaskEndChange: (end: number) => void;
  onPartitionChange: (partition: PartitionFilter) => void;
  onFoldIndexChange: (foldIndex: number) => void;
  onTargetRangeChange: (range: [number, number] | undefined) => void;
  onQCStatusChange: (status: 'all' | 'accepted' | 'rejected') => void;
}

export function SpectraSettingsPopupContent({
  config,
  readModel,
  wavelengthRange,
  wavelengthCount,
  totalSamples,
  folds,
  yRange,
  filteredSamples,
  onReset,
  onResetFocus,
  onResetFilters,
  onPresetSelect,
  onWavelengthRangeChange,
  onDerivativeChange,
  onEdgeMaskToggle,
  onEdgeMaskStartChange,
  onEdgeMaskEndChange,
  onPartitionChange,
  onFoldIndexChange,
  onTargetRangeChange,
  onQCStatusChange,
}: SpectraSettingsPopupContentProps) {
  const { t } = useTranslation();
  const {
    focusModifiedCount,
    filterModifiedCount,
    wavelengthRangeLabels,
    targetRangeLabels,
    metadataPreviewText,
  } = readModel;

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h4 className="text-xs font-semibold flex items-center gap-2">
          <Settings2 className="w-3.5 h-3.5 text-primary" />
          {t(`${SK}title`)}
        </h4>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={onReset}>
          <RotateCcw className="w-3 h-3 mr-1" />
          {t(`${SK}resetAll`)}
        </Button>
      </div>

      <Tabs defaultValue="focus" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b px-3 h-8 bg-transparent">
          <TabsTrigger value="focus" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
            <Focus className="w-3 h-3" />
            {t(`${SK}tabFocus`)}
            {focusModifiedCount > 0 && (
              <Badge variant="secondary" className="h-3.5 px-1 text-[8px] ml-0.5">
                {focusModifiedCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="filter" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
            <Filter className="w-3 h-3" />
            {t(`${SK}tabFilter`)}
            {filterModifiedCount > 0 && (
              <Badge variant="secondary" className="h-3.5 px-1 text-[8px] ml-0.5">
                {filterModifiedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="focus" className="p-3 space-y-3 m-0">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground">{t(`${SK}nirRegion`)}</Label>
              {focusModifiedCount > 0 && (
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={onResetFocus}>
                  <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                  {t('common.reset')}
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {NIR_ROI_PRESETS.slice(0, 6).map((preset) => (
                <Button
                  key={preset.id}
                  variant={config.wavelengthFocus.activePreset === preset.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-5 text-[9px] px-1.5"
                  onClick={() => onPresetSelect(preset.id)}
                >
                  {preset.name}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 block">{t(`${SK}wavelengthRange`)}</Label>
            <Slider
              value={config.wavelengthFocus.range ?? wavelengthRange}
              min={wavelengthRange[0]}
              max={wavelengthRange[1]}
              step={1}
              onValueChange={(value) => onWavelengthRangeChange(value as [number, number])}
              className="w-full"
            />
            <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-1">
              <span>{wavelengthRangeLabels.start}</span>
              <span>{wavelengthRangeLabels.end}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-[10px]">{t(`${SK}derivative`)}</Label>
            <div className="flex gap-0.5">
              {([0, 1, 2] as const).map((order) => (
                <Button
                  key={order}
                  variant={config.wavelengthFocus.derivative === order ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-5 w-6 text-[9px] px-0"
                  onClick={() => onDerivativeChange(order)}
                >
                  {order === 0 ? '0' : `d${order}`}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-[10px]">{t(`${SK}edgeMask`)}</Label>
            <Switch checked={config.wavelengthFocus.edgeMask.enabled} onCheckedChange={onEdgeMaskToggle} />
          </div>

          {config.wavelengthFocus.edgeMask.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[9px] text-muted-foreground">{t(`${SK}startPts`)}</Label>
                <Input
                  type="number"
                  min={0}
                  max={wavelengthCount / 2}
                  value={config.wavelengthFocus.edgeMask.start}
                  onChange={(event) => onEdgeMaskStartChange(parseInt(event.target.value) || 0)}
                  className="h-6 text-[10px]"
                />
              </div>
              <div>
                <Label className="text-[9px] text-muted-foreground">{t(`${SK}endPts`)}</Label>
                <Input
                  type="number"
                  min={0}
                  max={wavelengthCount / 2}
                  value={config.wavelengthFocus.edgeMask.end}
                  onChange={(event) => onEdgeMaskEndChange(parseInt(event.target.value) || 0)}
                  className="h-6 text-[10px]"
                />
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="filter" className="p-3 space-y-3 m-0">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {t(`${FK}dataPartition`)}
              </Label>
              {filterModifiedCount > 0 && (
                <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px]" onClick={onResetFilters}>
                  <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                  {t('common.reset')}
                </Button>
              )}
            </div>

            {folds && folds.n_folds > 0 ? (
              <div className="space-y-2">
                <Select value={config.filters.partition} onValueChange={(value) => onPartitionChange(value as PartitionFilter)}>
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PARTITION_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {t(option.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {config.filters.partition === 'fold' && folds && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: folds.n_folds }, (_, index) => (
                      <Button
                        key={index}
                        variant={config.filters.foldIndex === index ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-5 text-[9px] px-1.5"
                        onClick={() => onFoldIndexChange(index)}
                      >
                        {t(`${FK}foldN`, { n: index + 1 })}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded">
                {t(`${FK}addSplitter`)}
              </div>
            )}
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Target className="w-3 h-3" />
                {t(`${FK}targetRange`)}
              </Label>
              {config.filters.targetRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 w-5 p-0"
                  onClick={() => onTargetRangeChange(undefined)}
                  aria-label={t(`${FK}clearTargetRange`)}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>

            {yRange ? (
              <div className="space-y-1">
                <Slider
                  value={config.filters.targetRange ?? yRange}
                  min={yRange[0]}
                  max={yRange[1]}
                  step={(yRange[1] - yRange[0]) / 100}
                  onValueChange={(value) => onTargetRangeChange(value as [number, number])}
                  className="w-full"
                />
                {targetRangeLabels && (
                  <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                    <span>{targetRangeLabels.start}</span>
                    <span>{targetRangeLabels.end}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded">
                {t(`${FK}noYValues`)}
              </div>
            )}
          </div>

          <Separator />

          <div>
            <Label className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
              <Check className="w-3 h-3" />
              {t(`${FK}qcStatus`)}
            </Label>
            <Select
              value={config.filters.qcStatus ?? 'all'}
              onValueChange={(value) => onQCStatusChange(value as 'all' | 'accepted' | 'rejected')}
            >
              <SelectTrigger className="h-7 text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QC_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {metadataPreviewText && (
            <>
              <Separator />
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                  {t(`${FK}metadataFilters`)}
                </Label>
                <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" />
                  {metadataPreviewText}
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {filterModifiedCount > 0 && (
        <div className="px-3 py-2 border-t bg-muted/30 text-[10px] text-muted-foreground">
          {filteredSamples !== undefined ? (
            <span>
              <Trans
                i18nKey={`${FK}showing`}
                values={{ filtered: filteredSamples, total: totalSamples }}
                components={{ strong: <strong className="text-foreground" /> }}
              />
            </span>
          ) : (
            <span>{t(`${SK}filtersActive`, { count: filterModifiedCount })}</span>
          )}
        </div>
      )}
    </>
  );
}
