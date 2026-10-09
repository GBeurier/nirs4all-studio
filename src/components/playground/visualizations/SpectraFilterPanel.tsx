/**
 * SpectraFilterPanel - Filter controls for spectra subset selection
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Features:
 * - Split/Fold partition filter
 * - Target value range filter (dual-handle slider)
 * - Metadata column filters
 * - QC status filter
 * - Combined filter status display
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import {
  Filter,
  Layers,
  Target,
  ChevronDown,
  X,
  RotateCcw,
  Check,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  type SpectraFilterConfig,
  type PartitionFilter,
  DEFAULT_FILTER_CONFIG,
} from '@/lib/playground/spectraConfig';
import type { FoldsInfo } from '@/types/playground';

// ============= Types =============

export interface SpectraFilterPanelProps {
  /** Current filter configuration */
  config: SpectraFilterConfig;
  /** Callback when configuration changes */
  onChange: (config: Partial<SpectraFilterConfig>) => void;
  /** Fold information (if splitter is present) */
  folds?: FoldsInfo | null;
  /** Y value range for target filter */
  yRange?: [number, number];
  /** Available metadata columns */
  metadataColumns?: string[];
  /** Total samples before filtering */
  totalSamples: number;
  /** Filtered sample count */
  filteredSamples?: number;
  /** Callback when any setting changes (for triggering redraw) */
  onInteractionStart?: () => void;
  /** Compact mode */
  compact?: boolean;
}

// ============= Constants =============

const FK = 'playground.charts.spectra.filter.';

const PARTITION_OPTIONS: { value: PartitionFilter; labelKey: string; descriptionKey: string }[] = [
  { value: 'all', labelKey: `${FK}partitionAll`, descriptionKey: `${FK}partitionAllDesc` },
  { value: 'train', labelKey: `${FK}partitionTrain`, descriptionKey: `${FK}partitionTrainDesc` },
  { value: 'test', labelKey: `${FK}partitionTest`, descriptionKey: `${FK}partitionTestDesc` },
  { value: 'fold', labelKey: `${FK}partitionFold`, descriptionKey: `${FK}partitionFoldDesc` },
  { value: 'oof', labelKey: `${FK}partitionOof`, descriptionKey: `${FK}partitionOofDesc` },
];

const QC_STATUS_OPTIONS: { value: 'all' | 'accepted' | 'rejected'; labelKey: string }[] = [
  { value: 'all', labelKey: `${FK}qcAll` },
  { value: 'accepted', labelKey: `${FK}qcAccepted` },
  { value: 'rejected', labelKey: `${FK}qcRejected` },
];

// ============= Helper Functions =============

function countActiveFilters(config: SpectraFilterConfig): number {
  let count = 0;
  if (config.partition !== 'all') count++;
  if (config.targetRange) count++;
  if (config.qcStatus && config.qcStatus !== 'all') count++;
  if (config.metadataFilters && Object.keys(config.metadataFilters).length > 0) count++;
  return count;
}

// ============= Main Component =============

export function SpectraFilterPanel({
  config,
  onChange,
  folds,
  yRange,
  metadataColumns,
  totalSamples,
  filteredSamples,
  onInteractionStart,
  compact = false,
}: SpectraFilterPanelProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  // Count active filters
  const activeFilterCount = useMemo(() => countActiveFilters(config), [config]);

  // Check if any filters are active
  const hasActiveFilters = activeFilterCount > 0;

  // Compute filter description
  const filterDescription = useMemo(() => {
    const parts: string[] = [];

    if (config.partition !== 'all') {
      if (config.partition === 'fold' && config.foldIndex !== undefined) {
        parts.push(t(`${FK}foldN`, { n: config.foldIndex + 1 }));
      } else {
        const partitionKey = PARTITION_OPTIONS.find(o => o.value === config.partition)?.labelKey;
        parts.push(partitionKey ? t(partitionKey) : config.partition);
      }
    }

    if (config.targetRange) {
      parts.push(`Y: ${config.targetRange[0].toFixed(1)}-${config.targetRange[1].toFixed(1)}`);
    }

    if (config.qcStatus && config.qcStatus !== 'all') {
      parts.push(t(`${FK}descQc`, { status: t(config.qcStatus === 'accepted' ? `${FK}qcAcceptedShort` : `${FK}qcRejectedShort`) }));
    }

    return parts.join(', ');
  }, [config, t]);

  // Handle partition change
  const handlePartitionChange = useCallback((partition: PartitionFilter) => {
    onInteractionStart?.();
    onChange({
      partition,
      foldIndex: partition === 'fold' ? 0 : undefined,
    });
  }, [onChange, onInteractionStart]);

  // Handle fold index change
  const handleFoldIndexChange = useCallback((foldIndex: number) => {
    onInteractionStart?.();
    onChange({ foldIndex });
  }, [onChange, onInteractionStart]);

  // Handle target range change
  const handleTargetRangeChange = useCallback((range: [number, number] | undefined) => {
    onChange({ targetRange: range });
  }, [onChange]);

  // Handle QC status change
  const handleQCStatusChange = useCallback((status: 'all' | 'accepted' | 'rejected') => {
    onInteractionStart?.();
    onChange({ qcStatus: status });
  }, [onChange, onInteractionStart]);

  // Reset all filters
  const handleReset = useCallback(() => {
    onInteractionStart?.();
    onChange(DEFAULT_FILTER_CONFIG);
  }, [onChange, onInteractionStart]);

  return (
    <TooltipProvider>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'text-xs gap-1.5',
              compact ? 'h-7 px-2' : 'h-7 px-2.5',
              hasActiveFilters && 'border-primary/50 bg-primary/5'
            )}
          >
            <Filter className="w-3 h-3" />
            {hasActiveFilters ? (
              <>
                <span className="max-w-24 truncate">{filterDescription}</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                  {activeFilterCount}
                </Badge>
              </>
            ) : (
              t(`${FK}filters`)
            )}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              {t(`${FK}title`)}
              {filteredSamples !== undefined && filteredSamples !== totalSamples && (
                <Badge variant="outline" className="text-[10px]">
                  {filteredSamples}/{totalSamples}
                </Badge>
              )}
            </h4>
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleReset}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                {t(`${FK}clearAll`)}
              </Button>
            )}
          </div>

          <div className="p-3 space-y-4">
            {/* Partition Filter */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                <Layers className="w-3 h-3" />
                {t(`${FK}dataPartition`)}
              </Label>

              {folds && folds.n_folds > 0 ? (
                <div className="space-y-2">
                  <Select
                    value={config.partition}
                    onValueChange={(v) => handlePartitionChange(v as PartitionFilter)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTITION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          <div className="flex flex-col">
                            <span>{t(opt.labelKey)}</span>
                            <span className="text-[10px] text-muted-foreground">{t(opt.descriptionKey)}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Fold selector */}
                  {config.partition === 'fold' && folds && (
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: folds.n_folds }, (_, i) => (
                        <Button
                          key={i}
                          variant={config.foldIndex === i ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => handleFoldIndexChange(i)}
                        >
                          {t(`${FK}foldN`, { n: i + 1 })}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic p-2 bg-muted/50 rounded">
                  {t(`${FK}addSplitter`)}
                </div>
              )}
            </div>

            <Separator />

            {/* Target Range Filter */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs text-muted-foreground flex items-center gap-2">
                  <Target className="w-3 h-3" />
                  {t(`${FK}targetRange`)}
                </Label>
                {config.targetRange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => handleTargetRangeChange(undefined)}
                    aria-label={t(`${FK}clearTargetRange`)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                )}
              </div>

              {yRange ? (
                <div className="space-y-2">
                  <Slider
                    value={config.targetRange ?? yRange}
                    min={yRange[0]}
                    max={yRange[1]}
                    step={(yRange[1] - yRange[0]) / 100}
                    onValueChange={(value) => {
                      onInteractionStart?.();
                      handleTargetRangeChange(value as [number, number]);
                    }}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
                    <span>{(config.targetRange?.[0] ?? yRange[0]).toFixed(2)}</span>
                    <span>{(config.targetRange?.[1] ?? yRange[1]).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic p-2 bg-muted/50 rounded">
                  {t(`${FK}noYValues`)}
                </div>
              )}
            </div>

            <Separator />

            {/* QC Status Filter */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                <Check className="w-3 h-3" />
                {t(`${FK}qcStatus`)}
              </Label>
              <Select
                value={config.qcStatus ?? 'all'}
                onValueChange={(v) => handleQCStatusChange(v as 'all' | 'accepted' | 'rejected')}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QC_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Metadata Filters */}
            {metadataColumns && metadataColumns.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-xs text-muted-foreground mb-2 block">
                    {t(`${FK}metadataFilters`)}
                  </Label>
                  <div className="text-xs text-muted-foreground italic p-2 bg-muted/50 rounded flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    {t(`${FK}metadataComingSoon`, { columns: metadataColumns.slice(0, 3).join(', ') })}
                    {metadataColumns.length > 3 && t(`${FK}metadataMore`, { count: metadataColumns.length - 3 })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer with sample count */}
          {hasActiveFilters && (
            <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
              {filteredSamples !== undefined ? (
                <span>
                  <Trans
                    i18nKey={`${FK}showing`}
                    values={{ filtered: filteredSamples, total: totalSamples }}
                    components={{ strong: <strong className="text-foreground" /> }}
                  />
                </span>
              ) : (
                <span>{t(`${FK}filtersActive`)}</span>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export default SpectraFilterPanel;
