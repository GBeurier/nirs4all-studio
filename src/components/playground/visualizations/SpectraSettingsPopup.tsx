/**
 * SpectraSettingsPopup - Comprehensive settings dialog for SpectraChart
 *
 * Phase 3 Implementation: Enhanced Spectra Visualization
 *
 * Features:
 * - Tabbed interface for organized settings
 * - Tab 1: View Mode (before/after/both/difference, reference step)
 * - Tab 2: Display Mode (lines/envelope/median/grouped, selected-only)
 * - Tab 3: Coloring (source, palette, opacity, selection highlighting)
 * - Tab 4: Sampling (strategy, count, seed)
 * - Tab 5: Focus (wavelength range, ROI presets, edge mask, derivative)
 *
 * Performance: Settings are memoized and changes are batched
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Settings2,
  Layers,
  Eye,
  Palette,
  Shuffle,
  Sliders,
  ChevronDown,
  RotateCcw,
  Check,
  TrendingUp,
  Scissors,
  Target,
  Users,
  Pin,
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type {
  SpectraViewMode,
  SpectraDisplayMode,
  SpectraColorMode,
  AggregationMode,
  SamplingStrategy,
} from '@/lib/playground/spectraConfig';
import { NIR_ROI_PRESETS } from '@/lib/playground/spectraConfig';
import type { UnifiedOperator } from '@/types/playground';

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
}

// ============= Constants =============

const VIEW_MODE_OPTIONS: { value: SpectraViewMode; label: string; description: string }[] = [
  { value: 'processed', label: 'Processed', description: 'Show final processed spectra' },
  { value: 'original', label: 'Original', description: 'Show original raw spectra' },
  { value: 'both', label: 'Both', description: 'Overlay original and processed' },
  { value: 'difference', label: 'Difference', description: 'Show difference (processed - original)' },
];

const DISPLAY_MODE_OPTIONS: { value: SpectraDisplayMode; label: string; description: string }[] = [
  { value: 'individual', label: 'Individual Lines', description: 'Show each spectrum as a line' },
  { value: 'selected_only', label: 'Selected Only', description: 'Show only selected samples' },
  { value: 'aggregated', label: 'Aggregated', description: 'Show statistical summary' },
  { value: 'grouped', label: 'Grouped', description: 'Group by metadata column' },
];

const AGGREGATION_MODE_OPTIONS: { value: AggregationMode; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'Show individual spectra' },
  { value: 'mean_std', label: 'Mean ± Std', description: 'Mean with standard deviation band' },
  { value: 'median_quantiles', label: 'Median + Quantiles', description: 'Median with p5-p95 band' },
  { value: 'minmax', label: 'Min/Max Envelope', description: 'Show min/max range' },
  { value: 'density', label: 'Density', description: '2D density visualization' },
];

const COLOR_MODE_OPTIONS: { value: SpectraColorMode; label: string; icon: React.ReactNode }[] = [
  { value: 'target', label: 'By Y Value', icon: <Target className="w-3 h-3" /> },
  { value: 'fold', label: 'By Fold', icon: <Layers className="w-3 h-3" /> },
  { value: 'partition', label: 'By Partition', icon: <Users className="w-3 h-3" /> },
  { value: 'metadata', label: 'By Metadata', icon: <Palette className="w-3 h-3" /> },
  { value: 'selection', label: 'By Selection', icon: <Check className="w-3 h-3" /> },
  { value: 'outlier', label: 'By Outlier Status', icon: <TrendingUp className="w-3 h-3" /> },
];

const SAMPLING_STRATEGY_OPTIONS: { value: SamplingStrategy; label: string; description: string }[] = [
  { value: 'random', label: 'Random', description: 'Uniform random selection' },
  { value: 'stratified', label: 'Stratified', description: 'Preserve Y distribution' },
  { value: 'coverage', label: 'Coverage', description: 'Maximize feature space coverage' },
  { value: 'progressive', label: 'Progressive', description: 'Level-of-detail' },
];

const SAMPLE_COUNT_PRESETS = [25, 50, 100, 200, 500];

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
}: SpectraSettingsPopupProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Use external control if provided, otherwise use internal state
  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = externalOnOpenChange ?? setInternalOpen;

  const { config } = configResult;

  // Compute enabled operators for reference step selection
  const enabledOperators = useMemo(
    () => operators.filter(op => op.enabled),
    [operators]
  );

  // Count modified settings
  const modifiedCount = useMemo(() => {
    let count = 0;
    if (config.viewMode !== 'processed') count++;
    if (config.displayMode !== 'individual') count++;
    if (config.colorConfig.mode !== 'target') count++;
    if (config.aggregation.mode !== 'none') count++;
    if (config.wavelengthFocus.range !== null) count++;
    if (config.wavelengthFocus.derivative > 0) count++;
    if (config.wavelengthFocus.edgeMask.enabled) count++;
    if (config.sampling.sampleCount !== 50) count++;
    return count;
  }, [config]);

  // Handle view mode change
  const handleViewModeChange = useCallback((mode: SpectraViewMode) => {
    onInteractionStart?.();
    configResult.setViewMode(mode);
  }, [configResult, onInteractionStart]);

  // Handle display mode change
  const handleDisplayModeChange = useCallback((mode: SpectraDisplayMode) => {
    onInteractionStart?.();
    configResult.setDisplayMode(mode);
    // Auto-set aggregation mode when switching to aggregated
    if (mode === 'aggregated' && config.aggregation.mode === 'none') {
      configResult.setAggregationMode('mean_std');
    }
  }, [configResult, config.aggregation.mode, onInteractionStart]);

  // Handle color mode change
  const handleColorModeChange = useCallback((mode: SpectraColorMode) => {
    onInteractionStart?.();
    configResult.setColorMode(mode);
  }, [configResult, onInteractionStart]);

  // Handle reference step change
  const handleReferenceStepChange = useCallback((stepIndex: string) => {
    onInteractionStart?.();
    const idx = parseInt(stepIndex, 10);
    const label = idx === 0 ? 'Original' : enabledOperators[idx - 1]?.name ?? `Step ${idx}`;
    configResult.setReferenceStep(idx, label);
  }, [configResult, enabledOperators, onInteractionStart]);

  // Handle aggregation mode change
  const handleAggregationModeChange = useCallback((mode: AggregationMode) => {
    onInteractionStart?.();
    configResult.setAggregationMode(mode);
  }, [configResult, onInteractionStart]);

  // Handle group by change
  const handleGroupByChange = useCallback((field: string) => {
    onInteractionStart?.();
    configResult.setGroupBy(field === 'none' ? undefined : field);
  }, [configResult, onInteractionStart]);

  // Handle sampling strategy change
  const handleSamplingStrategyChange = useCallback((strategy: SamplingStrategy) => {
    onInteractionStart?.();
    configResult.setSamplingStrategy(strategy);
  }, [configResult, onInteractionStart]);

  // Handle sample count change
  const handleSampleCountChange = useCallback((count: number) => {
    onInteractionStart?.();
    configResult.setSampleCount(count);
  }, [configResult, onInteractionStart]);

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

  // Reset all settings
  const handleReset = useCallback(() => {
    onInteractionStart?.();
    configResult.resetConfig();
  }, [configResult, onInteractionStart]);

  // Handle unselected opacity change
  const handleUnselectedOpacityChange = useCallback((value: number[]) => {
    configResult.updateColorConfig({ unselectedOpacity: value[0] });
  }, [configResult]);

  // When externally controlled (open/onOpenChange provided), render just the popover content
  // The parent component is responsible for the trigger button
  const isExternallyControlled = externalOpen !== undefined;

  // Render only the content when externally controlled (no trigger button)
  if (isExternallyControlled) {
    return (
      <TooltipProvider>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          {/* Empty trigger - required by Radix but hidden */}
          <PopoverTrigger asChild>
            <span className="hidden" />
          </PopoverTrigger>

          <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
            {renderSettingsContent()}
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    );
  }

  // Standalone mode - render with built-in trigger button
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
              modifiedCount > 0 && 'border-primary/50 bg-primary/5'
            )}
          >
            <Settings2 className="w-3 h-3" />
            Settings
            {modifiedCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                {modifiedCount}
              </Badge>
            )}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
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
            Reset
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="view" className="w-full">
          <TabsList className="w-full justify-start rounded-none border-b px-3 h-8 bg-transparent">
            <TabsTrigger value="view" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Eye className="w-3 h-3" />
              View
            </TabsTrigger>
            <TabsTrigger value="display" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Layers className="w-3 h-3" />
              Display
            </TabsTrigger>
            <TabsTrigger value="color" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Palette className="w-3 h-3" />
              Color
            </TabsTrigger>
            <TabsTrigger value="sampling" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Shuffle className="w-3 h-3" />
              Sampling
            </TabsTrigger>
            <TabsTrigger value="focus" className="text-[10px] gap-1 px-2 h-6 data-[state=active]:bg-muted">
              <Sliders className="w-3 h-3" />
              Focus
            </TabsTrigger>
          </TabsList>

          {/* View Mode Tab */}
          <TabsContent value="view" className="p-3 space-y-3 m-0">
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">View Mode</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {VIEW_MODE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={config.viewMode === opt.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 justify-start text-[10px]"
                    onClick={() => handleViewModeChange(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Reference Step Selector */}
            {(config.viewMode === 'both' || config.viewMode === 'difference') && enabledOperators.length > 0 && (
              <>
                <Separator />
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1.5 block">Reference Step</Label>
                  <Select
                    value={String(config.referenceStep.stepIndex)}
                    onValueChange={handleReferenceStepChange}
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0" className="text-xs">Original</SelectItem>
                      {enabledOperators.map((op, idx) => (
                        <SelectItem key={op.id} value={String(idx + 1)} className="text-xs">
                          {idx + 1}: {op.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </TabsContent>

          {/* Display Mode Tab */}
          <TabsContent value="display" className="p-3 space-y-3 m-0">
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Display Mode</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {DISPLAY_MODE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={config.displayMode === opt.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 justify-start text-[10px]"
                    onClick={() => handleDisplayModeChange(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Aggregation Mode */}
            {(config.displayMode === 'aggregated' || config.displayMode === 'grouped') && (
              <>
                <Separator />
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1.5 block">Aggregation</Label>
                  <Select
                    value={config.aggregation.mode}
                    onValueChange={(v) => handleAggregationModeChange(v as AggregationMode)}
                  >
                    <SelectTrigger className="h-7 text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGREGATION_MODE_OPTIONS.filter(opt => opt.value !== 'none').map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-xs">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Group By */}
            {config.displayMode === 'grouped' && metadataColumns.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1.5 block">Group By</Label>
                <Select
                  value={config.aggregation.groupBy ?? 'none'}
                  onValueChange={handleGroupByChange}
                >
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">None</SelectItem>
                    {metadataColumns.map((col) => (
                      <SelectItem key={col} value={col} className="text-xs">{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Show Individual Lines */}
            {(config.displayMode === 'aggregated' || config.displayMode === 'grouped') && (
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Show individual lines</Label>
                <Switch
                  checked={config.aggregation.showIndividualLines ?? false}
                  onCheckedChange={(checked) => {
                    onInteractionStart?.();
                    configResult.updateAggregation({ showIndividualLines: checked });
                  }}
                />
              </div>
            )}
          </TabsContent>

          {/* Color Tab */}
          <TabsContent value="color" className="p-3 space-y-3 m-0">
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Color By</Label>
              <div className="grid grid-cols-3 gap-1">
                {COLOR_MODE_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={config.colorConfig.mode === opt.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-6 justify-start gap-1 text-[10px] px-1.5"
                    onClick={() => handleColorModeChange(opt.value)}
                  >
                    {opt.icon}
                    <span className="truncate">{opt.label.replace('By ', '')}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Metadata column selector */}
            {config.colorConfig.mode === 'metadata' && metadataColumns.length > 0 && (
              <div>
                <Label className="text-[10px] text-muted-foreground mb-1.5 block">Metadata Column</Label>
                <Select
                  value={config.colorConfig.metadataKey ?? ''}
                  onValueChange={(v) => {
                    onInteractionStart?.();
                    configResult.setColorMetadataKey(v || undefined);
                  }}
                >
                  <SelectTrigger className="h-7 text-[10px]">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {metadataColumns.map((col) => (
                      <SelectItem key={col} value={col} className="text-xs">{col}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            {/* Selection Highlighting */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px]">Highlight pinned</Label>
                <Switch
                  checked={config.colorConfig.highlightPinned}
                  onCheckedChange={(checked) => {
                    configResult.updateColorConfig({ highlightPinned: checked });
                  }}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-[10px]">Unselected opacity</Label>
                  <span className="text-[9px] font-mono text-muted-foreground">
                    {(config.colorConfig.unselectedOpacity * 100).toFixed(0)}%
                  </span>
                </div>
                <Slider
                  value={[config.colorConfig.unselectedOpacity]}
                  min={0}
                  max={1}
                  step={0.05}
                  onValueChange={handleUnselectedOpacityChange}
                  className="w-full"
                />
              </div>
            </div>
          </TabsContent>

          {/* Sampling Tab */}
          <TabsContent value="sampling" className="p-3 space-y-3 m-0">
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">Strategy</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {SAMPLING_STRATEGY_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    variant={config.sampling.strategy === opt.value ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-7 px-2 justify-start text-[10px]"
                    onClick={() => handleSamplingStrategyChange(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-[10px] text-muted-foreground">Count</Label>
                <Badge variant="outline" className="text-[9px] h-4">
                  {Math.min(config.sampling.sampleCount, totalSamples)}/{totalSamples}
                </Badge>
              </div>

              <div className="flex gap-1 flex-wrap mb-2">
                {SAMPLE_COUNT_PRESETS.map((count) => (
                  <Button
                    key={count}
                    variant={config.sampling.sampleCount === count ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-5 text-[9px] px-1.5"
                    onClick={() => handleSampleCountChange(count)}
                    disabled={count > totalSamples}
                  >
                    {count}
                  </Button>
                ))}
                <Button
                  variant={config.sampling.sampleCount === totalSamples ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-5 text-[9px] px-1.5"
                  onClick={() => handleSampleCountChange(totalSamples)}
                >
                  All
                </Button>
              </div>

              <Slider
                value={[config.sampling.sampleCount]}
                min={10}
                max={Math.min(1000, totalSamples)}
                step={10}
                onValueChange={([value]) => handleSampleCountChange(value)}
                className="w-full"
              />
            </div>
          </TabsContent>

          {/* Focus Tab */}
          <TabsContent value="focus" className="p-3 space-y-3 m-0">
            {/* ROI Presets */}
            <div>
              <Label className="text-[10px] text-muted-foreground mb-1.5 block">NIR Region</Label>
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
        </Tabs>
      </>
    );
  }
}

export default SpectraSettingsPopup;
