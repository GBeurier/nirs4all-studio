/**
 * WavelengthRangePicker - Wavelength focus controls for SpectraChart
 *
 * Phase 2 Implementation: Enhanced Spectra Chart
 *
 * Features:
 * - Dual-handle range slider for wavelength selection
 * - NIR ROI presets (Water Band, Protein, etc.)
 * - Edge masking toggle
 * - Derivative view toggle (1st/2nd)
 * - Custom preset saving
 */

import { useState, useCallback, useMemo } from 'react';
import {
  Sliders,
  Scissors,
  TrendingUp,
  Bookmark,
  Plus,
  Trash2,
  RotateCcw,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  type WavelengthFocusConfig,
  type WavelengthROI,
  NIR_ROI_PRESETS,
  DEFAULT_WAVELENGTH_FOCUS_CONFIG,
} from '@/lib/playground/spectraConfig';

// ============= Types =============

export interface WavelengthRangePickerProps {
  /** Current wavelength focus configuration */
  config: WavelengthFocusConfig;
  /** Callback when configuration changes */
  onChange: (config: Partial<WavelengthFocusConfig>) => void;
  /** Available wavelength range from data */
  wavelengthRange: [number, number];
  /** Number of wavelength points */
  wavelengthCount: number;
  /** Callback when any setting changes (for triggering redraw) */
  onInteractionStart?: () => void;
  /** Compact mode */
  compact?: boolean;
}

// ============= Sub-Components =============

interface DualRangeSliderProps {
  value: [number, number];
  min: number;
  max: number;
  step?: number;
  onChange: (value: [number, number]) => void;
  onInteractionStart?: () => void;
}

function DualRangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onInteractionStart,
}: DualRangeSliderProps) {
  return (
    <div className="space-y-2">
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(newValue) => {
          onInteractionStart?.();
          onChange(newValue as [number, number]);
        }}
        className="w-full"
      />
      <div className="flex justify-between text-[10px] text-muted-foreground font-mono">
        <span>{value[0].toFixed(0)} nm</span>
        <span>{value[1].toFixed(0)} nm</span>
      </div>
    </div>
  );
}

interface DerivativeToggleProps {
  value: 0 | 1 | 2;
  onChange: (value: 0 | 1 | 2) => void;
  onInteractionStart?: () => void;
}

function DerivativeToggle({ value, onChange, onInteractionStart }: DerivativeToggleProps) {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((deriv) => (
        <Button
          key={deriv}
          variant={value === deriv ? 'secondary' : 'ghost'}
          size="sm"
          className="h-6 w-8 text-[10px] px-0"
          onClick={() => {
            onInteractionStart?.();
            onChange(deriv as 0 | 1 | 2);
          }}
        >
          {deriv === 0 ? 'Off' : `d${deriv}`}
        </Button>
      ))}
    </div>
  );
}

// ============= Main Component =============

export function WavelengthRangePicker({
  config,
  onChange,
  wavelengthRange,
  wavelengthCount,
  onInteractionStart,
  compact = false,
}: WavelengthRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [customPresetName, setCustomPresetName] = useState('');

  // Compute effective range for slider
  const sliderRange = useMemo(() => {
    return config.range ?? wavelengthRange;
  }, [config.range, wavelengthRange]);

  // Check if range is modified from full
  const isRangeModified = useMemo(() => {
    if (!config.range) return false;
    return config.range[0] > wavelengthRange[0] || config.range[1] < wavelengthRange[1];
  }, [config.range, wavelengthRange]);

  // Find active preset
  const activePreset = useMemo(() => {
    if (config.activePreset) {
      return [...NIR_ROI_PRESETS, ...(config.customPresets ?? [])].find(
        p => p.id === config.activePreset
      );
    }
    return null;
  }, [config.activePreset, config.customPresets]);

  // Handle preset selection
  const handlePresetSelect = useCallback((preset: WavelengthROI) => {
    onInteractionStart?.();
    if (preset.id === 'full') {
      onChange({
        range: null,
        activePreset: 'full',
      });
    } else {
      onChange({
        range: preset.range,
        activePreset: preset.id,
      });
    }
  }, [onChange, onInteractionStart]);

  // Handle custom range change
  const handleRangeChange = useCallback((range: [number, number]) => {
    onChange({
      range,
      activePreset: undefined, // Clear preset when manually adjusting
    });
  }, [onChange]);

  // Handle edge mask toggle
  const handleEdgeMaskToggle = useCallback((enabled: boolean) => {
    onInteractionStart?.();
    onChange({
      edgeMask: {
        ...config.edgeMask,
        enabled,
      },
    });
  }, [config.edgeMask, onChange, onInteractionStart]);

  // Handle edge mask values
  const handleEdgeMaskValues = useCallback((start: number, end: number) => {
    onChange({
      edgeMask: {
        enabled: true,
        start,
        end,
      },
    });
  }, [onChange]);

  // Save current range as custom preset
  const handleSavePreset = useCallback(() => {
    if (!customPresetName.trim() || !config.range) return;

    const newPreset: WavelengthROI = {
      id: `custom-${Date.now()}`,
      name: customPresetName.trim(),
      range: config.range,
    };

    onChange({
      customPresets: [...(config.customPresets ?? []), newPreset],
      activePreset: newPreset.id,
    });
    setCustomPresetName('');
  }, [customPresetName, config.range, config.customPresets, onChange]);

  // Delete custom preset
  const handleDeletePreset = useCallback((presetId: string) => {
    onChange({
      customPresets: (config.customPresets ?? []).filter(p => p.id !== presetId),
      activePreset: config.activePreset === presetId ? undefined : config.activePreset,
    });
  }, [config.customPresets, config.activePreset, onChange]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    onInteractionStart?.();
    onChange({
      range: null,
      derivative: 0,
      edgeMask: DEFAULT_WAVELENGTH_FOCUS_CONFIG.edgeMask,
      activePreset: undefined,
    });
  }, [onChange, onInteractionStart]);

  // Handle derivative change
  const handleDerivativeChange = useCallback((derivative: 0 | 1 | 2) => {
    onChange({ derivative });
  }, [onChange]);

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
              (isRangeModified || config.derivative > 0 || config.edgeMask.enabled) && 'border-primary/50 bg-primary/5'
            )}
          >
            <Sliders className="w-3 h-3" />
            {activePreset ? (
              <span className="max-w-20 truncate">{activePreset.name}</span>
            ) : isRangeModified ? (
              <span className="font-mono text-[10px]">
                {sliderRange[0].toFixed(0)}-{sliderRange[1].toFixed(0)}
              </span>
            ) : (
              'Focus'
            )}
            {(config.derivative > 0 || config.edgeMask.enabled) && (
              <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                {config.derivative > 0 && `d${config.derivative}`}
                {config.derivative > 0 && config.edgeMask.enabled && '+'}
                {config.edgeMask.enabled && 'mask'}
              </Badge>
            )}
            <ChevronDown className="w-3 h-3 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-0">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Sliders className="w-4 h-4 text-primary" />
              Wavelength Focus
            </h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleReset}
            >
              <RotateCcw className="w-3 h-3 mr-1" />
              Reset
            </Button>
          </div>

          <div className="p-3 space-y-4">
            {/* ROI Presets */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">NIR Region Presets</Label>
              <div className="flex flex-wrap gap-1">
                {NIR_ROI_PRESETS.map((preset) => (
                  <Tooltip key={preset.id}>
                    <TooltipTrigger asChild>
                      <Button
                        variant={config.activePreset === preset.id ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => handlePresetSelect(preset)}
                        style={preset.color ? { borderColor: preset.color + '40' } : undefined}
                      >
                        {preset.name}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {preset.description && <p>{preset.description}</p>}
                      {preset.range[1] !== Infinity && (
                        <p className="font-mono text-muted-foreground">
                          {preset.range[0]}-{preset.range[1]} nm
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>

              {/* Custom presets */}
              {config.customPresets && config.customPresets.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {config.customPresets.map((preset) => (
                    <div key={preset.id} className="flex items-center gap-0.5">
                      <Button
                        variant={config.activePreset === preset.id ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => handlePresetSelect(preset)}
                      >
                        <Bookmark className="w-3 h-3 mr-1" />
                        {preset.name}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleDeletePreset(preset.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Range slider */}
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Wavelength Range</Label>
              <DualRangeSlider
                value={sliderRange}
                min={wavelengthRange[0]}
                max={wavelengthRange[1]}
                step={1}
                onChange={handleRangeChange}
                onInteractionStart={onInteractionStart}
              />
            </div>

            {/* Save custom preset */}
            {isRangeModified && (
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Preset name..."
                  value={customPresetName}
                  onChange={(e) => setCustomPresetName(e.target.value)}
                  className="h-7 text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleSavePreset}
                  disabled={!customPresetName.trim()}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            )}

            <Separator />

            {/* Derivative toggle */}
            <div className="flex items-center justify-between">
              <Label className="text-xs flex items-center gap-2">
                <TrendingUp className="w-3 h-3 text-muted-foreground" />
                Derivative View
              </Label>
              <DerivativeToggle
                value={config.derivative}
                onChange={handleDerivativeChange}
                onInteractionStart={onInteractionStart}
              />
            </div>

            {/* Edge masking */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-2">
                  <Scissors className="w-3 h-3 text-muted-foreground" />
                  Edge Masking
                </Label>
                <Switch
                  checked={config.edgeMask.enabled}
                  onCheckedChange={handleEdgeMaskToggle}
                />
              </div>

              {config.edgeMask.enabled && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Start points</Label>
                    <Input
                      type="number"
                      min={0}
                      max={wavelengthCount / 2}
                      value={config.edgeMask.start}
                      onChange={(e) => {
                        onInteractionStart?.();
                        handleEdgeMaskValues(parseInt(e.target.value) || 0, config.edgeMask.end);
                      }}
                      className="h-7 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">End points</Label>
                    <Input
                      type="number"
                      min={0}
                      max={wavelengthCount / 2}
                      value={config.edgeMask.end}
                      onChange={(e) => {
                        onInteractionStart?.();
                        handleEdgeMaskValues(config.edgeMask.start, parseInt(e.target.value) || 0);
                      }}
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export default WavelengthRangePicker;
