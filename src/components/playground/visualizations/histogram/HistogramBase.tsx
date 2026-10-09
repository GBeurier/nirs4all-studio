/**
 * HistogramBase - Shared layout wrapper for all histogram modes.
 *
 * Renders header (title, bin selector, settings, clear, export),
 * chart area (children), statistics footer, and color legend.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Download,
  Settings2,
  ChevronDown,
  MousePointer2,
  X,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  getCategoricalColor,
  getPresentPartitionRoles,
} from '@/lib/playground/colorConfig';
import { formatYValue } from '../chartConfig';
import { InlineColorLegend } from '../../ColorLegend';
import { cn } from '@/lib/utils';
import type { HistogramBaseProps, BinCountOption } from './types';
import {
  getHistogramPartitionRoleColor,
  getHistogramPartitionRoleLabel,
} from './utils';

export default function HistogramBase({
  chartRef,
  config,
  updateConfig,
  isClassificationMode,
  classBarData,
  isProcessed,
  displayStats,
  selectedSamples,
  selectedClasses,
  selectionCtx,
  compact,
  globalColorConfig,
  colorContext,
  handleExport,
  children,
}: HistogramBaseProps) {
  const { t } = useTranslation();
  const histogramPartitionRoles = globalColorConfig?.mode === 'partition' && colorContext
    ? getPresentPartitionRoles(colorContext)
    : [];

  const selectedOnlyLabel = config.selectedOnly
    ? t('playground.charts.histogram.selectedOnly.showAll')
    : selectedSamples.size > 0
      ? t('playground.charts.histogram.selectedOnly.showOnly', { count: selectedSamples.size })
      : t('playground.charts.histogram.selectedOnly.selectFirst');

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2 gap-1 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          {isClassificationMode ? t('playground.charts.histogram.titleClasses') : t('playground.charts.histogram.titleY')}
          {isProcessed && (
            <span className="text-[10px] text-muted-foreground font-normal">{t('playground.charts.histogram.processed')}</span>
          )}
          {isClassificationMode && (
            <span className="text-[10px] text-muted-foreground font-normal">
              {t('playground.charts.histogram.classCount', { count: colorContext?.classLabels?.length ?? 0 })}
            </span>
          )}
        </h3>

        <div className="flex items-center gap-1">
          {/* Bin count selector */}
          <Select
            value={config.binCount}
            onValueChange={(v) => updateConfig({ binCount: v as BinCountOption })}
          >
            <SelectTrigger className="h-7 w-16 text-xs" aria-label={t('playground.charts.histogram.binCountLabel')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('playground.charts.histogram.binAuto')}</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="30">30</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>

          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant={config.selectedOnly ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2"
                    disabled={selectedSamples.size === 0}
                    onClick={() => updateConfig({ selectedOnly: !config.selectedOnly })}
                    aria-label={selectedOnlyLabel}
                  >
                    <MousePointer2 className="w-3 h-3" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {selectedOnlyLabel}
                </p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>

          {/* Settings dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2" aria-label={t('playground.charts.histogram.options.title')}>
                <Settings2 className="w-3 h-3" />
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{t('playground.charts.histogram.options.title')}</DropdownMenuLabel>
              <DropdownMenuSeparator />

              <DropdownMenuCheckboxItem
                checked={config.showMean}
                onCheckedChange={(checked) => updateConfig({ showMean: checked })}
              >
                {t('playground.charts.histogram.options.showMean')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={config.showMedian}
                onCheckedChange={(checked) => updateConfig({ showMedian: checked })}
              >
                {t('playground.charts.histogram.options.showMedian')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={config.showKDE}
                onCheckedChange={(checked) => updateConfig({ showKDE: checked })}
              >
                {t('playground.charts.histogram.options.showKde')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={config.showStdBands}
                onCheckedChange={(checked) => updateConfig({ showStdBands: checked })}
              >
                {t('playground.charts.histogram.options.showStdBands')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('playground.charts.histogram.options.yAxis')}</DropdownMenuLabel>

              <DropdownMenuCheckboxItem
                checked={config.yAxisType === 'count'}
                onCheckedChange={() => updateConfig({ yAxisType: 'count' })}
              >
                {t('playground.charts.histogram.yAxis.count')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={config.yAxisType === 'frequency'}
                onCheckedChange={() => updateConfig({ yAxisType: 'frequency' })}
              >
                {t('playground.charts.histogram.yAxis.frequency')}
              </DropdownMenuCheckboxItem>

              <DropdownMenuCheckboxItem
                checked={config.yAxisType === 'density'}
                onCheckedChange={() => updateConfig({ yAxisType: 'density' })}
              >
                {t('playground.charts.histogram.yAxis.density')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear selection button */}
          {selectionCtx && selectionCtx.selectedSamples.size > 0 && (
            <TooltipProvider delayDuration={200}>
              <TooltipUI>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-foreground"
                    onClick={() => selectionCtx.clear()}
                    aria-label={t('playground.charts.histogram.clearSelection', { count: selectionCtx.selectedSamples.size })}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">{t('playground.charts.histogram.clearSelection', { count: selectionCtx.selectedSamples.size })}</p>
                </TooltipContent>
              </TooltipUI>
            </TooltipProvider>
          )}

          {/* Export button */}
          <TooltipProvider delayDuration={200}>
            <TooltipUI>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport} aria-label={t('playground.charts.histogram.exportChart')}>
                  <Download className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{t('playground.charts.histogram.exportChart')}</p>
              </TooltipContent>
            </TooltipUI>
          </TooltipProvider>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {children}
      </div>

      {/* Statistics footer */}
      {!compact && (
        <div className="flex items-center justify-between mt-2">
          {isClassificationMode ? (
            // Phase 5: Class distribution stats
            <div className="flex items-center gap-3 text-[10px] flex-1 overflow-x-auto">
              {classBarData.slice(0, 6).map((bar, idx) => (
                <div
                  key={bar.classLabel}
                  className={cn(
                    'flex items-center gap-1.5 shrink-0',
                    selectedClasses.has(idx) && 'font-medium'
                  )}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: globalColorConfig
                        ? getCategoricalColor(idx, globalColorConfig.categoricalPalette)
                        : getCategoricalColor(idx, 'default'),
                    }}
                  />
                  <span className="text-muted-foreground truncate max-w-[60px]">{bar.classLabel}</span>
                  <span className="font-mono">{bar.count}</span>
                </div>
              ))}
              {classBarData.length > 6 && (
                <span className="text-muted-foreground">{t('playground.charts.histogram.moreClasses', { count: classBarData.length - 6 })}</span>
              )}
            </div>
          ) : (
            // Regression stats
            <div className="grid grid-cols-5 gap-1 text-[10px] flex-1">
              {[
                { label: t('playground.charts.histogram.stats.mean'), value: displayStats?.mean ?? 0, highlight: config.showMean },
                { label: t('playground.charts.histogram.stats.median'), value: displayStats?.median ?? 0, highlight: config.showMedian },
                { label: t('playground.charts.histogram.stats.std'), value: displayStats?.std ?? 0 },
                { label: t('playground.charts.histogram.stats.min'), value: displayStats?.min ?? 0 },
                { label: t('playground.charts.histogram.stats.max'), value: displayStats?.max ?? 0 },
              ].map(({ label, value, highlight }) => (
                <div
                  key={label}
                  className={cn(
                    'bg-muted rounded p-1 text-center',
                    highlight && 'ring-1 ring-primary/50',
                    selectedSamples.size > 0 && 'ring-1 ring-primary/30'
                  )}
                >
                  <div className="text-muted-foreground">{label}</div>
                  <div className="font-mono font-medium">{formatYValue(value, 1)}</div>
                </div>
              ))}
            </div>
          )}
          {selectedSamples.size > 0 && (
            <div className="text-[10px] text-primary font-medium ml-2">
              {t('playground.charts.histogram.selectedAbbrev', { count: selectedSamples.size })}
            </div>
          )}
        </div>
      )}

      {/* Color legend */}
      {globalColorConfig && colorContext && !compact && (
        <div className="mt-2">
          {globalColorConfig.mode === 'partition' && histogramPartitionRoles.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {histogramPartitionRoles.map((role) => (
                <div key={role} className="flex items-center gap-1.5">
                  <div
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ backgroundColor: getHistogramPartitionRoleColor(role) }}
                  />
                  <span className="text-[9px] text-muted-foreground truncate max-w-[60px]">
                    {getHistogramPartitionRoleLabel(role, t)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <InlineColorLegend config={globalColorConfig} context={colorContext} />
          )}
        </div>
      )}
    </div>
  );
}
