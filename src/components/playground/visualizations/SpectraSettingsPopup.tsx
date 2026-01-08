/**
 * SpectraSettingsPopup - Focus and Filter settings for SpectraChart
 *
 * Phase 3 Implementation: Enhanced Spectra Visualization
 *
 * Features:
 * - Focus tab: Wavelength range, ROI presets, edge mask, derivative
 * - Filter tab: Partition filter, target range, QC status
 *
 * Note: View, Display, Sampling, and Color settings are now in the toolbar
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Settings2,
  Layers,
  Target,
  RotateCcw,
  Check,
  AlertCircle,
  Focus,
  Filter,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import {
  NIR_ROI_PRESETS,
  type PartitionFilter,
  DEFAULT_FILTER_CONFIG,
} from '@/lib/playground/spectraConfig';
import type { UnifiedOperator, FoldsInfo } from '@/types/playground';

// ============= Types =============

export interface SpectraSettingsPopupProps {
  /** Config hook result */
  configResult: UseSpectraChartConfigResult;
  /** Available operators for step selection */
  operators?: UnifiedOperator[];
  /** Available metadata columns */
  metadataColumns?: string[];
  /** Total samples in dataset */
  totalSamples: number;
  /** Wavelength range [min, max] */
  wavelengthRange: [number, number];
  /** Wavelength count */
  wavelengthCount: number;
  /** Callback when any setting changes */
  onInteractionStart?: () => void;
  /** Compact mode for smaller containers */
  compact?: boolean;
  /** Controlled open state (optional) */
  open?: boolean;
  /** Callback when open state changes (optional) */
  onOpenChange?: (open: boolean) => void;
  /** Fold information for filter panel */
  folds?: FoldsInfo | null;
  /** Y value range for target filter */
  yRange?: [number, number];
  /** Filtered sample count */
  filteredSamples?: number;
}

// ============= Constants =============

const PARTITION_OPTIONS: { value: PartitionFilter; label: string; description: string }[] = [
  { value: 'all', label: 'All', description: 'Show all samples' },
  { value: 'train', label: 'Train', description: 'Training set only' },
  { value: 'test', label: 'Test', description: 'Test set only' },
  { value: 'fold', label: 'Specific Fold', description: 'Show specific fold' },
  { value: 'oof', label: 'Out-of-Fold', description: 'OOF predictions' },
];

const QC_STATUS_OPTIONS: { value: 'all' | 'accepted' | 'rejected'; label: string }[] = [
  { value: 'all', label: 'All QC Status' },
  { value: 'accepted', label: 'Accepted Only' },
  { value: 'rejected', label: 'Rejected Only' },
];

// ============= Main Component =============

export function SpectraSettingsPopup({
  configResult,
  operators = [],
  metadataColumns = [],
  totalSamples,
  wavelengthRange,
  wavelengthCount,
  onInteractionStart,
  compact = false,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  folds,
  yRange,
  filteredSamples,
}: SpectraSettingsPopupProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = externalOnOpenChange ?? setInternalOpen;

  const { config } = configResult;

  // Count modified settings
  const modifiedCount = useMemo(() => {
    let count = 0;
    // Focus settings
    if (config.wavelengthFocus.range !== null) count++;
    if (config.wavelengthFocus.derivative > 0) count++;
    if (config.wavelengthFocus.edgeMask.enabled) count++;
    // Filter settings
    if (config.filters.partition !== 'all') count++;
    if (config.filters.targetRange) count++;
    if (config.filters.qcStatus && config.filters.qcStatus !== 'all') count++;
    return count;
  }, [config]);

  // Handle wavelength range change
  const handleWavelengthRangeChange = useCallback((range: [number, number]) => {
    onInteractionStart?.();
    configResult.setWavelengthRange(range);
  }, [configResult, onInteractionStart]);

  // Handle derivative change
  const handleDerivativeChange = useCallback((order: 0 | 1 | 2) => {
    onInteractionStart?.();
    configResult.setDerivative(order);
  }, [configResult, onInteractionStart]);

  // Handle edge mask toggle
  const handleEdgeMaskToggle = useCallback((enabled: boolean) => {
    onInteractionStart?.();
    configResult.setEdgeMask(enabled);
  }, [configResult, onInteractionStart]);

  // Handle ROI preset selection
  const handlePresetSelect = useCallback((presetId: string) => {
    onInteractionStart?.();
    const preset = NIR_ROI_PRESETS.find(p => p.id === presetId);
    if (preset) {
      if (preset.id === 'full') {
        configResult.setWavelengthRange(null);
      } else {
        configResult.setWavelengthRange(preset.range);
      }
      configResult.setActivePreset(presetId);
    }
  }, [configResult, onInteractionStart]);

  // Handle partition change
  const handlePartitionChange = useCallback((partition: PartitionFilter) => {
    onInteractionStart?.();
    configResult.updateFilters({
      partition,
      foldIndex: partition === 'fold' ? 0 : undefined,
    });
  }, [configResult, onInteractionStart]);

  // Handle fold index change
  const handleFoldIndexChange = useCallback((foldIndex: number) => {
    onInteractionStart?.();
    configResult.updateFilters({ foldIndex });
  }, [configResult, onInteractionStart]);

  // Handle target range change
  const handleTargetRangeChange = useCallback((range: [number, number] | undefined) => {
    onInteractionStart?.();
    configResult.updateFilters({ targetRange: range });
  }, [configResult, onInteractionStart]);

  // Handle QC status change
  const handleQCStatusChange = useCallback((status: 'all' | 'accepted' | 'rejected') => {
    onInteractionStart?.();
    configResult.updateFilters({ qcStatus: status });
  }, [configResult, onInteractionStart]);

  // Reset all settings
  const handleReset = useCallback(() => {
    onInteractionStart?.();
    configResult.resetConfig();
  }, [configResult, onInteractionStart]);

  // Reset focus settings
  const handleResetFocus = useCallback(() => {
    onInteractionStart?.();
    configResult.setWavelengthRange(null);
    configResult.setDerivative(0);
    configResult.setEdgeMask(false);
    configResult.setActivePreset('full');
  }, [configResult, onInteractionStart]);

  // Reset filter settings
  const handleResetFilters = useCallback(() => {
    onInteractionStart?.();
    configResult.updateFilters(DEFAULT_FILTER_CONFIG);
  }, [configResult, onInteractionStart]);

  // Count focus modifications
  const focusModifiedCount = useMemo(() => {
    let count = 0;
    if (config.wavelengthFocus.range !== null) count++;
    if (config.wavelengthFocus.derivative > 0) count++;
    if (config.wavelengthFocus.edgeMask.enabled) count++;
    return count;
  }, [config.wavelengthFocus]);

  // Count filter modifications
  const filterModifiedCount = useMemo(() => {
    let count = 0;
    if (config.filters.partition !== 'all') count++;
    if (config.filters.targetRange) count++;
    if (config.filters.qcStatus && config.filters.qcStatus !== 'all') count++;
    return count;
  }, [config.filters]);

  // When externally controlled (open/onOpenChange provided), render just the popover content
  const isExternallyControlled = externalOpen !== undefined;

  // Render only the content when externally controlled (no trigger button)
  if (isExternallyControlled) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        {/* Empty trigger - required by Radix but hidden */}
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>

        <PopoverContent side="bottom" align="start" className="w-[340px] p-0" sideOffset={4}>
          {renderSettingsContent()}
        </PopoverContent>
      </Popover>
    );
  }

  // Standalone mode - render with built-in trigger button
  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={modifiedCount > 0 ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 gap-1"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {modifiedCount > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">
                    {modifiedCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Focus & Filter settings</TooltipContent>
        </Tooltip>

        <PopoverContent side="bottom" align="start" className="w-[340px] p-0" sideOffset={4}>
          {renderSettingsContent()}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );

  // Extracted content renderer for reuse
  function renderSettingsContent() {
    return (
      <>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h4 className="text-xs font-semibold flex items-center gap-2">
            <Settings2 className="w-3.5 h-3.5 text-primary" />
            Spectra Settings
          </h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={handleReset}
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset All
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="focus" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b px-3 h-8 bg-transparent">
            <TabsTrigger value="focus" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Focus className="w-3 h-3" />
              Focus
              {focusModifiedCount > 0 && (
                <Badge variant="secondary" className="h-3.5 px-1 text-[8px] ml-0.5">
                  {focusModifiedCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="filter" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Filter className="w-3 h-3" />
              Filter
              {filterModifiedCount > 0 && (
                <Badge variant="secondary" className="h-3.5 px-1 text-[8px] ml-0.5">
                  {filterModifiedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Focus Tab */}
          <TabsContent value="focus" className="p-3 space-y-3 m-0">
            {/* ROI Presets */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] text-muted-foreground">NIR Region</Label>
                {focusModifiedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[9px]"
                    onClick={handleResetFocus}
                  >
                    <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                    Reset
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
                    onClick={() => handlePresetSelect(preset.id)}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Wavelength Range */}
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Wavelength Range</Label>
              <Slider
                value={config.wavelengthFocus.range ?? wavelengthRange}
                min={wavelengthRange[0]}
                max={wavelengthRange[1]}
                step={1}
                onValueChange={(value) => handleWavelengthRangeChange(value as [number, number])}
                className="w-full"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground font-mono mt-1">
                <span>{(config.wavelengthFocus.range?.[0] ?? wavelengthRange[0]).toFixed(0)} nm</span>
                <span>{(config.wavelengthFocus.range?.[1] ?? wavelengthRange[1]).toFixed(0)} nm</span>
              </div>
            </div>

            {/* Derivative */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px]">Derivative</Label>
              <div className="flex gap-0.5">
                {([0, 1, 2] as const).map((order) => (
                  <Button
                    key={order}
                    variant={config.wavelengthFocus.derivative === order ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-5 w-6 text-[9px] px-0"
                    onClick={() => handleDerivativeChange(order)}
                  >
                    {order === 0 ? '0' : `d${order}`}
                  </Button>
                ))}
              </div>
            </div>

            {/* Edge Masking */}
            <div className="flex items-center justify-between">
              <Label className="text-[10px]">Edge Mask</Label>
              <Switch
                checked={config.wavelengthFocus.edgeMask.enabled}
                onCheckedChange={handleEdgeMaskToggle}
              />
            </div>

            {config.wavelengthFocus.edgeMask.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[9px] text-muted-foreground">Start pts</Label>
                  <Input
                    type="number"
                    min={0}
                    max={wavelengthCount / 2}
                    value={config.wavelengthFocus.edgeMask.start}
                    onChange={(e) => {
                      onInteractionStart?.();
                      configResult.setEdgeMask(
                        true,
                        parseInt(e.target.value) || 0,
                        config.wavelengthFocus.edgeMask.end
                      );
                    }}
                    className="h-6 text-[10px]"
                  />
                </div>
                <div>
                  <Label className="text-[9px] text-muted-foreground">End pts</Label>
                  <Input
                    type="number"
                    min={0}
                    max={wavelengthCount / 2}
                    value={config.wavelengthFocus.edgeMask.end}
                    onChange={(e) => {
                      onInteractionStart?.();
                      configResult.setEdgeMask(
                        true,
                        config.wavelengthFocus.edgeMask.start,
                        parseInt(e.target.value) || 0
                      );
                    }}
                    className="h-6 text-[10px]"
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* Filter Tab */}
          <TabsContent value="filter" className="p-3 space-y-3 m-0">
            {/* Partition Filter */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Layers className="w-3 h-3" />
                  Data Partition
                </Label>
                {filterModifiedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[9px]"
                    onClick={handleResetFilters}
                  >
                    <RotateCcw className="w-2.5 h-2.5 mr-0.5" />
                    Reset
                  </Button>
                )}
              </div>

              {folds && folds.n_folds > 0 ? (
                <div className="space-y-2">
                  <Select
                    value={config.filters.partition}
                    onValueChange={(v) => handlePartitionChange(v as PartitionFilter)}
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARTITION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Fold selector */}
                  {config.filters.partition === 'fold' && folds && (
                    <div className="flex flex-wrap gap-1">
                      {Array.from({ length: folds.n_folds }, (_, i) => (
                        <Button
                          key={i}
                          variant={config.filters.foldIndex === i ? 'secondary' : 'outline'}
                          size="sm"
                          className="h-5 text-[9px] px-1.5"
                          onClick={() => handleFoldIndexChange(i)}
                        >
                          Fold {i + 1}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded">
                  Add a splitter to filter by partition/fold
                </div>
              )}
            </div>

            <Separator />

            {/* Target Range Filter */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Target className="w-3 h-3" />
                  Target Value Range
                </Label>
                {config.filters.targetRange && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 w-5 p-0"
                    onClick={() => handleTargetRangeChange(undefined)}
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
                    onValueChange={(value) => handleTargetRangeChange(value as [number, number])}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[9px] text-muted-foreground font-mono">
                    <span>{(config.filters.targetRange?.[0] ?? yRange[0]).toFixed(2)}</span>
                    <span>{(config.filters.targetRange?.[1] ?? yRange[1]).toFixed(2)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded">
                  No Y values available
                </div>
              )}
            </div>

            <Separator />

            {/* QC Status Filter */}
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                <Check className="w-3 h-3" />
                QC Status
              </Label>
              <Select
                value={config.filters.qcStatus ?? 'all'}
                onValueChange={(v) => handleQCStatusChange(v as 'all' | 'accepted' | 'rejected')}
              >
                <SelectTrigger className="h-7 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QC_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
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
                  <Label className="text-[10px] text-muted-foreground mb-1.5 block">
                    Metadata Filters
                  </Label>
                  <div className="text-[10px] text-muted-foreground italic p-2 bg-muted/50 rounded flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    Coming soon: Filter by {metadataColumns.slice(0, 2).join(', ')}
                    {metadataColumns.length > 2 && ` +${metadataColumns.length - 2} more`}
                  </div>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Footer with sample count */}
        {filterModifiedCount > 0 && (
          <div className="px-3 py-2 border-t bg-muted/30 text-[10px] text-muted-foreground">
            {filteredSamples !== undefined ? (
              <span>
                Showing <strong className="text-foreground">{filteredSamples}</strong> of {totalSamples} samples
              </span>
            ) : (
              <span>{filterModifiedCount} filter{filterModifiedCount > 1 ? 's' : ''} active</span>
            )}
          </div>
        )}
      </>
    );
  }
}

export default SpectraSettingsPopup;
