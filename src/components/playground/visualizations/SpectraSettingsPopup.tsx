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

import { useCallback, useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  DEFAULT_FILTER_CONFIG,
  NIR_ROI_PRESETS,
  type PartitionFilter,
} from '@/lib/playground/spectraConfig';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { FoldsInfo, UnifiedOperator } from '@/types/playground';
import { buildSpectraSettingsReadModel } from './SpectraSettingsPopupData';
import { SpectraSettingsPopupContent } from './SpectraSettingsPopupContent';

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
  /**
   * Display suffix for the wavelength unit (e.g. " nm", " cm⁻¹"). Empty
   * string when the unit is unknown — do not hardcode "nm" in display text,
   * since cm⁻¹ datasets exist and were previously mislabelled.
   */
  wavelengthUnitSuffix?: string;
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

// ============= Main Component =============

export function SpectraSettingsPopup({
  configResult,
  operators: _operators = [],
  metadataColumns = [],
  totalSamples,
  wavelengthRange,
  wavelengthCount,
  wavelengthUnitSuffix = '',
  onInteractionStart,
  compact: _compact = false,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  folds,
  yRange,
  filteredSamples,
}: SpectraSettingsPopupProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isOpen = externalOpen !== undefined ? externalOpen : internalOpen;
  const setIsOpen = externalOnOpenChange ?? setInternalOpen;

  const { config } = configResult;

  const settingsReadModel = useMemo(
    () => buildSpectraSettingsReadModel({
      config,
      wavelengthRange,
      wavelengthUnitSuffix,
      yRange,
      metadataColumns,
    }),
    [config, metadataColumns, wavelengthRange, wavelengthUnitSuffix, yRange],
  );

  const handleWavelengthRangeChange = useCallback((range: [number, number]) => {
    onInteractionStart?.();
    configResult.setWavelengthRange(range);
  }, [configResult, onInteractionStart]);

  const handleDerivativeChange = useCallback((order: 0 | 1 | 2) => {
    onInteractionStart?.();
    configResult.setDerivative(order);
  }, [configResult, onInteractionStart]);

  const handleEdgeMaskToggle = useCallback((enabled: boolean) => {
    onInteractionStart?.();
    configResult.setEdgeMask(enabled);
  }, [configResult, onInteractionStart]);

  const handleEdgeMaskStartChange = useCallback((start: number) => {
    onInteractionStart?.();
    configResult.setEdgeMask(true, start, config.wavelengthFocus.edgeMask.end);
  }, [config.wavelengthFocus.edgeMask.end, configResult, onInteractionStart]);

  const handleEdgeMaskEndChange = useCallback((end: number) => {
    onInteractionStart?.();
    configResult.setEdgeMask(true, config.wavelengthFocus.edgeMask.start, end);
  }, [config.wavelengthFocus.edgeMask.start, configResult, onInteractionStart]);

  const handlePresetSelect = useCallback((presetId: string) => {
    onInteractionStart?.();
    const preset = NIR_ROI_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }

    if (preset.id === 'full') {
      configResult.setWavelengthRange(null);
    } else {
      configResult.setWavelengthRange(preset.range);
    }
    configResult.setActivePreset(presetId);
  }, [configResult, onInteractionStart]);

  const handlePartitionChange = useCallback((partition: PartitionFilter) => {
    onInteractionStart?.();
    configResult.updateFilters({
      partition,
      foldIndex: partition === 'fold' ? 0 : undefined,
    });
  }, [configResult, onInteractionStart]);

  const handleFoldIndexChange = useCallback((foldIndex: number) => {
    onInteractionStart?.();
    configResult.updateFilters({ foldIndex });
  }, [configResult, onInteractionStart]);

  const handleTargetRangeChange = useCallback((range: [number, number] | undefined) => {
    onInteractionStart?.();
    configResult.updateFilters({ targetRange: range });
  }, [configResult, onInteractionStart]);

  const handleQCStatusChange = useCallback((status: 'all' | 'accepted' | 'rejected') => {
    onInteractionStart?.();
    configResult.updateFilters({ qcStatus: status });
  }, [configResult, onInteractionStart]);

  const handleReset = useCallback(() => {
    onInteractionStart?.();
    configResult.resetConfig();
  }, [configResult, onInteractionStart]);

  const handleResetFocus = useCallback(() => {
    onInteractionStart?.();
    configResult.setWavelengthRange(null);
    configResult.setDerivative(0);
    configResult.setEdgeMask(false);
    configResult.setActivePreset('full');
  }, [configResult, onInteractionStart]);

  const handleResetFilters = useCallback(() => {
    onInteractionStart?.();
    configResult.updateFilters(DEFAULT_FILTER_CONFIG);
  }, [configResult, onInteractionStart]);

  const content = (
    <SpectraSettingsPopupContent
      config={config}
      readModel={settingsReadModel}
      wavelengthRange={wavelengthRange}
      wavelengthCount={wavelengthCount}
      totalSamples={totalSamples}
      folds={folds}
      yRange={yRange}
      filteredSamples={filteredSamples}
      onReset={handleReset}
      onResetFocus={handleResetFocus}
      onResetFilters={handleResetFilters}
      onPresetSelect={handlePresetSelect}
      onWavelengthRangeChange={handleWavelengthRangeChange}
      onDerivativeChange={handleDerivativeChange}
      onEdgeMaskToggle={handleEdgeMaskToggle}
      onEdgeMaskStartChange={handleEdgeMaskStartChange}
      onEdgeMaskEndChange={handleEdgeMaskEndChange}
      onPartitionChange={handlePartitionChange}
      onFoldIndexChange={handleFoldIndexChange}
      onTargetRangeChange={handleTargetRangeChange}
      onQCStatusChange={handleQCStatusChange}
    />
  );

  const isExternallyControlled = externalOpen !== undefined;

  if (isExternallyControlled) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <span className="hidden" />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-[340px] p-0" sideOffset={4}>
          {content}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={settingsReadModel.modifiedCount > 0 ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 px-2 gap-1"
              >
                <Settings2 className="w-3.5 h-3.5" />
                {settingsReadModel.modifiedCount > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[9px] ml-0.5">
                    {settingsReadModel.modifiedCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Focus & Filter settings</TooltipContent>
        </Tooltip>

        <PopoverContent side="bottom" align="start" className="w-[340px] p-0" sideOffset={4}>
          {content}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}

export default SpectraSettingsPopup;
